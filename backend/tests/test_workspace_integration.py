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
* verified evidence without an attachment or link is rejected by the database;
* the ``anon`` role cannot call any ``api_workspace_*`` function (migration 0003);
* an authenticated user cannot create a version row without a change-log entry.
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


def _error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    return str(body.get("code", "")) if isinstance(body, dict) else ""


def test_anon_role_cannot_call_any_workspace_function() -> None:
    """The anon role must not reach any api_workspace_* RPC (migration 0003).

    Valid arguments are sent on purpose: if anon *could* execute, the call would
    fail with a functional error (``28000`` not authenticated, ``P0002`` not
    found, ``P0001`` invalid) rather than ``42501`` permission denied / ``404``
    not in the schema cache — so this distinguishes "blocked" from "allowed".
    """

    async def run() -> None:
        settings = supabase_auth.env()
        base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        anon_key = settings.supabase_publishable_key
        headers = {
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",  # the anon JWT -> role anon
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        placeholder = str(uuid4())
        calls: dict[str, dict[str, object]] = {
            "api_workspace_create": {
                "p_section": "skill",
                "p_title": unique_title("anon"),
                "p_organization": None,
                "p_start_date": None,
                "p_end_date": None,
                "p_location": None,
                "p_bullets": [],
                "p_tags": [],
                "p_links": [],
                "p_attachments": [],
                "p_evidence": "attested",
            },
            "api_workspace_update": {"p_id": placeholder, "p_patch": {"title": "x"}},
            "api_workspace_delete": {"p_id": placeholder},
            "api_workspace_restore": {"p_id": placeholder},
            "api_workspace_reorder": {"p_section": "skill", "p_ids": [placeholder]},
            # dropped by 0003: must not exist for anyone
            "api_workspace_next_seq": {"p_user": placeholder},
            "api_workspace_next_version": {"p_user": placeholder},
        }
        async with httpx.AsyncClient(base_url=base, headers=headers, timeout=20.0) as client:
            for name, body in calls.items():
                response = await client.post(f"/rpc/{name}", json=body)
                code = _error_code(response)
                blocked = code in {"42501", "PGRST202"} or response.status_code in (401, 404)
                assert response.status_code >= 400 and blocked, (
                    f"{name} was reachable by anon (HTTP {response.status_code}, code {code!r})"
                )

    asyncio.run(run())


def test_authenticated_user_cannot_create_version_without_changelog() -> None:
    """A workspace version can never exist without a matching change-log entry.

    ``api_workspace_next_version`` used to allow exactly that as a standalone RPC;
    migration 0003 removes it and adds a deferred constraint trigger so even a
    direct Data API insert of a version row is rejected at commit.
    """

    async def run() -> None:
        token = supabase_auth.access_token_a()
        user_id = supabase_auth.current_user_id(token)
        settings = supabase_auth.env()
        base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        headers = {
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }
        repository = repo_for(token)
        current_version = (await repository.get_workspace("")).version
        # Above any real per-user version so it can never collide, but low enough
        # that a leaked row could not overflow the next MAX(version) + 1 bump.
        sentinel_version = current_version + 100_000

        async with httpx.AsyncClient(base_url=base, headers=headers, timeout=20.0) as client:
            # 1. the standalone version-bump helper no longer exists
            bump = await client.post("/rpc/api_workspace_next_version", json={"p_user": user_id})
            assert bump.status_code >= 400

            # 2. a direct version insert with no change-log row is rejected
            direct = await client.post(
                "/workspace_versions",
                json={"user_id": user_id, "version": sentinel_version},
            )
            assert direct.status_code >= 400

            # 3. nothing was committed
            check = await client.get(
                "/workspace_versions",
                params={
                    "user_id": f"eq.{user_id}",
                    "version": f"eq.{sentinel_version}",
                    "select": "version",
                },
            )
            assert check.status_code == 200
            assert check.json() == []

        # 4. the supported path keeps the pair together: the current workspace
        #    version always has at least one change_log entry.
        created = await repository.create_item(
            "", WorkspaceItemCreate(section="skill", title=unique_title("invariant"))
        )
        try:
            entries = await repository.list_changelog("")
            logged_versions = {entry.workspaceVersion for entry in entries}
            assert (await repository.get_workspace("")).version in logged_versions
        finally:
            await tidy_up(repository, created.id)

    asyncio.run(run())
