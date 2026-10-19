"""Analysis service (B4, PRD §6.4–6.7): targets, runs and reports.

The service owns the rules the repositories and the engine cannot express:

* every call is scoped to the caller's own workspace (targets are read with the
  caller's JWT, so RLS enforces isolation end to end);
* a run is *staged* (six theatre stages) and its progress is persisted, so
  polling across requests always sees the same run;
* the deterministic engine produces the report; the optional AI enricher can
  only refine requirement extraction and rewrite gap prose, never a status,
  evidence link or score (see ``app/analysis/enrichment.py``);
* failures are recorded as a typed run failure + ``target.status = "failed"``
  and never leak job-description or resume text into logs.

Execution model (documented in ADR-031): the run executes as a FastAPI
``BackgroundTask`` -- in-process, after the response is sent. That is fine for
the free single-instance host this ships on, but it means: **no multi-worker
deployment** (another worker cannot see the in-memory task), and a process
restart loses an in-flight run (it stays ``running`` until it is restarted).
The gateway quota and caches are per-process for the same reason.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from app.ai.consent import ConsentGrant
from app.analysis import (
    assemble_report,
    build_evidence_index,
    extract_requirements,
    match_requirements,
)
from app.analysis.enrichment import AnalysisEnricher
from app.analysis.numeric import js_round
from app.core.logging import get_logger
from app.repositories.errors import (
    AnalysisAlreadyRunningError,
    AnalysisRunNotFoundError,
    ReportNotReadyError,
    RepositoryError,
    TargetNotFoundError,
)
from app.repositories.targets import TargetRepository
from app.repositories.workspace import WorkspaceRepository
from app.schemas.analysis import (
    ANALYSIS_STAGE_COUNT,
    ANALYSIS_STAGES,
    AnalysisFailure,
    AnalysisReport,
    AnalysisRun,
    AnalysisRunResponse,
    AnalysisStageKey,
    JobTarget,
    TargetAnalysisSummary,
    TargetCreate,
)

logger = get_logger(__name__)

#: ``BackgroundTasks.add_task`` -- injected so tests can run the job inline.
Schedule = Callable[..., Any]

#: Per-stage timings, copied from the F4 theatre (frontend/src/lib/schemas/
#: analysis.ts) so the persisted progress matches what the UI would show.
_STAGE_DURATIONS_MS: tuple[int, ...] = (900, 900, 800, 1000, 600, 900)
_STAGE_TOTAL_MS = sum(_STAGE_DURATIONS_MS)


def _progress_after(index: int) -> int:
    elapsed = sum(_STAGE_DURATIONS_MS[: index + 1])
    return max(0, min(100, js_round((elapsed / _STAGE_TOTAL_MS) * 100)))


def _iso_now() -> str:
    """ISO-8601 UTC with milliseconds and a ``Z`` suffix (matches the contract)."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class AnalysisService:
    """Target, run and report orchestration over the request's repositories."""

    def __init__(
        self,
        targets: TargetRepository,
        workspace: WorkspaceRepository,
        *,
        stage_delay_seconds: float = 0.0,
        enricher: AnalysisEnricher | None = None,
        clock: Callable[[], str] | None = None,
    ) -> None:
        self._targets = targets
        self._workspace = workspace
        self._stage_delay_seconds = max(0.0, stage_delay_seconds)
        self._enricher = enricher
        self._clock = clock or _iso_now

    def _now(self) -> str:
        return self._clock()

    # -- targets -------------------------------------------------------------
    async def list_targets(self, user_id: str) -> list[JobTarget]:
        workspace = await self._workspace.get_workspace(user_id)
        targets = await self._targets.list_targets(user_id)
        return [self._with_staleness(target, workspace.version) for target in targets]

    async def create_target(self, user_id: str, create: TargetCreate) -> JobTarget:
        now = self._now()
        return await self._targets.create_target(
            user_id, create, target_id=str(uuid4()), created_at=now
        )

    async def get_target(self, user_id: str, target_id: str) -> JobTarget:
        workspace = await self._workspace.get_workspace(user_id)
        target = await self._targets.get_target(user_id, target_id)
        if target is None:
            raise TargetNotFoundError(target_id)
        return self._with_staleness(target, workspace.version)

    # -- runs ----------------------------------------------------------------
    async def start_analysis(
        self,
        user_id: str,
        target_id: str,
        *,
        schedule: Schedule,
        consent: ConsentGrant | None,
    ) -> AnalysisRunResponse:
        await self._require_target(user_id, target_id)
        existing = await self._targets.latest_run(user_id, target_id)
        if existing is not None and existing.status == "running":
            raise AnalysisAlreadyRunningError(target_id)

        workspace = await self._workspace.get_workspace(user_id)
        now = self._now()
        run = AnalysisRun(
            id=str(uuid4()),
            targetId=target_id,
            status="running",
            stage=cast(AnalysisStageKey, ANALYSIS_STAGES[0]["key"]),
            stageIndex=0,
            stageCount=ANALYSIS_STAGE_COUNT,
            progress=0,
            workspaceVersion=workspace.version,
            startedAt=now,
            updatedAt=now,
            finishedAt=None,
            failure=None,
        )
        await self._targets.create_run(user_id, run)
        await self._targets.set_target_status(user_id, target_id, "analyzing", updated_at=now)
        schedule(self.execute_run, user_id, target_id, run.id, consent)
        return AnalysisRunResponse(run=run.model_copy(deep=True), report=None)

    async def get_run(self, user_id: str, target_id: str) -> AnalysisRunResponse:
        await self._require_target(user_id, target_id)
        run = await self._targets.latest_run(user_id, target_id)
        if run is None:
            raise AnalysisRunNotFoundError(target_id)
        report = (
            await self._targets.get_report(user_id, target_id)
            if run.status == "succeeded"
            else None
        )
        return AnalysisRunResponse(run=run, report=report)

    async def get_report(self, user_id: str, target_id: str) -> AnalysisReport:
        await self._require_target(user_id, target_id)
        report = await self._targets.get_report(user_id, target_id)
        if report is None:
            raise ReportNotReadyError(target_id)
        return report

    # -- execution (runs after the response) ---------------------------------
    async def execute_run(
        self, user_id: str, target_id: str, run_id: str, consent: ConsentGrant | None
    ) -> None:
        run = await self._targets.latest_run(user_id, target_id)
        if run is None or run.id != run_id:
            return
        try:
            run = await self._stage(user_id, run, 0)  # reading
            target = await self._require_target(user_id, target_id)
            workspace = await self._workspace.get_workspace(user_id)

            run = await self._stage(user_id, run, 1)  # extracting
            drafts = extract_requirements(
                job_description=target.jobDescription,
                required_skills=target.requiredSkills,
            )
            index = build_evidence_index(workspace.items, workspace.updatedAt)
            ai_used = False
            if self._enricher is not None and consent is not None:
                drafts, ai_used = await self._enricher.refine(
                    job_description=target.jobDescription, drafts=drafts, consent=consent
                )

            run = await self._stage(user_id, run, 2)  # searching
            requirements = match_requirements(drafts, index).requirements

            run = await self._stage(user_id, run, 3)  # matching
            if self._enricher is not None and consent is not None:
                requirements, explained = await self._enricher.explain(
                    job_description=target.jobDescription,
                    requirements=requirements,
                    items=workspace.items,
                    consent=consent,
                )
                ai_used = ai_used or explained

            run = await self._stage(user_id, run, 4)  # scoring

            run = await self._stage(user_id, run, 5)  # writing
            report = assemble_report(
                target=target,
                items=workspace.items,
                workspace_version=workspace.version,
                workspace_updated_at=workspace.updatedAt,
                generated_at=self._now(),
                requirements=requirements,
                ai_used=ai_used,
            )
            await self._targets.save_report(user_id, report, report_id=str(uuid4()))
            try:
                await self._targets.save_requirements(user_id, target_id, requirements)
            except RepositoryError:
                # The report is the durable artefact; the requirements snapshot
                # is a convenience mirror and must not fail the run.
                logger.info("analysis_requirements_snapshot_failed", extra={"target_id": target_id})

            now = self._now()
            await self._targets.set_target_analysis(
                user_id,
                target_id,
                TargetAnalysisSummary(
                    score=report.score,
                    analysedAt=now,
                    workspaceVersion=workspace.version,
                    stale=False,
                ),
                "ready",
                updated_at=now,
            )
            await self._targets.update_run(
                user_id,
                run.model_copy(
                    update={
                        "status": "succeeded",
                        "stage": cast(AnalysisStageKey, ANALYSIS_STAGES[-1]["key"]),
                        "stageIndex": ANALYSIS_STAGE_COUNT - 1,
                        "progress": 100,
                        "finishedAt": now,
                        "updatedAt": now,
                        "failure": None,
                    }
                ),
            )
        except Exception as exc:  # the run must record any failure
            await self._fail(user_id, target_id, run, exc)

    async def _stage(self, user_id: str, run: AnalysisRun, index: int) -> AnalysisRun:
        updated = run.model_copy(
            update={
                "stage": cast(AnalysisStageKey, ANALYSIS_STAGES[index]["key"]),
                "stageIndex": index,
                "progress": _progress_after(index),
                "updatedAt": self._now(),
            }
        )
        await self._targets.update_run(user_id, updated)
        if self._stage_delay_seconds > 0:
            await asyncio.sleep(self._stage_delay_seconds)
        return updated

    async def _fail(self, user_id: str, target_id: str, run: AnalysisRun, exc: Exception) -> None:
        now = self._now()
        failed = run.model_copy(
            update={
                "status": "failed",
                "failure": AnalysisFailure(
                    code="analysis_failed",
                    message="The analysis could not be completed. Try again.",
                    stage=run.stage,
                ),
                "finishedAt": now,
                "updatedAt": now,
            }
        )
        await self._targets.update_run(user_id, failed)
        await self._targets.set_target_status(user_id, target_id, "failed", updated_at=now)
        logger.info(
            "analysis_run_failed",
            extra={"target_id": target_id, "stage": run.stage, "error": type(exc).__name__},
        )

    # -- helpers -------------------------------------------------------------
    async def _require_target(self, user_id: str, target_id: str) -> JobTarget:
        target = await self._targets.get_target(user_id, target_id)
        if target is None:
            raise TargetNotFoundError(target_id)
        return target

    @staticmethod
    def _with_staleness(target: JobTarget, workspace_version: int) -> JobTarget:
        analysis = target.analysis
        if analysis is None:
            return target
        stale = analysis.workspaceVersion != workspace_version
        if stale == analysis.stale:
            return target
        return target.model_copy(update={"analysis": analysis.model_copy(update={"stale": stale})})
