"""Structured logging must not emit third-party HTTP URLs at INFO.

`httpx` logs every outbound request at INFO, including Supabase Data API query
strings (`user_id=eq.<uuid>`). Nothing in the application needs those lines, and
a URL is exactly the kind of data that should not end up in a log collector.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import pytest

import app.core.logging as app_logging

USER_FILTER = "user_id=eq.123e4567-e89b-12d3-a456-426614174000"


class ListHandler(logging.Handler):
    """Captures records regardless of formatting, without touching stdout."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture()
def isolated_logging(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run `setup_logging` for real, then restore the global logging state."""
    root = logging.getLogger()
    handlers = list(root.handlers)
    root_level = root.level
    httpx_level = logging.getLogger("httpx").level
    httpcore_level = logging.getLogger("httpcore").level
    monkeypatch.setattr(app_logging, "_configured", False)
    try:
        yield
    finally:
        root.handlers = handlers
        root.setLevel(root_level)
        logging.getLogger("httpx").setLevel(httpx_level)
        logging.getLogger("httpcore").setLevel(httpcore_level)


def test_third_party_http_loggers_are_warning_only(isolated_logging: None) -> None:
    app_logging.setup_logging("INFO")

    for name in ("httpx", "httpcore"):
        logger = logging.getLogger(name)
        assert not logger.isEnabledFor(logging.INFO), f"{name} must not log at INFO"
        assert logger.isEnabledFor(logging.WARNING), f"{name} must still log warnings"


def test_no_info_record_carries_a_supabase_user_filter(isolated_logging: None) -> None:
    app_logging.setup_logging("INFO")
    capture = ListHandler()
    logging.getLogger().addHandler(capture)
    try:
        logging.getLogger("httpx").info(
            "HTTP Request: GET https://project.supabase.co/rest/v1/resumes"
            f'?select=*&{USER_FILTER} "HTTP/1.1 200 OK"'
        )
        logging.getLogger("httpcore").info(
            f"HTTP Request: GET https://project.supabase.co/rest/v1/resumes?{USER_FILTER}"
        )
        # A warning must still get through, so the loggers are not muted wholesale.
        logging.getLogger("httpx").warning("HTTP client warning without a user filter")
    finally:
        logging.getLogger().removeHandler(capture)

    messages = [record.getMessage() for record in capture.records]
    assert not any(USER_FILTER in message for message in messages), (
        "an INFO log leaked a Supabase user-id filter"
    )
    assert not any(record.levelno == logging.INFO for record in capture.records)
