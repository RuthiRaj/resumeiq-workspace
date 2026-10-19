"""Job targets and the analysis run/report API (milestone B4).

Endpoints, field names and enums mirror the agreed contract in
``docs/api/contract-proposals.md`` §3-§5 so the F4 MSW layer can be replaced by
this API at B7 without a UI change:

* ``GET    /targets``                              -- the caller's targets (200)
* ``POST   /targets``                              -- create a target (201)
* ``GET    /targets/{target_id}``                  -- one target (200/404)
* ``POST   /targets/{target_id}/analysis``         -- start a run (202/403/404/409)
* ``GET    /targets/{target_id}/analysis/run``     -- poll the latest run (200/404)
* ``GET    /targets/{target_id}/analysis``         -- the latest report (200/404)

Reads and writes use the caller's JWT end to end, so Postgres RLS decides
isolation: another user's target, run or report is simply ``404``.
"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, status

from app.ai.consent import ConsentGrant
from app.api.deps import (
    UserClaims,
    get_analysis_service,
    get_current_user,
    require_analysis_consent,
)
from app.schemas.analysis import (
    AnalysisReport,
    AnalysisRunResponse,
    JobTarget,
    TargetCreate,
)
from app.services.analysis_service import AnalysisService

router = APIRouter(tags=["targets"])

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
Targets = Annotated[AnalysisService, Depends(get_analysis_service)]


@router.get(
    "/targets",
    response_model=list[JobTarget],
    summary="List the caller's job targets",
)
async def list_targets(user: CurrentUser, service: Targets) -> list[JobTarget]:
    return await service.list_targets(user.sub)


@router.post(
    "/targets",
    response_model=JobTarget,
    status_code=status.HTTP_201_CREATED,
    summary="Create a job target",
    responses={422: {"description": "target_invalid"}},
)
async def create_target(create: TargetCreate, user: CurrentUser, service: Targets) -> JobTarget:
    return await service.create_target(user.sub, create)


@router.get(
    "/targets/{target_id}",
    response_model=JobTarget,
    summary="Read one job target",
    responses={404: {"description": "target_not_found"}},
)
async def get_target(target_id: str, user: CurrentUser, service: Targets) -> JobTarget:
    return await service.get_target(user.sub, target_id)


@router.post(
    "/targets/{target_id}/analysis",
    response_model=AnalysisRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start (or restart) an analysis run",
    responses={
        403: {"description": "consent_required"},
        404: {"description": "target_not_found"},
        409: {"description": "analysis_already_running"},
    },
)
async def start_analysis(
    target_id: str,
    background: BackgroundTasks,
    user: CurrentUser,
    service: Targets,
    consent: Annotated[ConsentGrant, Depends(require_analysis_consent)],
) -> AnalysisRunResponse:
    return await service.start_analysis(
        user.sub,
        target_id,
        schedule=background.add_task,
        consent=consent,
    )


@router.get(
    "/targets/{target_id}/analysis/run",
    response_model=AnalysisRunResponse,
    summary="Poll the latest analysis run",
    responses={
        404: {"description": "target_not_found or analysis_run_not_found"},
    },
)
async def get_analysis_run(
    target_id: str, user: CurrentUser, service: Targets
) -> AnalysisRunResponse:
    return await service.get_run(user.sub, target_id)


@router.get(
    "/targets/{target_id}/analysis",
    response_model=AnalysisReport,
    summary="Read the latest analysis report",
    responses={404: {"description": "target_not_found or report_not_ready"}},
)
async def get_analysis_report(
    target_id: str, user: CurrentUser, service: Targets
) -> AnalysisReport:
    return await service.get_report(user.sub, target_id)
