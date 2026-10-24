"""Structured JSON logging. Never logs request bodies, headers, or personal data."""

import contextvars
import json
import logging
import sys
from datetime import UTC, datetime

request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        # Only allow explicitly passed safe extras; bodies/headers/PII must never reach here.
        for key in (
            "method",
            "path",
            "status",
            "duration_ms",
            "code",
            # AI metrics (B3): provider, model, latency, token counts, validity.
            # Never a prompt, a response body or a key (ADR-029).
            "provider",
            "model",
            "latency_ms",
            "prompt_tokens",
            "completion_tokens",
            "valid",
            "task",
            "attempt",
            "cache_hit",
        ):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload)


_configured = False


def setup_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    # `httpx` logs every outbound request at INFO. Its URL includes Supabase
    # Data API query strings (e.g. `user_id=eq.<uuid>`), which are personal
    # data and must not reach a log collector. Warnings and errors still pass.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
