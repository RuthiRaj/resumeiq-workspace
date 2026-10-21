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
import contextlib
import functools
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.analysis.report import build_analysis_report
from app.repositories.errors import RepositoryError, ResumeNotFoundError
from app.repositories.resumes import SupabaseResumeRepository
from app.repositories.targets import SupabaseTargetRepository
from app.repositories.workspace import SupabaseWorkspaceRepository
from app.schemas.analysis import TargetCreate
from app.schemas.resume import (
    Claim,
    ResumeClaimEdit,
    ResumeEvidence,
    ResumeRefreshRequest,
    ResumeResponse,
    ResumeSection,
    ResumeSectionEdit,
)
from app.schemas.workspace import WorkspaceItemCreate
from app.services.resume_service import ResumeService
from app.services.standard_resume import build_standard_resume
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


def workspace_repo_for(token: str) -> SupabaseWorkspaceRepository:
    settings = supabase_auth.env()
    return SupabaseWorkspaceRepository(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        settings.supabase_publishable_key,
        token,
    )


def service_for(token: str) -> ResumeService:
    """The real service over PostgREST, bound to one caller's JWT."""
    settings = supabase_auth.env()
    base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
    return ResumeService(
        SupabaseResumeRepository(base, settings.supabase_publishable_key, token),
        SupabaseWorkspaceRepository(base, settings.supabase_publishable_key, token),
        SupabaseTargetRepository(base, settings.supabase_publishable_key, token),
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


def _cleanup(token: str, resume_id: str | None, target_id: str | None) -> None:
    with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
        if resume_id is not None:
            client.delete(
                f"{_rest_url()}/resumes",
                params={"id": f"eq.{resume_id}"},
                headers=_headers(token),
            )
        if target_id is not None:
            client.delete(
                f"{_rest_url()}/targets",
                params={"id": f"eq.{target_id}"},
                headers=_headers(token),
            )


def _tidy_item(repository: SupabaseWorkspaceRepository, user_id: str, item_id: str) -> None:
    """Best-effort soft delete so a failed run leaves no active test item."""
    with contextlib.suppress(RepositoryError):
        _run(repository.soft_delete_item(user_id, item_id))


def _target_input(role: str) -> TargetCreate:
    return TargetCreate(
        role=role,
        company="Example Co",
        jobDescription=(
            "Requirements\n"
            "- Strong TypeScript skills\n"
            "- 3+ years of experience building web applications\n"
        ),
        requiredSkills=["TypeScript"],
        length="one_page",
    )


def _live_item() -> WorkspaceItemCreate:
    return WorkspaceItemCreate(
        section="experience",
        title=f"Live Integration Engineer {uuid4().hex[:8]}",
        organization="Example Co",
        startDate="2021-01",
        endDate="2024-01",
        bullets=["Built the live integration test."],
        tags=["TypeScript"],
        evidence="attested",
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


def test_tailored_resume_generated_from_workspace_round_trips() -> None:
    token = supabase_auth.access_token_a()
    user_id = supabase_auth.current_user_id(token)
    workspace = workspace_repo_for(token)
    targets = target_repo_for(token)
    resumes = resume_repo_for(token)
    service = service_for(token)
    item = _run(workspace.create_item(user_id, _live_item()))
    target_id: str | None = None
    resume_id: str | None = None
    try:
        current = _run(workspace.get_workspace(user_id))
        target = _run(
            targets.create_target(
                user_id,
                _target_input(f"B5 generated {uuid4().hex[:8]}"),
                target_id=str(uuid4()),
                created_at=_now_iso(),
            )
        )
        target_id = target.id
        report = build_analysis_report(
            target=target,
            items=current.items,
            workspace_version=current.version,
            workspace_updated_at=current.updatedAt,
            generated_at=_now_iso(),
        )
        _run(targets.save_report(user_id, report, report_id=str(uuid4())))
        generated = _run(service.generate(user_id, target.id))
        resume_id = generated.id
        assert generated.kind == "tailored"
        assert generated.targetId == target.id
        assert generated.workspaceVersion == current.version

        stored = _run(resumes.get_resume(user_id, resume_id))
        assert stored is not None
        assert any(entry.itemId == item.id for entry in stored.evidence)
        fetched = _run(service.get_resume(user_id, resume_id))
        assert fetched.id == resume_id
        assert any(
            item.id in claim.evidenceIds for section in fetched.sections for claim in section.claims
        )
        versions = _run(resumes.list_versions(user_id, resume_id))
        assert len(versions) == 1
        assert versions[0].reason == "generated"
        snapshot = _run(resumes.get_version_snapshot(user_id, resume_id, versions[0].id))
        assert snapshot is not None
        assert any(entry.itemId == item.id for entry in snapshot.evidence)
    finally:
        _cleanup(token, resume_id, target_id)
        _tidy_item(workspace, user_id, item.id)


def test_deleted_workspace_item_flags_tailored_and_removes_it_from_standard() -> None:
    token = supabase_auth.access_token_a()
    user_id = supabase_auth.current_user_id(token)
    workspace = workspace_repo_for(token)
    targets = target_repo_for(token)
    resumes = resume_repo_for(token)
    service = service_for(token)
    item = _run(workspace.create_item(user_id, _live_item()))
    kept = _run(
        workspace.create_item(
            user_id,
            WorkspaceItemCreate(
                section="skill",
                title=f"Live Skill {uuid4().hex[:8]}",
                tags=["TypeScript"],
                evidence="attested",
            ),
        )
    )
    target_id: str | None = None
    resume_id: str | None = None
    try:
        current = _run(workspace.get_workspace(user_id))
        target = _run(
            targets.create_target(
                user_id,
                _target_input(f"B5 stale {uuid4().hex[:8]}"),
                target_id=str(uuid4()),
                created_at=_now_iso(),
            )
        )
        target_id = target.id
        report = build_analysis_report(
            target=target,
            items=current.items,
            workspace_version=current.version,
            workspace_updated_at=current.updatedAt,
            generated_at=_now_iso(),
        )
        _run(targets.save_report(user_id, report, report_id=str(uuid4())))
        generated = _run(service.generate(user_id, target.id))
        resume_id = generated.id
        stored = _run(resumes.get_resume(user_id, resume_id))
        assert stored is not None
        assert any(entry.itemId == item.id for entry in stored.evidence)

        _run(workspace.soft_delete_item(user_id, item.id))
        after = _run(workspace.get_workspace(user_id))
        assert after.version > current.version

        standard = build_standard_resume(after)
        standard_claims = [claim for section in standard.sections for claim in section.claims]
        assert standard_claims
        assert all(item.id not in claim.evidenceIds for claim in standard_claims)
        assert all(item.title not in claim.text for claim in standard_claims)

        tailored = _run(service.get_resume(user_id, resume_id))
        assert tailored.stale is True
        assert item.id in tailored.removedEvidenceIds
        assert any(
            item.id in claim.evidenceIds and claim.removed
            for section in tailored.sections
            for claim in section.claims
        )
        diff = _run(service.diff(user_id, resume_id))
        assert diff.stale is True
        assert item.id in diff.removedEvidenceIds
        assert any(entry.itemId == item.id for entry in diff.removed)
    finally:
        _cleanup(token, resume_id, target_id)
        _tidy_item(workspace, user_id, item.id)
        _tidy_item(workspace, user_id, kept.id)


@_NEEDS_USER_B
def test_user_a_cannot_read_edit_refresh_or_restore_user_b_resume_or_versions() -> None:
    token_a = supabase_auth.access_token_a()
    token_b = supabase_auth.access_token_b()
    user_a = supabase_auth.current_user_id(token_a)
    user_b = supabase_auth.current_user_id(token_b)
    resumes_a = resume_repo_for(token_a)
    resumes_b = resume_repo_for(token_b)
    targets_b = target_repo_for(token_b)
    service_a = service_for(token_a)
    now = _now_iso()
    target = _run(
        targets_b.create_target(
            user_b,
            _target_input(f"B5 isolation {uuid4().hex[:8]}"),
            target_id=str(uuid4()),
            created_at=now,
        )
    )
    resume, evidence = _resume(target.id)
    try:
        _run(resumes_b.create_resume(user_b, resume, evidence, reason="generated"))
        versions_b = _run(resumes_b.list_versions(user_b, resume.id))
        assert len(versions_b) == 1
        version_id = versions_b[0].id

        # Repository reads are scoped to A and RLS returns no rows for B's data.
        assert _run(resumes_a.get_resume(user_a, resume.id)) is None
        assert _run(resumes_a.list_versions(user_a, resume.id)) == []
        assert _run(resumes_a.get_version_snapshot(user_a, resume.id, version_id)) is None

        # Raw PostgREST reads and an edit attempt return nothing for A.
        with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
            response = client.get(
                f"{_rest_url()}/resumes",
                params={"id": f"eq.{resume.id}", "select": "id,title"},
                headers=_headers(token_a),
            )
            versions = client.get(
                f"{_rest_url()}/resume_versions",
                params={"resume_id": f"eq.{resume.id}", "select": "id"},
                headers=_headers(token_a),
            )
            edited = client.patch(
                f"{_rest_url()}/resumes",
                params={"id": f"eq.{resume.id}"},
                json={"title": "hijacked"},
                headers={**_headers(token_a), "Prefer": "return=representation"},
            )
        assert response.status_code == 200
        assert response.json() == []
        assert versions.status_code == 200
        assert versions.json() == []
        assert edited.status_code == 200
        assert edited.json() == []

        # The service cannot edit, refresh or restore a resume it cannot read.
        edit = ResumeSectionEdit(
            claims=[ResumeClaimEdit(text="Hijacked claim", evidenceIds=[str(uuid4())])]
        )
        with pytest.raises(ResumeNotFoundError):
            _run(service_a.edit_section(user_a, resume.id, "experience", edit))
        with pytest.raises(ResumeNotFoundError):
            _run(service_a.refresh(user_a, resume.id, ResumeRefreshRequest()))
        with pytest.raises(ResumeNotFoundError):
            _run(service_a.restore(user_a, resume.id, version_id))

        # B's resume and history are unchanged by every attempt above.
        stored = _run(resumes_b.get_resume(user_b, resume.id))
        assert stored is not None
        assert stored.resume.title == "Integration resume"
        assert len(_run(resumes_b.list_versions(user_b, resume.id))) == 1
    finally:
        _cleanup(token_b, resume.id, target.id)
