"""In-memory target repository (tests and local development).

Mirrors the rules the Supabase implementation must satisfy:

* every read and write is scoped to one ``user_id`` (a caller can never see
  another user's target, run or report -- the isolation tests assert this);
* reports are append-only; the latest one wins;
* a run keeps its full staged progress in one row so polling across requests
  sees the same object.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

from app.schemas.analysis import (
    AnalysisReport,
    AnalysisRun,
    JobTarget,
    JobTargetStatus,
    Requirement,
    TargetAnalysisSummary,
    TargetCreate,
)


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


class InMemoryTargetRepository:
    """Per-user target/run/report state held in memory (tests only)."""

    def __init__(self, clock: Callable[[], str] | None = None) -> None:
        self._clock = clock or _iso_now
        self._targets: dict[str, dict[str, JobTarget]] = {}
        self._runs: dict[str, dict[str, list[AnalysisRun]]] = {}
        self._reports: dict[str, dict[str, list[AnalysisReport]]] = {}
        self._requirements: dict[str, dict[str, list[Requirement]]] = {}

    async def list_targets(self, user_id: str) -> list[JobTarget]:
        targets = list(self._targets.get(user_id, {}).values())
        return [
            target.model_copy(deep=True)
            for target in sorted(targets, key=lambda item: item.updatedAt, reverse=True)
        ]

    async def get_target(self, user_id: str, target_id: str) -> JobTarget | None:
        target = self._targets.get(user_id, {}).get(target_id)
        return target.model_copy(deep=True) if target is not None else None

    async def create_target(
        self,
        user_id: str,
        create: TargetCreate,
        *,
        target_id: str,
        created_at: str,
    ) -> JobTarget:
        target = JobTarget(
            id=target_id,
            role=create.role,
            company=create.company or None,
            jobDescription=create.jobDescription,
            requiredSkills=list(create.requiredSkills),
            template=create.template,
            length=create.length,
            status="draft",
            analysis=None,
            sample=False,
            createdAt=created_at,
            updatedAt=created_at,
        )
        self._targets.setdefault(user_id, {})[target_id] = target
        return target.model_copy(deep=True)

    async def set_target_status(
        self, user_id: str, target_id: str, status: JobTargetStatus, *, updated_at: str
    ) -> None:
        target = self._targets.get(user_id, {}).get(target_id)
        if target is None:
            return
        self._targets[user_id][target_id] = target.model_copy(
            update={"status": status, "updatedAt": updated_at}
        )

    async def set_target_analysis(
        self,
        user_id: str,
        target_id: str,
        analysis: TargetAnalysisSummary | None,
        status: JobTargetStatus,
        *,
        updated_at: str,
    ) -> None:
        target = self._targets.get(user_id, {}).get(target_id)
        if target is None:
            return
        self._targets[user_id][target_id] = target.model_copy(
            update={
                "status": status,
                "analysis": analysis.model_copy(deep=True) if analysis is not None else None,
                "updatedAt": updated_at,
            }
        )

    async def latest_run(self, user_id: str, target_id: str) -> AnalysisRun | None:
        runs = self._runs.get(user_id, {}).get(target_id, [])
        return runs[-1].model_copy(deep=True) if runs else None

    async def create_run(self, user_id: str, run: AnalysisRun) -> None:
        self._runs.setdefault(user_id, {}).setdefault(run.targetId, []).append(
            run.model_copy(deep=True)
        )

    async def update_run(self, user_id: str, run: AnalysisRun) -> None:
        runs = self._runs.setdefault(user_id, {}).setdefault(run.targetId, [])
        for index, existing in enumerate(runs):
            if existing.id == run.id:
                runs[index] = run.model_copy(deep=True)
                return
        runs.append(run.model_copy(deep=True))

    async def get_report(self, user_id: str, target_id: str) -> AnalysisReport | None:
        reports = self._reports.get(user_id, {}).get(target_id, [])
        return reports[-1].model_copy(deep=True) if reports else None

    async def save_report(self, user_id: str, report: AnalysisReport, *, report_id: str) -> None:
        del report_id  # the in-memory store only needs the latest report
        self._reports.setdefault(user_id, {}).setdefault(report.targetId, []).append(
            report.model_copy(deep=True)
        )

    async def save_requirements(
        self, user_id: str, target_id: str, requirements: list[Requirement]
    ) -> None:
        self._requirements.setdefault(user_id, {})[target_id] = [
            requirement.model_copy(deep=True) for requirement in requirements
        ]

    # -- test helpers --------------------------------------------------------
    def stored_requirements(self, user_id: str, target_id: str) -> list[Requirement]:
        return list(self._requirements.get(user_id, {}).get(target_id, []))

    def runs_for(self, user_id: str, target_id: str) -> list[AnalysisRun]:
        return list(self._runs.get(user_id, {}).get(target_id, []))
