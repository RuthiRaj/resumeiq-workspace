"""Unauthenticated health check."""

from fastapi import APIRouter, Request

from app.core.config import Settings
from app.schemas.common import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    responses={200: {"description": "Service is up."}},
)
def get_health(request: Request) -> HealthResponse:
    settings: Settings = request.app.state.settings
    return HealthResponse(
        status="ok", version=settings.app_version, environment=settings.environment
    )
