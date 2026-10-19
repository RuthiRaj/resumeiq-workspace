"""Opt-in analysis-API integration tests against a real Supabase project (B4).

Skipped by default. To run them, set ``RUN_SUPABASE_INTEGRATION=1`` and user A's
credentials (plus user B's for the isolation test) in ``backend/.env.test`` -- the
same gate as ``test_workspace_integration.py``. See ``tests/supabase_auth.py``.

They also require migration ``0005_analysis.sql`` to be applied (the ``analysis``
column, ``jobs.target_id`` and ``analysis_reports.report``); if it is not, the
whole module skips with that reason instead of failing.

What they prove end to end, with the caller's JWT and real RLS:

* targets, runs (``jobs``) and reports round-trip through the Data API;
* user A cannot read user B's target, run or report, and vice versa;
* the report body survives as JSON in ``analysis_reports``.

Nothing here logs a token, a key or any job-description text.
"""

from __future__ import annotations

import asyncio
import functools
from datetime import UTC, datetime
from uuid import uuid4

import httpx
import pytest

from app.analysis.report import build_analysis_report
from app.repositories.targets import SupabaseTargetRepository
from app.schemas.analysis import AnalysisRun, TargetAnalysisSummary, TargetCreate
from tests import supabase_auth

_TIMEOUT_SECONDS = 15.0

JD = (
    "Live integration target for the B4 analysis API.\n"
    "Requirements\n"
    "- TypeScript\n"
    "- 3+ years of experience\n"
    "- Bachelor's degree\n"
)


def _now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def repo_for(token: str) -> SupabaseTargetRepository:
    settings = supabase_auth.env()
    return SupabaseTargetRepository(
        f"{settings.supabase_url.rstrip('/')}/rest/v1",
        settings.supabase_publishable_key,
        token,
    )


def account_a() -> tuple[SupabaseTargetRepository, str]:
    token = supabase_auth.access_token_a()
    return repo_for(token), supabase_auth.current_user_id(token)


def account_b() -> tuple[SupabaseTargetRepository, str]:
    token = supabase_auth.access_token_b()
    return repo_for(token), supabase_auth.current_user_id(token)


def _delete_target(token: str, target_id: str) -> None:
    """Best-effort cleanup so the test project does not accumulate rows."""
    settings = supabase_auth.env()
    with httpx.Client(timeout=_TIMEOUT_SECONDS) as client:
        client.delete(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/targets",
            params={"id": f"eq.{target_id}"},
            headers={
                "apikey": settings.supabase_publishable_key,
                "Authorization": f"Bearer {token}",
            },
        )


