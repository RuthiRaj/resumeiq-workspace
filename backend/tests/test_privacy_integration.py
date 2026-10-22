"""Opt-in B6 privacy integration/isolation tests against real Supabase (B6).

Skipped by default. Enable with ``RUN_SUPABASE_INTEGRATION=1`` and user A/B
credentials in ``backend/.env.test`` (see ``tests/supabase_auth.py``). They also
require migration ``0008_privacy.sql``; the module skips with that reason while
the RPCs are absent.

Safety rules for this module:

* it never deletes a test *account*: account deletion is only probed without a
  bearer token, where ``auth.uid()`` is null and the function refuses before any
  write, or through the service with a wrong confirmation (which never reaches
  the repository);
* every created resume/item is disposable and is removed or soft-deleted;
* nothing logs a token, key, row content or the confirmation phrase.
"""

from __future__ import annotations

import asyncio
import functools
from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.repositories.data_export import SupabaseDataExportRepository
from app.repositories.errors import AccountConfirmationError
from app.repositories.resumes import SupabaseResumeRepository
from app.repositories.workspace import SupabaseWorkspaceRepository
from app.schemas.resume import Claim, ResumeEvidence, ResumeResponse, ResumeSection
from app.schemas.workspace import WorkspaceItemCreate
from app.services.privacy_service import PrivacyService
from tests import supabase_auth

_TIMEOUT_SECONDS = 20.0


def _rest_url() -> str:
    return f"{supabase_auth.env().supabase_url.rstrip('/')}/rest/v1"


def _headers(token: str) -> dict[str, str]:
    return {
        "apikey": supabase_auth.env().supabase_publishable_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _repo(token: str) -> SupabaseDataExportRepository:
    settings = supabase_auth.env()
    return SupabaseDataExportRepository(_rest_url(), settings.supabase_publishable_key, token)


@functools.lru_cache(maxsize=1)
def privacy_schema_status() -> tuple[bool, str]:
    """Probe the 0008 RPC without credentials (it must refuse before deleting)."""
    settings = supabase_auth.env()
    try:
        response = httpx.post(
            f"{_rest_url()}/rpc/api_account_delete_data",
            headers={
                "apikey": settings.supabase_publishable_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={},
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        return False, f"the Data API could not be reached ({type(exc).__name__})"

    try:
        body = response.json()
    except ValueError:
        body = None
    code = str(body.get("code", "")) if isinstance(body, dict) else ""
    if response.status_code < 400:
        # Never expected; refusing to run is safer than continuing.
        return False, "refusing to run: an unauthenticated delete RPC succeeded"
    if response.status_code == 404 or code == "PGRST202":
        return False, "migration 0008_privacy.sql is not applied (RPC is missing)"
    return True, "privacy RPC exists and refuses an unauthenticated caller"


def _skip_reason() -> tuple[bool, str]:
    if not supabase_auth.enabled():
        return True, supabase_auth.skip_reason()
    return (not privacy_schema_status()[0], privacy_schema_status()[1])


_SKIP, _REASON = _skip_reason()
pytestmark = pytest.mark.skipif(_SKIP, reason=_REASON)

_NEEDS_USER_B = pytest.mark.skipif(
    not supabase_auth.isolation_available(),
    reason="isolation tests need SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B",
)


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _resume(subject: str) -> tuple[ResumeResponse, list[ResumeEvidence]]:
    now = _now_iso()
    item_id = str(uuid4())
    evidence = ResumeEvidence(
        itemId=item_id,
        section="experience",
        title="Privacy Integration Engineer",
        organization="Example Co",
        startDate="2021-01",
        endDate="2024-01",
        bullets=["Validated the B6 isolation path."],
        tags=["Python"],
        evidence="attested",
        order=1,
        fingerprint=f"privacy-{subject}",
    )
    resume = ResumeResponse(
        id=str(uuid4()),
        kind="tailored",
        targetId=None,
        title="B6 privacy integration",
        workspaceVersion=1,
        stale=False,
        sections=[
            ResumeSection(
                key="experience",
                claims=[
                    Claim(
                        text="Privacy Integration Engineer · Example Co · 2021-01 – 2024-01",
                        evidenceIds=[item_id],
                        confirmed=True,
                    )
                ],
            )
        ],
        createdAt=now,
        updatedAt=now,
    )
    return resume, [evidence]


@_NEEDS_USER_B
def test_export_is_isolated_between_a_and_b() -> None:
    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b()
    user_a = supabase_auth.current_user_id(token_a)

    settings = supabase_auth.env()
    workspace_a = SupabaseWorkspaceRepository(
        _rest_url(), settings.supabase_publishable_key, token_a
    )
    item = asyncio.run(
        workspace_a.create_item(
            user_a,
            WorkspaceItemCreate(
                section="skill",
                title="B6 isolation probe",
                tags=["Python"],
                evidence="attested",
            ),
        )
    )

    try:
        export_a = asyncio.run(_repo(token_a).export_user(user_a))
        rows_a: list[dict[str, Any]] = [row for rows in export_a.tables.values() for row in rows]
        assert all(str(row.get("user_id")) == user_a for row in rows_a)
        assert any(str(row.get("id")) == item.id for row in export_a.tables["workspace"])

        user_b = supabase_auth.current_user_id(token_b)
        export_b = asyncio.run(_repo(token_b).export_user(user_b))
        rows_b: list[dict[str, Any]] = [row for rows in export_b.tables.values() for row in rows]
        assert all(str(row.get("user_id")) == user_b for row in rows_b)
        assert all(str(row.get("id")) != item.id for row in rows_b)
    finally:
        asyncio.run(workspace_a.soft_delete_item(user_a, item.id))


@_NEEDS_USER_B
def test_version_delete_is_owner_scoped_and_cascades_on_resume_delete() -> None:
    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b()
    user_a = supabase_auth.current_user_id(token_a)

    settings = supabase_auth.env()
    repo_a = SupabaseResumeRepository(_rest_url(), settings.supabase_publishable_key, token_a)
    repo_b = SupabaseResumeRepository(_rest_url(), settings.supabase_publishable_key, token_b)
    resume, evidence = _resume(user_a)

    async def scenario() -> None:
        await repo_a.create_resume(user_a, resume, evidence, reason="generated")
        versions = await repo_a.list_versions(user_a, resume.id)
        assert len(versions) == 1

        # B cannot even see A's resume, so the delete is a scoped no-op.
        assert await repo_b.delete_version(user_a, resume.id, versions[0].id) is False
        assert await repo_b.delete_resume(user_a, resume.id) is False
        assert await repo_a.get_resume(user_a, resume.id) is not None

        # A can delete its own version; the resume remains.
        assert await repo_a.delete_version(user_a, resume.id, versions[0].id) is True
        assert await repo_a.list_versions(user_a, resume.id) == []

    asyncio.run(scenario())
    # Cleanup: the explicit B6 delete also cascades any remaining claims.
    asyncio.run(repo_a.delete_resume(user_a, resume.id))
    assert asyncio.run(repo_a.get_resume(user_a, resume.id)) is None


def test_wrong_confirmation_never_reaches_the_destructive_rpc() -> None:
    token = supabase_auth.access_token_a()
    subject = supabase_auth.current_user_id(token)
    service = PrivacyService(_repo(token))

    with pytest.raises(AccountConfirmationError):
        asyncio.run(service.delete_account(subject, "delete"))
