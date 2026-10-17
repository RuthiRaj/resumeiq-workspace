"""Opt-in integration tests against a real Supabase project (B1 verification).

Skipped by default. To run them, put the values below in ``backend/.env`` (never
committed) and set ``RUN_SUPABASE_INTEGRATION=1``:

    SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY
    SUPABASE_TEST_EMAIL_A / SUPABASE_TEST_PASSWORD_A
    SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B   # isolation tests

``tests/supabase_auth.py`` signs the two users in through Supabase Auth and hands
back access tokens; no password, key or token is ever printed.

These exercise the Data API + the ``api_workspace_*`` functions with a real JWT,
so they prove RLS and the transactional versioning end to end:

* the full mutation lifecycle (create/read/update/soft-delete/restore);
* user A cannot read, update, delete, restore or reorder user B's items;
* the change log and the standard resume are per-user;
* verified evidence without an attachment or link is rejected by the database.
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from app.repositories.errors import InvalidReorderError, ItemNotFoundError
from app.repositories.workspace import SupabaseWorkspaceRepository
from app.schemas.workspace import WorkspaceItemCreate
from app.services.standard_resume import build_standard_resume
from tests import supabase_auth

pytestmark = pytest.mark.skipif(not supabase_auth.enabled(), reason=supabase_auth.skip_reason())

_NEEDS_USER_B = pytest.mark.skipif(
    not supabase_auth.isolation_available(),
    reason="isolation tests need SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B",
)


def repo_for(token: str) -> SupabaseWorkspaceRepository:
    settings = supabase_auth.env()
    return SupabaseWorkspaceRepository(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        settings.supabase_publishable_key,
        token,
    )


async def rpc(token: str, name: str, body: dict[str, object]) -> httpx.Response:
    """Call a PostgREST RPC directly, bypassing the pydantic request models."""
    settings = supabase_auth.env()
    base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
    headers = {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(base_url=base, headers=headers, timeout=20.0) as client:
        return await client.post(f"/rpc/{name}", json=body)


def unique_title(prefix: str = "integration") -> str:
    return f"{prefix}-{datetime.now(UTC).isoformat()}-{uuid4().hex[:8]}"


async def tidy_up(repository: SupabaseWorkspaceRepository, item_id: str) -> None:
    """Best-effort soft delete so a failed run never leaves active rows behind."""
    with contextlib.suppress(ItemNotFoundError):
        await repository.soft_delete_item("", item_id)


def test_full_mutation_lifecycle() -> None:
    async def run() -> None:
        repository = repo_for(supabase_auth.access_token_a())
        before = (await repository.get_workspace("")).version

        created = await repository.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title())
        )
        assert created.id
        try:
            fetched = await repository.get_item("", created.id)
            assert fetched is not None and fetched.id == created.id

            updated = await repository.update_item("", created.id, {"title": "renamed"})
            assert updated.title == "renamed"

            await repository.soft_delete_item("", created.id)
            assert await repository.get_item("", created.id) is not None  # still readable by id
            listing = await repository.get_workspace("")
            assert all(i.id != created.id for i in listing.items)

            await repository.restore_item("", created.id)
            after = await repository.get_workspace("")
            assert after.version > before
            assert any(i.id == created.id for i in after.items)
        finally:
            await tidy_up(repository, created.id)

    asyncio.run(run())


@_NEEDS_USER_B
def test_user_a_cannot_read_update_delete_restore_or_reorder_user_b_items() -> None:
    async def run() -> None:
        user_a = repo_for(supabase_auth.access_token_a())
        user_b = repo_for(supabase_auth.access_token_b())

        b_item = await user_b.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("b-item"))
        )
        try:
            # read: RLS hides B's row from A entirely
            assert await user_a.get_item("", b_item.id) is None
            assert all(i.id != b_item.id for i in (await user_a.get_workspace("")).items)

            # update / delete / restore: the SQL guard scopes on auth.uid()
            with pytest.raises(ItemNotFoundError):
                await user_a.update_item("", b_item.id, {"title": "hijacked"})
            with pytest.raises(ItemNotFoundError):
                await user_a.soft_delete_item("", b_item.id)
            with pytest.raises(ItemNotFoundError):
                await user_a.restore_item("", b_item.id)

            # reorder: B's id is not an active item in A's section
            with pytest.raises(InvalidReorderError):
                await user_a.reorder("", "skill", [b_item.id])

            # B's item is untouched by every attempt above
            still_there = await user_b.get_item("", b_item.id)
            assert still_there is not None
            assert still_there.title == b_item.title
            assert still_there.deletedAt is None
        finally:
            await tidy_up(user_b, b_item.id)

    asyncio.run(run())


@_NEEDS_USER_B
def test_change_log_is_per_user() -> None:
    async def run() -> None:
        user_a = repo_for(supabase_auth.access_token_a())
        user_b = repo_for(supabase_auth.access_token_b())

        a_item = await user_a.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("a-log"))
        )
        b_item = await user_b.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("b-log"))
        )
        try:
            a_ids = {entry.itemId for entry in await user_a.list_changelog("")}
            b_ids = {entry.itemId for entry in await user_b.list_changelog("")}
            assert a_item.id in a_ids
            assert b_item.id not in a_ids
            assert b_item.id in b_ids
            assert a_item.id not in b_ids
        finally:
            await tidy_up(user_a, a_item.id)
            await tidy_up(user_b, b_item.id)

    asyncio.run(run())


@_NEEDS_USER_B
def test_standard_resume_is_per_user() -> None:
    async def run() -> None:
        user_a = repo_for(supabase_auth.access_token_a())
        user_b = repo_for(supabase_auth.access_token_b())

        a_item = await user_a.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("a-resume"))
        )
        b_item = await user_b.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("b-resume"))
        )
        try:
            resume = build_standard_resume(await user_a.get_workspace(""))
            evidence_ids = {
                evidence_id
                for section in resume.sections
                for claim in section.claims
                for evidence_id in claim.evidenceIds
            }
            assert a_item.id in evidence_ids  # A's own evidence is present
            assert b_item.id not in evidence_ids  # B's never leaks into A's resume
        finally:
            await tidy_up(user_a, a_item.id)
            await tidy_up(user_b, b_item.id)

    asyncio.run(run())


def test_verified_evidence_without_support_is_rejected_by_database() -> None:
    """The SQL guard, not just pydantic, must reject an unsupported ``verified``.

    The pydantic models already block this at the API edge
    (``test_create_verified_without_support_is_rejected_by_schema``); here we call
    the RPC directly to prove the database refuses it too, so no client can bypass
    the rule by talking to PostgREST directly.
    """

    async def run() -> None:
        token = supabase_auth.access_token_a()
        repository = repo_for(token)

        created = await repository.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("no-support"))
        )
        try:
            update = await rpc(
                token,
                "api_workspace_update",
                {
                    "p_id": created.id,
                    "p_patch": {"evidence": "verified", "links": [], "attachments": []},
                },
            )
            assert update.status_code >= 400
            assert (update.json() or {}).get("code") == "P0001"

            create = await rpc(
                token,
                "api_workspace_create",
                {
                    "p_section": "skill",
                    "p_title": unique_title("no-support-create"),
                    "p_organization": None,
                    "p_start_date": None,
                    "p_end_date": None,
                    "p_location": None,
                    "p_bullets": [],
                    "p_tags": [],
                    "p_links": [],
                    "p_attachments": [],
                    "p_evidence": "verified",
                },
            )
            assert create.status_code >= 400
            assert (create.json() or {}).get("code") == "P0001"
        finally:
            await tidy_up(repository, created.id)

    asyncio.run(run())
