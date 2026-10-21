"""Opt-in resume integration/isolation tests against a real Supabase project (B5).

Skipped by default. Enable with ``RUN_SUPABASE_INTEGRATION=1`` and user A/B
credentials in ``backend/.env.test`` (see ``tests/supabase_auth.py``).

They also require migration ``0007_resumes.sql`` (the new resume/claim columns);
if it is not applied, the module skips with that reason instead of failing.

What they prove with the caller's JWT and real RLS:

* a tailored resume, its evidence snapshot and its first version round-trip
  through the Data API;
* user B cannot read user A's resume, version or claims -- the repository returns
  ``None``/an empty list and a raw PostgREST select comes back empty.

Nothing here logs a token, a key, or any resume/job text.
"""

from __future__ import annotations

import asyncio
import functools
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.repositories.resumes import SupabaseResumeRepository
from app.repositories.targets import SupabaseTargetRepository
from app.schemas.analysis import TargetCreate
from app.schemas.resume import Claim, ResumeEvidence, ResumeResponse, ResumeSection
from tests import supabase_auth

_TIMEOUT_SECONDS = 15.0


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _headers(token: str) -> dict[str, str]:
    settings = supabase_auth.env()
    return {
        "apikey": settings.supabase_publishable_key,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _rest_url() -> str:
    return f"{supabase_auth.env().supabase_url.rstrip('/')}/rest/v1"


def resume_repo_for(token: str) -> SupabaseResumeRepository:
    settings = supabase_auth.env()
    return SupabaseResumeRepository(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        settings.supabase_publishable_key,
        token,
    )


def target_repo_for(token: str) -> SupabaseTargetRepository:
    settings = supabase_auth.env()
    return SupabaseTargetRepository(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        settings.supabase_publishable_key,
        token,
    )


@functools.lru_cache(maxsize=1)
def resume_schema_status() -> tuple[bool, str]:
    """Read-only probe for the B5 columns (migration 0007)."""
    settings = supabase_auth.env()
    try:
        response = httpx.get(
            f"{supabase_auth.env().supabase_url.rstrip('/')}/rest/v1/resumes",
            params={"select": "title,ai_used,ats,edited_sections,source_evidence", "limit": "1"},
            headers={
                "apikey": settings.supabase_publishable_key,
                "Accept": "application/json",
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        return False, f"the Data API could not be reached ({type(exc).__name__})"

    body: object
    try:
        body = response.json()
    except ValueError:
        body = None
    code = str(body.get("code", "")) if isinstance(body, dict) else ""
    if response.status_code < 400:
        return True, "resumes B5 columns exist"
    if code in {"42703", "PGRST204"}:
        return (
            False,
            "migration 0007_resumes.sql is not applied (resume columns are missing)",
        )
    if response.status_code in (401, 403) or code in {"42501", "PGRST301"}:
        return True, "resumes exists (access limited to authenticated users)"
    return False, f"the Data API answered HTTP {response.status_code}"


def _skip_reason() -> tuple[bool, str]:
    if not supabase_auth.enabled():
        return True, supabase_auth.skip_reason()
    available, detail = resume_schema_status()
    return (not available), detail


_SKIP, _REASON = _skip_reason()
pytestmark = pytest.mark.skipif(_SKIP, reason=_REASON)

_NEEDS_USER_B = pytest.mark.skipif(
    not supabase_auth.isolation_available(),
    reason="isolation tests need SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B",
)


def _resume(target_id: str) -> tuple[ResumeResponse, list[ResumeEvidence]]:
    now = _now_iso()
    evidence = ResumeEvidence(
        itemId=str(uuid4()),
        section="experience",
        title="Integration Engineer",
        organization="Example Co",
        startDate="2021-01",
        endDate="2024-01",
        bullets=["Built the integration test."],
        tags=["Python"],
        evidence="attested",
        order=1,
        fingerprint="integration-fingerprint",
    )
    resume = ResumeResponse(
        id=str(uuid4()),
        kind="tailored",
        targetId=target_id,
        title="Integration resume",
        workspaceVersion=7,
        stale=False,
        sections=[
            ResumeSection(
                key="experience",
                claims=[
                    Claim(
                        text="Integration Engineer · Example Co · 2021-01 – 2024-01",
                        evidenceIds=[evidence.itemId],
                        confirmed=True,
                    )
                ],
            )
        ],
        createdAt=now,
        updatedAt=now,
    )
    return resume, [evidence]


def _cleanup(token: str, resume_id: str, target_id: str) -> None:
    with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
        client.delete(
            f"{_rest_url()}/resumes",
            params={"id": f"eq.{resume_id}"},
            headers=_headers(token),
        )
        client.delete(
            f"{_rest_url()}/targets",
            params={"id": f"eq.{target_id}"},
            headers=_headers(token),
        )


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_resume_round_trips_and_versions_are_insert_only() -> None:
    token = supabase_auth.access_token_a()
    user_id = supabase_auth.current_user_id(token)
    resumes = resume_repo_for(token)
    targets = target_repo_for(token)
    now = _now_iso()
    target = _run(
        targets.create_target(
            user_id,
            TargetCreate(
                role=f"B5 integration {uuid4().hex[:8]}",
                company="Example Co",
                jobDescription="TypeScript React role with three years of experience.",
                requiredSkills=["TypeScript"],
            ),
            target_id=str(uuid4()),
            created_at=now,
        )
    )
    resume, evidence = _resume(target.id)
    try:
        created = _run(resumes.create_resume(user_id, resume, evidence, reason="generated"))
        assert created.resume.id == resume.id
        assert created.resume.title == "Integration resume"
        assert created.resume.workspaceVersion == 7
        assert len(created.evidence) == 1

        fetched = _run(resumes.get_resume(user_id, resume.id))
        assert fetched is not None
        assert fetched.resume.sections[0].claims[0].text.startswith("Integration Engineer")
        assert fetched.evidence[0].itemId == evidence[0].itemId

        versions = _run(resumes.list_versions(user_id, resume.id))
        assert len(versions) == 1
        assert versions[0].reason == "generated"
        snapshot = _run(resumes.get_version_snapshot(user_id, resume.id, versions[0].id))
        assert snapshot is not None
        assert snapshot.evidence[0].itemId == evidence[0].itemId

        # Claims were persisted with their section/evidence link.
        with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
            claims = client.get(
                f"{_rest_url()}/resume_claims",
                params={
                    "resume_id": f"eq.{resume.id}",
                    "select": "section,position,ai_rewritten,evidence_ids",
                },
                headers=_headers(token),
            )
        assert claims.status_code == 200, claims.status_code
        rows = claims.json()
        assert len(rows) == 1
        assert rows[0]["section"] == "experience"
        assert rows[0]["position"] == 0
        assert rows[0]["evidence_ids"] == [evidence[0].itemId]
    finally:
        _cleanup(token, resume.id, target.id)


@_NEEDS_USER_B
def test_user_b_cannot_read_user_a_resume_or_versions() -> None:
    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b()
    user_a = supabase_auth.current_user_id(token_a)
    user_b = supabase_auth.current_user_id(token_b)
    resumes_a = resume_repo_for(token_a)
    resumes_b = resume_repo_for(token_b)
    targets_a = target_repo_for(token_a)
    now = _now_iso()
    target = _run(
        targets_a.create_target(
            user_a,
            TargetCreate(
                role=f"B5 isolation {uuid4().hex[:8]}",
                company="Example Co",
                jobDescription="TypeScript React role with three years of experience.",
                requiredSkills=["TypeScript"],
            ),
            target_id=str(uuid4()),
            created_at=now,
        )
    )
    resume, evidence = _resume(target.id)
    try:
        _run(resumes_a.create_resume(user_a, resume, evidence, reason="generated"))

        assert _run(resumes_b.get_resume(user_b, resume.id)) is None
        assert _run(resumes_b.list_resumes(user_b)) == []
        assert _run(resumes_b.list_versions(user_b, resume.id)) == []
        assert _run(resumes_b.get_version_snapshot(user_b, resume.id, str(uuid4()))) is None

        # RLS itself (not just the repository filters) returns nothing for B.
        with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
            response = client.get(
                f"{_rest_url()}/resumes",
                params={"id": f"eq.{resume.id}", "select": "id,title"},
                headers=_headers(token_b),
            )
            versions = client.get(
                f"{_rest_url()}/resume_versions",
                params={"resume_id": f"eq.{resume.id}", "select": "id"},
                headers=_headers(token_b),
            )
        assert response.status_code == 200
        assert response.json() == []
        assert versions.status_code == 200
        assert versions.json() == []
    finally:
        _cleanup(token_a, resume.id, target.id)
