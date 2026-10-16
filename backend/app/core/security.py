"""Security middleware: headers, request-size limits, in-memory rate limiting.

The rate limiter is an intentional single-process placeholder (see ADR-008):
it protects a single Render free instance and must be replaced with a shared
store (e.g. Redis) when running more than one replica.
"""

import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import get_logger, request_id_ctx

logger = get_logger(__name__)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
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
    being buffered in memory first.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        try:
            declared = int(headers.get("content-length", "0") or "0")
        except ValueError:
            declared = 0
        if declared > self.max_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0
        messages: list[Message] = []
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
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
    """Fixed-window per-IP rate limiter (single-process placeholder)."""

    def __init__(self, app: ASGIApp, per_minute: int) -> None:
        super().__init__(app)
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = {}

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if self.per_minute <= 0:
            return await call_next(request)
        now = time.monotonic()
        window_start = now - 60.0
        key = request.client.host if request.client else "unknown"
        hits = self._hits.get(key)
        if hits is None:
            hits = self._hits[key] = deque()
        while hits and hits[0] <= window_start:
            hits.popleft()
        if len(hits) >= self.per_minute:
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
