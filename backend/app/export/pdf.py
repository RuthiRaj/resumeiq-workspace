"""Deterministic, single-column, ATS-safe resume PDF (B6, PRD §6.9 EX-1).

Only permissively licensed components are used:

* ``reportlab`` (BSD-3-Clause) renders the document;
* ``pypdf`` (BSD-3-Clause) extracts it back for the round-trip check;
* the bundled ``DejaVuSans.ttf`` font is Bitstream Vera / public-domain DejaVu
  (see ``fonts/LICENSE-DejaVu.txt``).

The renderer is deliberately small: plain paragraphs, conventional section
headings, no tables, no images, no columns, no watermark, no page furniture and
no text that is not a claim from the resume. After building the bytes, the text
layer is extracted and every rendered heading and claim must be found again;
the caller can only serve a PDF whose check passed (see ``ExportCheck``).
"""

from __future__ import annotations

import io
import re
import unicodedata
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from app.export.errors import ExportCheck
from app.schemas.resume import ResumeResponse, ResumeSection

#: Conventional headings an ATS recognises; no decorative casing or symbols.
SECTION_HEADINGS: dict[str, str] = {
    "personal": "Contact",
    "experience": "Experience",
    "internship": "Internships",
    "project": "Projects",
    "education": "Education",
    "certificate": "Certifications",
    "course": "Courses",
    "training": "Training",
    "skill": "Skills",
    "achievement": "Achievements",
    "publication": "Publications",
    "extracurricular": "Extracurricular Activities",
}

_FONT_NAME = "DejaVuSans"
_FONT_PATH = Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf"
_WHITESPACE = re.compile(r"\s+")

_HEADING_STYLE = ParagraphStyle(
    "ResumeSectionHeading",
    fontName=_FONT_NAME,
    fontSize=12,
    leading=15,
    spaceBefore=10,
    spaceAfter=5,
    textColor="#000000",
)
_CLAIM_STYLE = ParagraphStyle(
    "ResumeClaim",
    fontName=_FONT_NAME,
    fontSize=10,
    leading=14,
    spaceAfter=3,
    textColor="#000000",
)


def _register_font() -> None:
    if _FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(_FONT_NAME, str(_FONT_PATH)))


def _normalise(value: str) -> str:
    """Whitespace-normalised text, so wrapping never fails the check."""
    return _WHITESPACE.sub(" ", value).strip()


def visible_sections(resume: ResumeResponse) -> list[ResumeSection]:
    """Sections and claims that may be printed.

    Claims flagged ``removed`` cite a workspace item that no longer exists.
    Printing them would republish deleted information, so the export omits them.
    Sections left empty are omitted too.
    """
    sections: list[ResumeSection] = []
    for section in resume.sections:
        claims = [claim for claim in section.claims if not claim.removed]
        if claims:
            sections.append(ResumeSection(key=section.key, claims=claims))
    return sections


def _heading_for(key: str) -> str:
    return SECTION_HEADINGS.get(key, key.replace("_", " ").title())


def render_pdf(resume: ResumeResponse) -> tuple[bytes, list[str], list[str]]:
    """Render the PDF and return ``(bytes, headings, claims)`` actually printed."""
    _register_font()
    buffer = io.BytesIO()
    title = (resume.title or "Resume").strip() or "Resume"
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=title,
        author="ResumeIQ",
        subject="Resume",
        creator="ResumeIQ",
    )

    story: list[object] = []
    headings: list[str] = []
    claims: list[str] = []
    for section in visible_sections(resume):
        heading = _heading_for(section.key)
        story.append(Paragraph(escape(heading), _HEADING_STYLE))
        headings.append(heading)
        for claim in section.claims:
            story.append(Paragraph(escape(claim.text), _CLAIM_STYLE))
            claims.append(claim.text)
        story.append(Spacer(1, 2 * mm))

    document.build(story)
    return buffer.getvalue(), headings, claims


def verify_pdf(pdf_bytes: bytes, headings: list[str], claims: list[str]) -> ExportCheck:
    """Extract the text back and confirm every heading and claim is present."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    extracted = _normalise(" ".join(page.extract_text() or "" for page in reader.pages))
    missing_headings = sum(1 for heading in headings if _normalise(heading) not in extracted)
    missing_claims = sum(1 for claim in claims if _normalise(claim) not in extracted)
    return ExportCheck(
        sections_checked=len(headings),
        sections_missing=missing_headings,
        claims_checked=len(claims),
        claims_missing=missing_claims,
    )


def render_and_verify(resume: ResumeResponse) -> tuple[bytes, ExportCheck]:
    """Render plus the mandatory extraction check in one call."""
    pdf_bytes, headings, claims = render_pdf(resume)
    return pdf_bytes, verify_pdf(pdf_bytes, headings, claims)


def pdf_filename(resume: ResumeResponse) -> str:
    """An ASCII, header-safe download name derived from the resume title."""
    raw = (resume.title or "resume").strip() or "resume"
    ascii_title = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_title).strip("-").lower()
    return f"{(slug or 'resume')[:80]}.pdf"
