"""The extraction engine: sniffed bytes in, a reviewable document out.

No OCR and no AI calls (milestone B2). The engine is synchronous and CPU-bound;
the API layer runs it in a worker thread. The deadline is checked inside the
per-page / per-block loops, so a pathological document cannot hold a worker
indefinitely (PRD §11).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Final, Protocol, runtime_checkable

from app.extraction.docx import extract_docx_text
from app.extraction.pdf import extract_pdf_text
from app.extraction.plaintext import join_lines, normalize_lines
from app.extraction.sections import parse_sections
from app.schemas.imports import ExtractionItem, ImportFileType

DEFAULT_TIMEOUT_SECONDS: Final[float] = 8.0


@dataclass(frozen=True)
class ParsedDocument:
    """What the parser read — text plus candidate items, nothing invented."""

    file_type: ImportFileType
    page_count: int
    source_text: str
    preview_available: bool
    items: list[ExtractionItem] = field(default_factory=list)


@runtime_checkable
class ExtractionEngine(Protocol):
    def extract(self, data: bytes, file_type: ImportFileType) -> ParsedDocument: ...


class DeterministicExtractionEngine:
    """Real PDF/DOCX parsing with a deterministic section parser."""

    def __init__(self, *, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._timeout_seconds = timeout_seconds

    def extract(self, data: bytes, file_type: ImportFileType) -> ParsedDocument:
        deadline = time.monotonic() + self._timeout_seconds
        if file_type == "pdf":
            raw_text, page_count = extract_pdf_text(data, deadline)
        else:
            raw_text, page_count = extract_docx_text(data, deadline)

        lines = normalize_lines(raw_text)
        source_text = join_lines(lines)
        preview_available = source_text.strip() != ""
        # A scanned or image-only document reads as empty: report that rather
        # than inventing content (contract §2.2).
        items = parse_sections(lines) if preview_available else []
        return ParsedDocument(
            file_type=file_type,
            page_count=page_count,
            source_text=source_text if preview_available else "",
            preview_available=preview_available,
            items=items,
        )
