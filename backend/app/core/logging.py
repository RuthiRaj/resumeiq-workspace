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
        for key in ("method", "path", "status", "duration_ms", "code"):
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
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
