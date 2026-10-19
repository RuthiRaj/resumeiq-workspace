"""Job-target persistence: interface + Supabase Data API implementation (B4).

Same data-access rule as the workspace and imports (ADR-016): every call goes
through the Data API (PostgREST) with the *caller's* JWT, so Postgres sees
``auth.uid()`` and Row Level Security applies end to end. The ``service_role``
key is never used.

Tables reused (no new tables -- see ``db/migrations/0005_analysis.sql``):

* ``targets``          -- one row per job posting + its latest analysis summary;
* ``jd_requirements``  -- the requirements snapshot for the latest report;
* ``analysis_reports`` -- the immutable report payload (insert-only by RLS);
* ``jobs``             -- one row per analysis run, carrying staged progress so
  polling works across requests.

The wire shapes are in ``app.schemas.analysis``; this module only maps rows.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx

from app.repositories.errors import DataApiNotConfiguredError, RepositoryError
from app.repositories.workspace import (
    _as_dict,
    _as_list,
    _opt_str,
    _safe_json,
)
from app.schemas.analysis import (
    AnalysisReport,
    AnalysisRun,
    AnalysisRunStatus,
    JobTarget,
    JobTargetStatus,
    Requirement,
    ResumeTemplate,
    TargetAnalysisSummary,
    TargetCreate,
    TargetLength,
)

_WIRE_TEMPLATES: frozenset[str] = frozenset({"precision", "classic", "compact"})
_WIRE_LENGTHS: frozenset[str] = frozenset({"one_page", "two_page"})
_WIRE_TARGET_STATUSES: frozenset[str] = frozenset({"draft", "analyzing", "ready", "failed"})
_WIRE_RUN_STATUSES: frozenset[str] = frozenset({"running", "succeeded", "failed"})

_TARGET_SELECT = (
    "id,role,company,jd_text,required_skills,template,length,status,analysis,created_at,updated_at"
)


def _as_template(value: object) -> ResumeTemplate | None:
    text = str(value or "").strip()
    return text if text in _WIRE_TEMPLATES else None  # type: ignore[return-value]


def _as_length(value: object) -> TargetLength | None:
    text = str(value or "").strip().replace("-", "_")
    return text if text in _WIRE_LENGTHS else None  # type: ignore[return-value]


def _as_target_status(value: object) -> JobTargetStatus:
    text = str(value or "").strip()
    return text if text in _WIRE_TARGET_STATUSES else "draft"  # type: ignore[return-value]


def _as_run_status(value: object) -> AnalysisRunStatus:
    text = str(value or "").strip()
    if text in _WIRE_RUN_STATUSES:
        return text  # type: ignore[return-value]
    # ``queued`` is the DB's initial state; the wire only knows these three.
    return "running"


def _as_summary(value: object) -> TargetAnalysisSummary | None:
    payload = _as_dict(value)
    if not payload:
        return None
    try:
        return TargetAnalysisSummary.model_validate(payload)
    except ValueError:
        return None


def target_from_row(row: dict[str, object]) -> JobTarget:
    """Map a ``targets`` row to the wire ``JobTarget``."""
    return JobTarget(
        id=str(row.get("id")),
        role=str(row.get("role", "")),
        company=_opt_str(row.get("company")),
        jobDescription=str(row.get("jd_text", "")),
        requiredSkills=[str(skill) for skill in _as_list(row.get("required_skills"))],
        template=_as_template(row.get("template")),
        length=_as_length(row.get("length")),
        status=_as_target_status(row.get("status")),
        analysis=_as_summary(row.get("analysis")),
        sample=False,
        createdAt=str(row.get("created_at", "")),
        updatedAt=str(row.get("updated_at") or row.get("created_at", "")),
    )


def run_from_job(row: dict[str, object]) -> AnalysisRun | None:
    """Map a ``jobs`` row back to the wire ``AnalysisRun`` (payload is canonical)."""
    payload = _as_dict(row.get("payload"))
    stored = _as_dict(payload.get("run"))
    if stored:
        try:
            return AnalysisRun.model_validate(stored)
        except ValueError:
            return None
    return None


@runtime_checkable
class TargetRepository(Protocol):
    """Per-user target/run/report persistence, always scoped to ``user_id``."""

    async def list_targets(self, user_id: str) -> list[JobTarget]: ...

    async def get_target(self, user_id: str, target_id: str) -> JobTarget | None: ...

    async def create_target(
        self,
        user_id: str,
        create: TargetCreate,
        *,
        target_id: str,
        created_at: str,
    ) -> JobTarget: ...

    async def set_target_status(
        self, user_id: str, target_id: str, status: JobTargetStatus, *, updated_at: str
    ) -> None: ...

    async def set_target_analysis(
        self,
        user_id: str,
        target_id: str,
        analysis: TargetAnalysisSummary | None,
        status: JobTargetStatus,
        *,
        updated_at: str,
    ) -> None: ...

    async def latest_run(self, user_id: str, target_id: str) -> AnalysisRun | None: ...

    async def create_run(self, user_id: str, run: AnalysisRun) -> None: ...

    async def update_run(self, user_id: str, run: AnalysisRun) -> None: ...

    async def get_report(self, user_id: str, target_id: str) -> AnalysisReport | None: ...

    async def save_report(
        self, user_id: str, report: AnalysisReport, *, report_id: str
    ) -> None: ...

    async def save_requirements(
        self, user_id: str, target_id: str, requirements: list[Requirement]
    ) -> None: ...


class SupabaseTargetRepository:
    """PostgREST-backed repository. One instance per request, bound to one JWT."""

    def __init__(
        self,
        rest_url: str,
        publishable_key: str,
        access_token: str,
        *,
        timeout: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not rest_url or not publishable_key:
            raise DataApiNotConfiguredError("Supabase Data API is not configured.")
        self._base = rest_url.rstrip("/")
        self._headers = {
            "apikey": publishable_key,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }
        self._timeout = timeout
        self._transport = transport

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json: object | None = None,
        prefer: str | None = None,
    ) -> httpx.Response:
        headers = dict(self._headers)
        if prefer is not None:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(
            base_url=self._base,
            headers=headers,
            timeout=self._timeout,
            transport=self._transport,
        ) as client:
            return await client.request(method, path, params=params, json=json)

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        body = _as_dict(_safe_json(response))
        raise RepositoryError(
            f"Data API error {response.status_code}: {body.get('message', 'unknown')}"
        )

    async def list_targets(self, user_id: str) -> list[JobTarget]:
        response = await self._request(
            "GET",
            "/targets",
            params={
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "select": _TARGET_SELECT,
                "order": "updated_at.desc",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return [target_from_row(row) for row in rows]

    async def get_target(self, user_id: str, target_id: str) -> JobTarget | None:
        response = await self._request(
            "GET",
            "/targets",
            params={
                "id": f"eq.{target_id}",
                "user_id": f"eq.{user_id}",
                "deleted_at": "is.null",
                "select": _TARGET_SELECT,
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return target_from_row(rows[0]) if rows else None

    async def create_target(
        self,
        user_id: str,
        create: TargetCreate,
        *,
        target_id: str,
        created_at: str,
    ) -> JobTarget:
        row: dict[str, object] = {
            "id": target_id,
            "user_id": user_id,
            "role": create.role,
            "company": create.company or None,
            "jd_text": create.jobDescription,
            "required_skills": list(create.requiredSkills),
            "template": create.template,
            "length": create.length,
            "status": "draft",
            "created_at": created_at,
            "updated_at": created_at,
        }
        response = await self._request("POST", "/targets", json=row)
        self._raise_for_status(response)
        rows = [_as_dict(item) for item in _as_list(_safe_json(response))]
        if not rows:
            # PostgREST returns the inserted row because of ``Prefer``; fall back
            # to the values we just wrote if a proxy stripped the body.
            return target_from_row(row)
        return target_from_row(rows[0])

    async def set_target_status(
        self, user_id: str, target_id: str, status: JobTargetStatus, *, updated_at: str
    ) -> None:
        response = await self._request(
            "PATCH",
            "/targets",
            params={"id": f"eq.{target_id}", "user_id": f"eq.{user_id}"},
            json={"status": status, "updated_at": updated_at},
            prefer="return=minimal",
        )
        self._raise_for_status(response)

    async def set_target_analysis(
        self,
        user_id: str,
        target_id: str,
        analysis: TargetAnalysisSummary | None,
        status: JobTargetStatus,
        *,
        updated_at: str,
    ) -> None:
        response = await self._request(
            "PATCH",
            "/targets",
            params={"id": f"eq.{target_id}", "user_id": f"eq.{user_id}"},
            json={
                "status": status,
                "analysis": analysis.model_dump(mode="json") if analysis is not None else None,
                "updated_at": updated_at,
            },
            prefer="return=minimal",
        )
        self._raise_for_status(response)

    async def latest_run(self, user_id: str, target_id: str) -> AnalysisRun | None:
        response = await self._request(
            "GET",
            "/jobs",
            params={
                "user_id": f"eq.{user_id}",
                "kind": "eq.analysis",
                "target_id": f"eq.{target_id}",
                "select": "id,status,payload,error,created_at,updated_at",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        return run_from_job(rows[0]) if rows else None

    async def create_run(self, user_id: str, run: AnalysisRun) -> None:
        row = {
            "id": run.id,
            "user_id": user_id,
            "kind": "analysis",
            "target_id": run.targetId,
            "status": run.status,
            "payload": {"targetId": run.targetId, "run": run.model_dump(mode="json")},
            "created_at": run.startedAt,
            "updated_at": run.updatedAt,
        }
        response = await self._request("POST", "/jobs", json=row, prefer="return=minimal")
        self._raise_for_status(response)

    async def update_run(self, user_id: str, run: AnalysisRun) -> None:
        response = await self._request(
            "PATCH",
            "/jobs",
            params={"id": f"eq.{run.id}", "user_id": f"eq.{user_id}"},
            json={
                "status": run.status,
                "payload": {"targetId": run.targetId, "run": run.model_dump(mode="json")},
                "error": run.failure.message if run.failure is not None else None,
                "updated_at": run.updatedAt,
            },
            prefer="return=minimal",
        )
        self._raise_for_status(response)

    async def get_report(self, user_id: str, target_id: str) -> AnalysisReport | None:
        response = await self._request(
            "GET",
            "/analysis_reports",
            params={
                "user_id": f"eq.{user_id}",
                "target_id": f"eq.{target_id}",
                "select": "report",
                "order": "created_at.desc",
                "limit": "1",
            },
        )
        self._raise_for_status(response)
        rows = [_as_dict(row) for row in _as_list(_safe_json(response))]
        if not rows:
            return None
        payload = _as_dict(rows[0].get("report"))
        if not payload:
            return None
        try:
            return AnalysisReport.model_validate(payload)
        except ValueError:
            return None

    async def save_report(self, user_id: str, report: AnalysisReport, *, report_id: str) -> None:
        row = {
            "id": report_id,
            "user_id": user_id,
            "target_id": report.targetId,
            "score": int(report.score),
            "factors": [factor.model_dump(mode="json") for factor in report.factors],
            "requirements_snapshot": [
                requirement.model_dump(mode="json") for requirement in report.requirements
            ],
            "roadmap": [step.model_dump(mode="json") for step in report.roadmap],
            "ats": report.ats.model_dump(mode="json"),
            "methodology_version": "v1",
            "report": report.model_dump(mode="json"),
            "workspace_version": report.workspaceVersion,
            "generated_at": report.generatedAt,
            "ai_used": report.aiUsed,
        }
        response = await self._request(
            "POST", "/analysis_reports", json=row, prefer="return=minimal"
        )
        self._raise_for_status(response)

    async def save_requirements(
        self, user_id: str, target_id: str, requirements: list[Requirement]
    ) -> None:
        deleted = await self._request(
            "DELETE",
            "/jd_requirements",
            params={"user_id": f"eq.{user_id}", "target_id": f"eq.{target_id}"},
            prefer="return=minimal",
        )
        self._raise_for_status(deleted)
        if not requirements:
            return
        rows = [
            {
                "user_id": user_id,
                "target_id": target_id,
                "text": requirement.text,
                "kind": requirement.kind,
                "status": requirement.status,
                "gap_type": requirement.gapType,
                "evidence_ids": list(requirement.evidenceIds),
                "pattern": requirement.pattern,
                "explanation": requirement.explanation,
                "position": index,
            }
            for index, requirement in enumerate(requirements)
        ]
        response = await self._request(
            "POST", "/jd_requirements", json=rows, prefer="return=minimal"
        )
        self._raise_for_status(response)
