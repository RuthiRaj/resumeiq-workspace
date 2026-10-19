"""Content sniffing on magic bytes — never the file name alone (PRD §11).

A renamed ``.exe`` is not a PDF, and a ZIP that happens to be called ``.docx``
is only accepted when it is really a Word OOXML package. The same pass applies
the DOCX zip-bomb limits, so a hostile archive is rejected before ``python-docx``
sees it.
"""

from __future__ import annotations

import io
import zipfile
from typing import Final

from app.extraction.errors import DocumentRejectedError, UnsupportedFileTypeError
from app.schemas.imports import ImportFileType

PDF_MAGIC: Final[bytes] = b"%PDF-"
ZIP_MAGIC: Final[bytes] = b"PK\x03\x04"

MAX_ZIP_ENTRIES: Final[int] = 2_048
MAX_UNCOMPRESSED_BYTES: Final[int] = 64 * 1024 * 1024
MAX_COMPRESSION_RATIO: Final[float] = 200.0
_RATIO_CHECK_FLOOR: Final[int] = 1024 * 1024

DOCX_REQUIRED_ENTRIES: Final[tuple[str, ...]] = ("[Content_Types].xml", "word/document.xml")


def declared_type_from_name(file_name: str) -> ImportFileType | None:
    """The type the file name claims, or ``None`` when it is not permitted."""
    name = file_name.strip().lower()
    if name.endswith(".pdf"):
        return "pdf"
    if name.endswith(".docx"):
        return "docx"
    return None


def sniff_declared_type(data: bytes, declared: ImportFileType) -> None:
    """Raise unless ``data`` really is ``declared``.

    PDF: the ``%PDF-`` header. DOCX: a ZIP archive carrying the OOXML parts,
    also checked against the zip-bomb limits.
    """
    if declared == "pdf":
        if not data.startswith(PDF_MAGIC):
            raise UnsupportedFileTypeError("The file's contents are not a PDF.")
        return

    if not data.startswith(ZIP_MAGIC):
        raise UnsupportedFileTypeError("The file's contents are not a DOCX document.")
    with open_docx_zip(data) as archive:
        names = set(archive.namelist())
        if not all(entry in names for entry in DOCX_REQUIRED_ENTRIES):
            raise UnsupportedFileTypeError("The file is a ZIP archive, not a Word document.")
        guard_zip_bomb(archive)


def open_docx_zip(data: bytes) -> zipfile.ZipFile:
    """Open ``data`` as a ZIP archive, mapping a bad archive to a rejection."""
    try:
        return zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise DocumentRejectedError("The document archive is damaged.") from exc


def guard_zip_bomb(archive: zipfile.ZipFile) -> None:
    """Reject archives that could expand far beyond the upload limit."""
    infos = archive.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise DocumentRejectedError("The document has too many internal entries.")

    total_uncompressed = 0
    for info in infos:
        total_uncompressed += info.file_size
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise DocumentRejectedError("The document would expand too far to be safe.")
        if (
            info.compress_size > 0
            and info.file_size > _RATIO_CHECK_FLOOR
            and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO
        ):
            raise DocumentRejectedError("The document is not a plausible Word file.")
