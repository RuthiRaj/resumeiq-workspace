"""File-level extraction tests over synthetic PDFs and DOCXes.

Every document is generated in code with clearly fictional content (no real
personal data). The tests cover the security-relevant paths — content sniffing on
magic bytes, zip-bomb limits, an encrypted PDF, the page cap and the parsing
deadline — plus the multi-column and scanned layouts the brief calls out.
"""

from __future__ import annotations

import time

import pytest

from app.extraction.docx import MAX_DOCX_BLOCKS
from app.extraction.engine import DeterministicExtractionEngine
from app.extraction.errors import (
    DocumentRejectedError,
    ExtractionTimeoutError,
    UnsupportedFileTypeError,
)
from app.extraction.pdf import MAX_PDF_PAGES, extract_pdf_text
from app.extraction.sniffing import declared_type_from_name, sniff_declared_type
from tests.synthetic_documents import (
    build_docx,
    build_encrypted_pdf,
    build_high_ratio_docx,
    build_pdf,
    build_scanned_pdf,
    build_zip_with_entries,
)

# Lines deliberately given month-precision dates so the assertions are exact.
RESUME_LINES = [
    "EXAMPLE CANDIDATE",
    "Example City, EX",
    "",
    "EXPERIENCE",
    "Backend Intern",
    "Example Payments Ltd",
    "Jan 2024 - Sep 2024",
    "- Built an internal reporting endpoint for the support team.",
    "",
    "EDUCATION",
    "BSc Computer Science",
    "Example University",
    "Sep 2019 - Jun 2022",
    "",
    "SKILLS",
    "TypeScript, Python",
]


def titles(parsed_items: list[object]) -> set[str]:
    found: set[str] = set()
    for item in parsed_items:
        for extracted in item.fields:  # type: ignore[attr-defined]
            if extracted.key == "title":
                found.add(extracted.value)
    return found


def test_pdf_text_is_extracted_with_candidate_items() -> None:
    parsed = DeterministicExtractionEngine().extract(build_pdf([RESUME_LINES]), "pdf")
    assert parsed.preview_available is True
    assert parsed.page_count == 1
    assert "Backend Intern" in parsed.source_text
    assert {"Backend Intern", "BSc Computer Science"} <= titles(parsed.items)


def test_docx_text_is_extracted_with_candidate_items() -> None:
    parsed = DeterministicExtractionEngine().extract(build_docx(RESUME_LINES), "docx")
    assert parsed.preview_available is True
    assert parsed.page_count == 1
    assert {"Backend Intern", "BSc Computer Science"} <= titles(parsed.items)


def test_pdf_and_docx_agree_on_the_same_content() -> None:
    engine = DeterministicExtractionEngine()
    from_pdf = engine.extract(build_pdf([RESUME_LINES]), "pdf")
    from_docx = engine.extract(build_docx(RESUME_LINES), "docx")
    assert titles(from_pdf.items) == titles(from_docx.items)


def test_multi_column_table_rows_become_items() -> None:
    blocks: list[str | list[list[str]]] = [
        "EXAMPLE CANDIDATE",
        "EXPERIENCE",
        [
            ["Backend Intern", "Example Payments Ltd", "Jan 2024 - Sep 2024"],
            ["Junior Developer", "Example Software Co", "Feb 2022 - Dec 2023"],
        ],
        "SKILLS",
        "TypeScript, Python",
    ]
    parsed = DeterministicExtractionEngine().extract(build_docx(blocks), "docx")
    found = titles(parsed.items)
    assert {"Backend Intern", "Junior Developer"} <= found
    # The cells stayed on their own row, so each entry keeps the right employer.
    for item in parsed.items:
        if item.section != "experience":
            continue
        organization = {f.key: f.value for f in item.fields}.get("organization")
        title = {f.key: f.value for f in item.fields}["title"]
        if title == "Backend Intern":
            assert organization == "Example Payments Ltd"


def test_scanned_pdf_reports_nothing_could_be_read() -> None:
    parsed = DeterministicExtractionEngine().extract(build_scanned_pdf(), "pdf")
    assert parsed.preview_available is False
    assert parsed.source_text == ""
    assert parsed.items == []
    assert parsed.page_count == 1


def test_encrypted_pdf_is_rejected() -> None:
    engine = DeterministicExtractionEngine()
    with pytest.raises(DocumentRejectedError):
        engine.extract(build_encrypted_pdf(), "pdf")


def test_pdf_page_cap_is_enforced() -> None:
    data = build_pdf([["Example Candidate"]] * (MAX_PDF_PAGES + 1))
    with pytest.raises(DocumentRejectedError):
        DeterministicExtractionEngine().extract(data, "pdf")


def test_docx_block_cap_is_enforced() -> None:
    data = build_docx(["Example line"] * (MAX_DOCX_BLOCKS + 1))
    with pytest.raises(DocumentRejectedError):
        DeterministicExtractionEngine().extract(data, "docx")


def test_zip_bomb_entry_count_is_rejected() -> None:
    with pytest.raises(DocumentRejectedError):
        sniff_declared_type(build_zip_with_entries(3_000), "docx")


def test_zip_bomb_compression_ratio_is_rejected() -> None:
    with pytest.raises(DocumentRejectedError):
        sniff_declared_type(build_high_ratio_docx(), "docx")


def test_a_plain_zip_is_not_a_docx() -> None:
    with pytest.raises(UnsupportedFileTypeError):
        sniff_declared_type(build_zip_with_entries(1, as_docx=False), "docx")


def test_content_must_match_the_declared_type() -> None:
    with pytest.raises(UnsupportedFileTypeError):
        sniff_declared_type(build_pdf([["Example"]]), "docx")
    with pytest.raises(UnsupportedFileTypeError):
        sniff_declared_type(build_docx(["Example"]), "pdf")


def test_declared_type_is_read_from_the_name() -> None:
    assert declared_type_from_name("resume.pdf") == "pdf"
    assert declared_type_from_name("RESUME.DOCX") == "docx"
    assert declared_type_from_name("resume.txt") is None
    assert declared_type_from_name("resume") is None
    # The extension never decides alone: a renamed binary is caught by sniffing.
    assert declared_type_from_name("resume.pdf") == "pdf"


def test_parsing_deadline_is_enforced() -> None:
    data = build_pdf([RESUME_LINES])
    with pytest.raises(ExtractionTimeoutError):
        extract_pdf_text(data, time.monotonic() - 1.0)
    with pytest.raises(ExtractionTimeoutError):
        DeterministicExtractionEngine(timeout_seconds=0.0).extract(data, "pdf")
