"""ResumeIQ backend application factory (B0 scaffold)."""

import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.health import router as health_router
from app.api.v1.router import router as v1_router
from app.core.config import Settings, get_settings
from app.core.logging import setup_logging
from app.core.security import (
    InMemoryRateLimiter,
    RequestLoggingMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.repositories.errors import (
    DataApiNotConfiguredError,
    InvalidReorderError,
    ItemNotFoundError,
    RepositoryError,
)


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """The single error shape used across the API: ``{"detail": {code, message}}``."""
    return JSONResponse(
        status_code=status_code,
        content={"detail": {"code": code, "message": message}},
    )


async def _handle_item_not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(404, "not_found", "That workspace item no longer exists.")


async def _handle_invalid_reorder(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        422,
        "invalid_reorder",
        "That reorder request referenced items outside the section.",
    )


async def _handle_data_api_not_configured(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(500, "data_api_not_configured", "Server data access is not configured.")


async def _handle_repository_error(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        502, "workspace_unavailable", "The workspace store could not be reached."
    )


async def _handle_validation_error(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        422, "invalid_request", "Some fields need attention before this item can be saved."
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Fail fast at startup: a server that cannot serve requests must not
        # start. The message names missing variables and never prints a value
        # (see Settings.validate_required). Tests that build an app without a
        # lifespan are unaffected; uvicorn always runs it.
        settings.validate_required()
        yield

    app = FastAPI(
        title="ResumeIQ API",
        version=settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings

    # Domain error shapes (kept out of the routers; see PRD §8.3 error contract).
    app.add_exception_handler(ItemNotFoundError, _handle_item_not_found)
    app.add_exception_handler(InvalidReorderError, _handle_invalid_reorder)
    app.add_exception_handler(DataApiNotConfiguredError, _handle_data_api_not_configured)
    app.add_exception_handler(RepositoryError, _handle_repository_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)

    # Added last = outermost. Request path: CORS -> headers -> logging -> size -> rate -> router.
    app.add_middleware(InMemoryRateLimiter, per_minute=settings.rate_limit_per_minute)
    app.add_middleware(RequestSizeLimitMiddleware, max_bytes=settings.max_request_bytes)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    app.include_router(health_router)
    app.include_router(v1_router, prefix=settings.api_v1_prefix)

    return app


app = create_app()
