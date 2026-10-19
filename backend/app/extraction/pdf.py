"""PDF text extraction (pypdf, BSD-3-Clause) with a page cap and a deadline.

``pypdf`` only reads the text layer. An image-only ("scanned") page yields no
text, which is the honest input for the caller's "nothing could be read" state —
there is no OCR in this milestone.
"""

from __future__ import annotations

import io
import time
from typing import Final

from pypdf import PdfReader

from app.extraction.errors import DocumentRejectedError, ExtractionTimeoutError

MAX_PDF_PAGES: Final[int] = 50


def extract_pdf_text(data: bytes, deadline: float) -> tuple[str, int]:
    """Extracted text per page (newline-joined) and the page count."""
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
    except Exception as exc:  # pypdf raises several unrelated exception types
        raise DocumentRejectedError("The PDF could not be opened.") from exc

    if reader.is_encrypted:
        # We never ask for a password: an encrypted upload is rejected, not guessed.
        raise DocumentRejectedError("The PDF is password protected.")

    try:
        pages = list(reader.pages)
    except Exception as exc:
        raise DocumentRejectedError("The PDF's pages could not be read.") from exc

    if len(pages) > MAX_PDF_PAGES:
        raise DocumentRejectedError(f"The PDF has more than {MAX_PDF_PAGES} pages.")

    parts: list[str] = []
    for page in pages:
        if time.monotonic() > deadline:
            raise ExtractionTimeoutError("Reading the PDF took too long.")
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            # One unreadable page must not lose the rest of the document.
            parts.append("")

    return "\n".join(parts), max(len(pages), 1)
