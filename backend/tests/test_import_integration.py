"""Opt-in live import-isolation tests against a real Supabase project (B2).

Skipped by default. To run them, fill ``backend/.env.test`` (git-ignored; see
``backend/.env.test.example``) with ``RUN_SUPABASE_INTEGRATION=1``, two test
users, and apply ``backend/db/migrations/0004_imports.sql`` to the project:

    SUPABASE_TEST_EMAIL_A / SUPABASE_TEST_PASSWORD_A   # the caller
    SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B   # the "other" user

``SUPABASE_URL`` and ``SUPABASE_PUBLISHABLE_KEY`` come from the runtime
``backend/.env``. ``tests/supabase_auth.py`` signs both users in; no password,
key or token is ever printed.

The tests prove the parts only a real database can prove:

* user A cannot list, read, patch or confirm user B's import sessions or items;
* confirming a review item is idempotent (twice returns the same workspace item);
* a confirmed item appears in A's workspace as ``attested``, or ``verified`` only
  when a certificate link was attached (IM-3).

Every skip names its cause -- the gate/credentials, the user B account, or the
missing 0004 migration -- so a skipped run is never ambiguous.
"""

from __future__ import annotations

import asyncio
import contextlib
from uuid import uuid4

import httpx
import pytest

from app.extraction.engine import ParsedDocument
from app.repositories.errors import ImportReviewItemNotFoundError, ItemNotFoundError
from app.repositories.imports import SupabaseImportRepository
from app.repositories.workspace import SupabaseWorkspaceRepository
from app.schemas.imports import ExtractedField, ExtractionItem, ImportSession
from app.schemas.workspace import WorkspaceItemResponse, WorkspaceSection
from tests import supabase_auth

#: Titles/usernames are generated per test so a failed run is easy to spot.
_CONFIRM_LINK = "https://example.com/certificates/b2-isolation"


def _unavailable_reason() -> str | None:
    """Every condition that keeps these tests from running, or ``None``."""
    reasons: list[str] = []
    if not supabase_auth.enabled():
        reasons.append(supabase_auth.skip_reason())
    else:
        available, detail = supabase_auth.import_schema_status()
        if not available:
            reasons.append(f"{detail}; apply migration 0004 and retry")
    if not supabase_auth.isolation_available():
        reasons.append(
            "user B credentials are missing from backend/.env.test "
            "(SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B, or SUPABASE_TEST_TOKEN_B)"
        )
    return "; ".join(reasons) if reasons else None


_REPORTED: set[str] = set()


@pytest.fixture(autouse=True)
def _live_import_environment(request: pytest.FixtureRequest) -> None:
    """Skip (naming the exact condition once) unless the live env is complete."""
    reason = _unavailable_reason()
    if reason is None:
        return
    if reason not in _REPORTED:
        _REPORTED.add(reason)
        message = f"[import-integration] skipped: {reason}"
        reporter = request.config.pluginmanager.get_plugin("terminalreporter")
        if reporter is not None:
            reporter.write_line(message)
        else:  # pragma: no cover - only when the terminal plugin is disabled
            print(message)
    pytest.skip(reason)


def _rest_url() -> str:
    return f"{supabase_auth.env().supabase_url.rstrip('/')}/rest/v1"


def _import_repo(token: str) -> SupabaseImportRepository:
    settings = supabase_auth.env()
    return SupabaseImportRepository(_rest_url(), settings.supabase_publishable_key, token)


def _workspace_repo(token: str) -> SupabaseWorkspaceRepository:
    settings = supabase_auth.env()
    return SupabaseWorkspaceRepository(_rest_url(), settings.supabase_publishable_key, token)


def _parsed(*, section: WorkspaceSection = "experience") -> ParsedDocument:
    """A parsed document without an upload: the RPC only needs the extraction."""
    suffix = uuid4().hex[:8]
    title = f"B2 Isolation {section} {suffix}"
    item_id = f"ext-{section}-{suffix}"
    return ParsedDocument(
        file_type="pdf",
        page_count=1,
        source_text=f"EXAMPLE CANDIDATE\n{title}\nExample Payments Ltd\n",
        preview_available=True,
        items=[
            ExtractionItem(
                id=item_id,
                section=section,
                fields=[
                    ExtractedField(
                        key="title", label="Role", value=title, confidence=0.9, sourceLine=2
                    ),
                    ExtractedField(
                        key="organization",
                        label="Organization",
                        value="Example Payments Ltd",
                        confidence=0.75,
                        sourceLine=3,
                    ),
                ],
                confidence=0.75,
            )
        ],
    )


async def _create_session(
    repository: SupabaseImportRepository,
    user_id: str,
    *,
    section: WorkspaceSection = "experience",
) -> ImportSession:
    parsed = _parsed(section=section)
    return await repository.create_session(
        user_id,
        file_name="resume.pdf",
        file_type="pdf",
        file_size=len(parsed.source_text),
        parsed=parsed,
    )


