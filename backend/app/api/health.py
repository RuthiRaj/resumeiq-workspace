"""Unauthenticated health check and root endpoint."""

from fastapi import APIRouter, Request

from app.core.config import Settings
from app.schemas.common import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/",
    summary="API root",
    responses={200: {"description": "Service information."}},
)
def get_root(request: Request) -> dict:
    settings: Settings = request.app.state.settings
    expose_docs = settings.environment.strip().lower() == "development"
    response = {
        "service": "ResumeIQ API",
        "status": "ok",
        "health": "/health",
    }
    if expose_docs:
        response["docs"] = "/docs"
    return response


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
