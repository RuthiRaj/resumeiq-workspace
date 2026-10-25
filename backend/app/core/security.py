"""Security middleware: headers, request-size limits, in-memory rate limiting.

The rate limiter is an intentional single-process placeholder (see ADR-009):
it protects a single Render free instance and must be replaced with a shared
store (e.g. Redis) when running more than one replica.
"""

import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable, Mapping

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.logging import get_logger, request_id_ctx

logger = get_logger(__name__)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}

# Strict CSP for production and all non-docs paths
STRICT_CSP = "default-src 'none'; frame-ancestors 'none'"

# Relaxed CSP for Swagger UI / ReDoc in development only
# Allows scripts/styles/images from the FastAPI CDN sources plus 'unsafe-inline'
# for the inline script that initializes Swagger UI.
RELAXED_CSP = (
    "default-src 'none'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fastapi.tiangolo.com; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fastapi.tiangolo.com; "
    "img-src 'self' data: https://cdn.jsdelivr.net https://fastapi.tiangolo.com; "
    "frame-ancestors 'none'"
)

# Paths that get the relaxed CSP in development
DOCS_PATHS = {"/docs", "/redoc", "/openapi.json"}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        # Apply common security headers
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value

        # Determine CSP based on environment and path
        settings: Settings | None = getattr(request.app.state, "settings", None)
        is_development = (
            settings is not None
            and settings.environment.strip().lower() == "development"
        )
        path = request.url.path

        if is_development and path in DOCS_PATHS:
            csp = RELAXED_CSP
        else:
            csp = STRICT_CSP

        response.headers["Content-Security-Policy"] = csp
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs method/path/status/duration only. Never bodies, headers, or PII."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id_ctx.set(uuid.uuid4().hex[:12])
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        response.headers["X-Request-ID"] = request_id_ctx.get()
        return response


class RequestSizeLimitMiddleware:
    """Rejects requests whose body exceeds `max_bytes` with 413.

    Pure ASGI so oversized bodies are rejected while streaming instead of
    being buffered in memory first. ``path_limits`` raises the cap for specific
    path prefixes (the document-import upload route), matched by longest prefix;
    the default cap still applies everywhere else.
    """

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        path_limits: Mapping[str, int] | None = None,
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self._path_limits: tuple[tuple[str, int], ...] = tuple(
            sorted((path_limits or {}).items(), key=lambda entry: len(entry[0]), reverse=True)
        )

    def _limit_for(self, path: str) -> int:
        for prefix, limit in self._path_limits:
            if path.startswith(prefix):
                return limit
        return self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self._limit_for(str(scope.get("path", "")))
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        try:
            declared = int(headers.get("content-length", "0") or "0")
        except ValueError:
            declared = 0
        if declared > max_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0
        messages: list[Message] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    await self._reject(scope, receive, send)
                    return
                messages.append(message)
                more_body = message.get("more_body", False)
            elif message["type"] == "http.disconnect":
                return

        index = 0

        async def replay() -> Message:
            nonlocal index
            message = messages[index]
            index += 1
            return message

        await self.app(scope, replay, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            {"detail": {"code": "payload_too_large", "message": "Request body too large."}},
            status_code=413,
        )
        await response(scope, receive, send)


class InMemoryRateLimiter(BaseHTTPMiddleware):
    """Single-process rate limiter.

    Anonymous traffic is keyed by client IP with ``per_minute``. A request with
    a *verified* Supabase bearer token is keyed by the user id instead, with the
    higher ``authenticated_per_minute`` budget, so one signed-in user cannot
    exhaust the allowance of everyone sharing their IP. An invalid or expired
    token falls back to the IP bucket; the route still rejects it with 401.
    """

    def __init__(
        self,
        app: ASGIApp,
        per_minute: int,
        authenticated_per_minute: int = 240,
    ) -> None:
        super().__init__(app)
        self.per_minute = per_minute
        self.authenticated_per_minute = authenticated_per_minute
        self._hits: dict[str, deque[float]] = {}

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        user_id = _verified_user_id(request)
        if user_id is not None:
            key = f"user:{user_id}"
            limit = self.authenticated_per_minute
        else:
            key = f"ip:{request.client.host if request.client else 'unknown'}"
            limit = self.per_minute
        if limit <= 0:
            return await call_next(request)
        now = time.monotonic()
        window_start = now - 60.0
        hits = self._hits.get(key)
        if hits is None:
            hits = self._hits[key] = deque()
        while hits and hits[0] <= window_start:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = max(1, int(hits[0] + 60.0 - now))
            return JSONResponse(
                {"detail": {"code": "rate_limited", "message": "Too many requests."}},
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)
        if len(self._hits) > 10_000:  # bound memory: drop the oldest client bucket
            self._hits.pop(next(iter(self._hits)))
        return await call_next(request)


def _verified_user_id(request: Request) -> str | None:
    """The verified `sub`, or None for anonymous/invalid tokens.

    Verification is the same function the routes use, so a forged or expired
    token can never earn a higher budget. Nothing here is logged: the token and
    its claims must not reach a log line.
    """
    settings = getattr(request.app.state, "settings", None)
    if settings is None or not settings.auth_configured:
        return None
    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    # Local import keeps the middleware module free of the repository stack.
    from app.api.deps import verify_supabase_jwt

    try:
        return verify_supabase_jwt(token.strip(), settings).sub
    except Exception:
        return None