@functools.lru_cache(maxsize=1)
def analysis_schema_status() -> tuple[bool, str]:
    """Read-only probe for the B4 columns (migration 0005)."""
    settings = supabase_auth.env()
    base = settings.supabase_url.rstrip("/")
    try:
        response = httpx.get(
            f"{base}/rest/v1/targets",
            params={"select": "analysis", "limit": "1"},
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
        return True, "targets.analysis exists"
    if code in {"42703", "PGRST204"}:
        return (
            False,
            "migration 0005_analysis.sql is not applied (targets.analysis is missing)",
        )
    if response.status_code in (401, 403) or code in {"42501", "PGRST301"}:
        # The column resolved but `anon` is blocked -- the migration is applied.
        return True, "targets exists (access limited to authenticated users)"
    return False, f"the Data API answered HTTP {response.status_code}"


def _skip_reason() -> tuple[bool, str]:
    if not supabase_auth.enabled():
        return True, supabase_auth.skip_reason()
    available, detail = analysis_schema_status()
    return (not available), detail


_SKIP, _REASON = _skip_reason()
pytestmark = pytest.mark.skipif(_SKIP, reason=_REASON)

_NEEDS_USER_B = pytest.mark.skipif(
    not supabase_auth.isolation_available(),
    reason="isolation tests need SUPABASE_TEST_EMAIL_B / SUPABASE_TEST_PASSWORD_B",
)


def _target_input() -> TargetCreate:
    return TargetCreate(
        role=f"B4 integration {uuid4().hex[:8]}",
        company="Acme Integration",
        jobDescription=JD,
        requiredSkills=["TypeScript"],
        template="precision",
        length="one_page",
    )


def _run(target_id: str, status: str) -> AnalysisRun:
    now = _now_iso()
    return AnalysisRun(
        id=str(uuid4()),
        targetId=target_id,
        status=status,  # type: ignore[arg-type]
        stage="writing",
        stageIndex=5,
        stageCount=6,
        progress=100 if status == "succeeded" else 0,
        workspaceVersion=1,
        startedAt=now,
        updatedAt=now,
        finishedAt=now if status == "succeeded" else None,
    )


def test_target_run_report_round_trip() -> None:
    token = supabase_auth.access_token_a()
    repo, user_id = account_a()
    created = asyncio.run(
        repo.create_target(user_id, _target_input(), target_id=str(uuid4()), created_at=_now_iso())
    )
    try:
        assert created.id and created.status == "draft"

        fetched = asyncio.run(repo.get_target(user_id, created.id))
        assert fetched is not None and fetched.role == created.role

        listed = asyncio.run(repo.list_targets(user_id))
        assert created.id in [target.id for target in listed]

        run = _run(created.id, "running")
        asyncio.run(repo.create_run(user_id, run))
        latest = asyncio.run(repo.latest_run(user_id, created.id))
        assert latest is not None and latest.id == run.id and latest.status == "running"

        finished = _run(created.id, "succeeded")
        finished = finished.model_copy(update={"id": run.id})
        asyncio.run(repo.update_run(user_id, finished))
        latest = asyncio.run(repo.latest_run(user_id, created.id))
        assert latest is not None and latest.status == "succeeded"

        report = build_analysis_report(
            target=fetched,
            items=[],
            workspace_version=1,
            workspace_updated_at=_now_iso(),
            generated_at=_now_iso(),
        )
        asyncio.run(repo.save_report(user_id, report, report_id=str(uuid4())))
        stored = asyncio.run(repo.get_report(user_id, created.id))
        assert stored is not None
        assert stored.score == report.score
        assert [r.id for r in stored.requirements] == [r.id for r in report.requirements]

        summary = TargetAnalysisSummary(
            score=report.score,
            analysedAt=_now_iso(),
            workspaceVersion=1,
            stale=False,
        )
        asyncio.run(
            repo.set_target_analysis(user_id, created.id, summary, "ready", updated_at=_now_iso())
        )
        refreshed = asyncio.run(repo.get_target(user_id, created.id))
        assert refreshed is not None
        assert refreshed.status == "ready"
        assert refreshed.analysis is not None and refreshed.analysis.score == report.score
    finally:
        _delete_target(token, created.id)


@_NEEDS_USER_B
def test_user_b_cannot_see_user_a_target_run_or_report() -> None:
    token_a = supabase_auth.access_token_a()
    repo_a, user_a = account_a()
    repo_b, user_b = account_b()

    created = asyncio.run(
        repo_a.create_target(user_a, _target_input(), target_id=str(uuid4()), created_at=_now_iso())
    )
    try:
        run = _run(created.id, "succeeded")
        asyncio.run(repo_a.create_run(user_a, run))
        target = asyncio.run(repo_a.get_target(user_a, created.id))
        assert target is not None
        report = build_analysis_report(
            target=target,
            items=[],
            workspace_version=1,
            workspace_updated_at=_now_iso(),
            generated_at=_now_iso(),
        )
        asyncio.run(repo_a.save_report(user_a, report, report_id=str(uuid4())))

        # User B sees nothing of A's, on any surface.
        assert asyncio.run(repo_b.get_target(user_b, created.id)) is None
        assert created.id not in [t.id for t in asyncio.run(repo_b.list_targets(user_b))]
        assert asyncio.run(repo_b.latest_run(user_b, created.id)) is None
        assert asyncio.run(repo_b.get_report(user_b, created.id)) is None

        # Even claiming A's user id does not help: RLS decides, not the filter.
        assert asyncio.run(repo_b.get_target(user_a, created.id)) is None
        assert asyncio.run(repo_b.get_report(user_a, created.id)) is None
    finally:
        _delete_target(token_a, created.id)
