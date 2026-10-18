"""DOCX text extraction (python-docx, MIT) in document order, tables included.

A DOCX does not record a page count, so this returns ``1`` rather than inventing
one. Tables are read row by row because multi-column resumes are usually laid
out as tables; each row becomes one ``" | "``-joined line so the section parser
sees the columns in order.
"""

from __future__ import annotations

import io
import time
from collections.abc import Iterator
from typing import Final

import docx
from docx.document import Document as DocxDocument
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

from app.extraction.errors import DocumentRejectedError, ExtractionTimeoutError

MAX_DOCX_BLOCKS: Final[int] = 5_000


def extract_docx_text(data: bytes, deadline: float) -> tuple[str, int]:
    """Extracted text (newline-joined) and ``1`` (DOCX has no page count)."""
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:  # python-docx raises several unrelated types
        raise DocumentRejectedError("The DOCX could not be opened.") from exc

    lines: list[str] = []
    for block_count, block in enumerate(_iter_blocks(document), start=1):
        if time.monotonic() > deadline:
            raise ExtractionTimeoutError("Reading the DOCX took too long.")
        if block_count > MAX_DOCX_BLOCKS:
            raise DocumentRejectedError("The DOCX has too many blocks.")
        if isinstance(block, Paragraph):
            lines.append(block.text)
        else:
            for row in block.rows:
                cells = [cell.text.strip() for cell in row.cells]
                while cells and cells[-1] == "":
                    cells.pop()
                if cells:
                    lines.append(" | ".join(cells))

    return "\n".join(lines), 1


def _iter_blocks(document: DocxDocument) -> Iterator[Paragraph | Table]:
    """Body children in document order (paragraphs and tables interleaved)."""
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)
