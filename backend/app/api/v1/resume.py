"""Standard-resume API (milestone B1, PRD §6.3 SYN-1..3).

``GET /resume/standard`` returns the deterministic, AI-free standard resume
derived from the caller's current workspace. Deleted items never appear.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import UserClaims, get_current_user, get_workspace_service
from app.schemas.common import ErrorResponse
from app.schemas.resume import ResumeResponse
from app.services.workspace_service import WorkspaceService

router = APIRouter(
    tags=["resume"],
    responses={401: {"model": ErrorResponse, "description": "Missing or invalid token."}},
)

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
WorkspaceSvc = Annotated[WorkspaceService, Depends(get_workspace_service)]


@router.get(
    "/resume/standard",
    response_model=ResumeResponse,
    response_model_exclude_none=True,
    summary="Derive the standard resume from the workspace",
)
async def get_standard_resume(user: CurrentUser, service: WorkspaceSvc) -> ResumeResponse:
    return await service.get_standard_resume(user.sub)
