"""ResumeIQ backend application factory (B0 scaffold)."""

import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.errors import (
    AIConsentRequiredError,
    AIGroundingError,
    AINotConfiguredError,
    AIProviderAuthError,
    AIProviderError,
    AIQuotaExceededError,
    AISchemaError,
    AIUnavailableError,
)
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
from app.extraction.errors import (
    DocumentRejectedError,
    ExtractionError,
    ExtractionTimeoutError,
    ExtractionUnavailableError,
    UnsupportedFileTypeError,
)
from app.repositories.errors import (
    AnalysisAlreadyRunningError,
    AnalysisRunNotFoundError,
    DataApiNotConfiguredError,
    ImportReviewItemNotFoundError,
    ImportSessionNotFoundError,
    InvalidReorderError,
    ItemNotFoundError,
    ReportNotReadyError,
    RepositoryError,
    TargetNotFoundError,
)
from app.services.import_service import ImportFileTooLargeError


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


async def _handle_validation_error(request: Request, _exc: Exception) -> JSONResponse:
    # The target intake has its own contract code (docs/api/contract-proposals.md
    # §3.1); every other body keeps the generic code.
    if request.method == "POST" and request.url.path.rstrip("/").endswith("/targets"):
        return _error_response(
            422, "target_invalid", "Check the role, company, job description and skills."
        )
    return _error_response(
        422, "invalid_request", "Some fields need attention before this item can be saved."
    )


async def _handle_target_not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(404, "target_not_found", "That job target no longer exists.")


async def _handle_analysis_run_not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        404, "analysis_run_not_found", "No analysis has been started for that target."
    )


async def _handle_report_not_ready(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(404, "report_not_ready", "The analysis report is not ready yet.")


async def _handle_analysis_already_running(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        409, "analysis_already_running", "An analysis is already running for that target."
    )


async def _handle_import_session_not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(404, "import_not_found", "That import no longer exists.")


async def _handle_import_item_not_found(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(404, "import_item_not_found", "That extracted item no longer exists.")


async def _handle_import_file_too_large(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(413, "import_file_too_large", "Files must be 5 MB or smaller.")


async def _handle_unsupported_file_type(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        415,
        "import_file_type_unsupported",
        "Only PDF and DOCX files can be imported, and the contents must match.",
    )


async def _handle_document_rejected(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        400, "import_file_rejected", "That file could not be read. Try another copy."
    )


async def _handle_extraction_unavailable(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        503, "extraction_unavailable", "Reading the document is unavailable right now. Try again."
    )


# --- AI gateway errors (B3) ------------------------------------------------
# No public AI endpoint ships in B3, but the mapping is the contract B4/B5 use.


async def _handle_ai_not_configured(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        503, "ai_not_configured", "AI features are not configured on this server."
    )


async def _handle_ai_consent_required(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        403, "ai_consent_required", "Enable AI processing before using this feature."
    )


async def _handle_ai_quota(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        429, "ai_quota_exceeded", "The daily AI limit was reached. It resets tomorrow."
    )


async def _handle_ai_invalid_output(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        502, "ai_invalid_output", "The AI response could not be used. Nothing was saved."
    )


async def _handle_ai_ungrounded(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        502, "ai_ungrounded", "The AI output contained unsupported claims and was rejected."
    )


async def _handle_ai_unavailable(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(
        503, "ai_unavailable", "AI providers are unavailable right now. Try again later."
    )


async def _handle_ai_provider_auth(_request: Request, _exc: Exception) -> JSONResponse:
    return _error_response(502, "ai_provider_auth_failed", "AI provider authentication failed.")


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

    # Import errors (B2). Starlette resolves the most specific class first, so
    # these map to the contract codes in docs/api/contract-proposals.md §2.1.
    app.add_exception_handler(ImportSessionNotFoundError, _handle_import_session_not_found)
    app.add_exception_handler(ImportReviewItemNotFoundError, _handle_import_item_not_found)
    app.add_exception_handler(ImportFileTooLargeError, _handle_import_file_too_large)
    app.add_exception_handler(UnsupportedFileTypeError, _handle_unsupported_file_type)
    app.add_exception_handler(DocumentRejectedError, _handle_document_rejected)
    app.add_exception_handler(ExtractionTimeoutError, _handle_extraction_unavailable)
    app.add_exception_handler(ExtractionUnavailableError, _handle_extraction_unavailable)
    app.add_exception_handler(ExtractionError, _handle_extraction_unavailable)

    # Targets / analysis (B4). Stable contract codes; repository failures keep
    # the generic 502 mapping.
    app.add_exception_handler(TargetNotFoundError, _handle_target_not_found)
    app.add_exception_handler(AnalysisRunNotFoundError, _handle_analysis_run_not_found)
    app.add_exception_handler(ReportNotReadyError, _handle_report_not_ready)
    app.add_exception_handler(AnalysisAlreadyRunningError, _handle_analysis_already_running)

    # AI gateway errors (B3): typed, stable codes, no prompt/response content.
    app.add_exception_handler(AINotConfiguredError, _handle_ai_not_configured)
    app.add_exception_handler(AIConsentRequiredError, _handle_ai_consent_required)
    app.add_exception_handler(AIQuotaExceededError, _handle_ai_quota)
    app.add_exception_handler(AISchemaError, _handle_ai_invalid_output)
    app.add_exception_handler(AIGroundingError, _handle_ai_ungrounded)
    app.add_exception_handler(AIUnavailableError, _handle_ai_unavailable)
    app.add_exception_handler(AIProviderAuthError, _handle_ai_provider_auth)
    app.add_exception_handler(AIProviderError, _handle_ai_unavailable)

    # Added last = outermost. Request path: CORS -> headers -> logging -> size -> rate -> router.
    app.add_middleware(InMemoryRateLimiter, per_minute=settings.rate_limit_per_minute)
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_bytes=settings.max_request_bytes,
        # The upload route needs room for a document plus multipart overhead;
        # every other route keeps the small default cap (PRD §11).
        path_limits={f"{settings.api_v1_prefix}/imports": settings.max_import_bytes + 8192},
    )
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
