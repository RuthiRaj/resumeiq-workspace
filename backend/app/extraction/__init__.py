"""Deterministic PDF/DOCX extraction (milestone B2, PRD §6.2 IM-1..IM-3).

Public surface: content sniffing, the extraction engine and its error types.
"""

from app.extraction.engine import (
    DEFAULT_TIMEOUT_SECONDS,
    DeterministicExtractionEngine,
    ExtractionEngine,
    ParsedDocument,
)
from app.extraction.errors import (
    DocumentRejectedError,
    ExtractionError,
    ExtractionTimeoutError,
    ExtractionUnavailableError,
    UnsupportedFileTypeError,
)
from app.extraction.sniffing import (
    declared_type_from_name,
    guard_zip_bomb,
    open_docx_zip,
    sniff_declared_type,
)

__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "DeterministicExtractionEngine",
    "DocumentRejectedError",
    "ExtractionEngine",
    "ExtractionError",
    "ExtractionTimeoutError",
    "ExtractionUnavailableError",
    "ParsedDocument",
    "UnsupportedFileTypeError",
    "declared_type_from_name",
    "guard_zip_bomb",
    "open_docx_zip",
    "sniff_declared_type",
]