async def _delete_session(token: str, session_id: str) -> None:
    """Best-effort cleanup: RLS lets the owner delete the session (items cascade)."""
    settings = supabase_auth.env()
    headers = {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(base_url=_rest_url(), headers=headers, timeout=20.0) as client:
        await client.delete("/import_sessions", params={"id": f"eq.{session_id}"})


async def _tidy(
    workspace: SupabaseWorkspaceRepository,
    user_id: str,
    *,
    workspace_item: WorkspaceItemResponse | None = None,
    token: str | None = None,
    session_id: str | None = None,
) -> None:
    if workspace_item is not None:
        with contextlib.suppress(ItemNotFoundError):
            await workspace.soft_delete_item(user_id, workspace_item.id)
    if token is not None and session_id is not None:
        with contextlib.suppress(httpx.HTTPError):
            await _delete_session(token, session_id)


def _accounts() -> tuple[str, str, str, str]:
    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b()
    return (
        token_a,
        supabase_auth.current_user_id(token_a),
        token_b,
        supabase_auth.current_user_id(token_b),
    )


def test_user_a_cannot_list_or_read_user_b_import_sessions() -> None:
    async def run() -> None:
        token_a, uid_a, token_b, uid_b = _accounts()
        imports_a = _import_repo(token_a)
        imports_b = _import_repo(token_b)

        session = await _create_session(imports_b, uid_b)
        try:
            assert session.id not in {row.id for row in await imports_a.list_sessions(uid_a)}
            assert await imports_a.get_session(uid_a, session.id) is None

            # B can still read their own session: the data is not lost, only hidden.
            own = await imports_b.get_session(uid_b, session.id)
            assert own is not None and own.id == session.id
        finally:
            await _tidy(
                _workspace_repo(token_b),
                uid_b,
                token=token_b,
                session_id=session.id,
            )

    asyncio.run(run())


def test_user_a_cannot_patch_or_confirm_user_b_import_items() -> None:
    async def run() -> None:
        token_a, uid_a, token_b, uid_b = _accounts()
        imports_a = _import_repo(token_a)
        imports_b = _import_repo(token_b)
        workspace_b = _workspace_repo(token_b)

        session = await _create_session(imports_b, uid_b)
        item_id = session.items[0].id
        title = session.items[0].values.title
        try:
            with pytest.raises(ImportReviewItemNotFoundError):
                await imports_a.update_item(uid_a, session.id, item_id, {"status": "rejected"})

            with pytest.raises(ImportReviewItemNotFoundError):
                await imports_a.confirm_item(uid_a, session.id, item_id)

            # B's item is untouched and nothing reached B's workspace.
            still = await imports_b.get_session(uid_b, session.id)
            assert still is not None
            assert next(item for item in still.items if item.id == item_id).status == "pending"
            assert all(
                item.title != title for item in (await workspace_b.get_workspace(uid_b)).items
            )
        finally:
            await _tidy(workspace_b, uid_b, token=token_b, session_id=session.id)

    asyncio.run(run())


def test_confirming_a_review_item_is_idempotent() -> None:
    async def run() -> None:
        token_a, uid_a, _, _ = _accounts()
        imports_a = _import_repo(token_a)
        workspace_a = _workspace_repo(token_a)

        session = await _create_session(imports_a, uid_a)
        item_id = session.items[0].id
        first: WorkspaceItemResponse | None = None
        try:
            first, first_review = await imports_a.confirm_item(uid_a, session.id, item_id)
            second, second_review = await imports_a.confirm_item(uid_a, session.id, item_id)

            assert first.id == second.id  # the same workspace item, not a duplicate
            assert first_review.status == second_review.status == "confirmed"
            assert (
                sum(
                    1
                    for item in (await workspace_a.get_workspace(uid_a)).items
                    if item.id == first.id
                )
                == 1
            )
        finally:
            await _tidy(
                workspace_a,
                uid_a,
                workspace_item=first,
                token=token_a,
                session_id=session.id,
            )

    asyncio.run(run())


def test_confirmed_item_is_attested_unless_a_certificate_is_attached() -> None:
    async def run() -> None:
        token_a, uid_a, _, _ = _accounts()
        imports_a = _import_repo(token_a)
        workspace_a = _workspace_repo(token_a)

        attested_session = await _create_session(imports_a, uid_a)
        attested: WorkspaceItemResponse | None = None
        verified: WorkspaceItemResponse | None = None
        verified_session: ImportSession | None = None
        try:
            attested, _ = await imports_a.confirm_item(
                uid_a, attested_session.id, attested_session.items[0].id
            )
            assert attested.evidence == "attested"
            assert attested.links == []

            listed = await workspace_a.get_workspace(uid_a)
            assert any(
                item.id == attested.id and item.evidence == "attested" for item in listed.items
            )

            # A certificate *link* is the only thing that may make it `verified`.
            verified_session = await _create_session(imports_a, uid_a)
            item_id = verified_session.items[0].id
            await imports_a.update_item(
                uid_a,
                verified_session.id,
                item_id,
                {"support": {"kind": "link", "url": _CONFIRM_LINK}},
            )
            verified, review = await imports_a.confirm_item(uid_a, verified_session.id, item_id)
            assert verified.evidence == "verified"
            assert verified.links == [_CONFIRM_LINK]
            assert review.status == "confirmed"
        finally:
            await _tidy(
                workspace_a,
                uid_a,
                workspace_item=attested,
                token=token_a,
                session_id=attested_session.id,
            )
            if verified_session is not None:
                await _tidy(
                    workspace_a,
                    uid_a,
                    workspace_item=verified,
                    token=token_a,
                    session_id=verified_session.id,
                )

    asyncio.run(run())
