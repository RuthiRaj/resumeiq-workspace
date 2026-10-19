"""Import service (milestone B2, PRD §6.2 IM-1..IM-3).

Orchestrates upload → extract → review → confirm. It owns the rules the parser
and the repository cannot express:

* the upload must really be what the file name claims — content is sniffed on
  magic bytes, never trusted from the extension (PRD §11);
* the upload is parsed **in memory and then discarded**; nothing about the
  original file is stored, and its bytes and extracted text are never logged;
* extraction is deterministic: no OCR, no AI calls;
* nothing reaches the workspace until the user confirms an item, and a confirmed
  item is User-attested unless a certificate was attached (IM-2/IM-3).
"""

from __future__ import annotations

import asyncio

from app.core.logging import get_logger
from app.extraction.engine import ExtractionEngine
from app.extraction.errors import (
    DocumentRejectedError,
    ExtractionError,
    ExtractionUnavailableError,
    UnsupportedFileTypeError,
)
from app.extraction.sniffing import declared_type_from_name, sniff_declared_type
from app.repositories.errors import ImportReviewItemNotFoundError, ImportSessionNotFoundError
from app.repositories.imports import ImportRepository
from app.schemas.imports import ImportReviewItem, ImportSession, ImportSummary
from app.schemas.workspace import WorkspaceItemResponse

logger = get_logger(__name__)


class ImportFileTooLargeError(Exception):
    """The upload exceeds the configured cap (PRD §11)."""

    def __init__(self, max_bytes: int) -> None:
        super().__init__(f"Files must be {max_bytes // (1024 * 1024)} MB or smaller.")
        self.max_bytes = max_bytes


class ImportService:
    """Uploads, review items and the confirm-to-workspace transition."""

    def __init__(
        self,
        repository: ImportRepository,
        engine: ExtractionEngine,
        *,
        max_file_bytes: int,
    ) -> None:
        self._repo = repository
        self._engine = engine
        self._max_file_bytes = max_file_bytes

    async def create_import(self, user_id: str, *, file_name: str, data: bytes) -> ImportSession:
        """Validate, extract and persist a review session.

        Only the extracted text and the candidate items are persisted; ``data``
        is a local reference that goes out of scope with this call, so the
        original document is never stored (PRD §11).
        """
        if len(data) > self._max_file_bytes:
            raise ImportFileTooLargeError(self._max_file_bytes)
        if not data:
            raise DocumentRejectedError("That file looks empty. Pick another one.")

        declared = declared_type_from_name(file_name)
        if declared is None:
            raise UnsupportedFileTypeError("Only PDF and DOCX files can be imported.")
        sniff_declared_type(data, declared)

        try:
            parsed = await asyncio.to_thread(self._engine.extract, data, declared)
        except ExtractionError:
            raise
        except Exception as exc:
            # Log the exception *type* only: never the document or its text.
            logger.error("import extraction failed (%s)", type(exc).__name__)
            raise ExtractionUnavailableError("The document could not be read.") from exc

        logger.info(
            "import extracted",
            extra={"file_type": declared, "file_size": len(data), "item_count": len(parsed.items)},
        )
        return await self._repo.create_session(
            user_id,
            file_name=file_name,
            file_type=declared,
            file_size=len(data),
            parsed=parsed,
        )

    async def list_imports(self, user_id: str) -> list[ImportSummary]:
        return await self._repo.list_sessions(user_id)

    async def get_import(self, user_id: str, import_id: str) -> ImportSession:
        session = await self._repo.get_session(user_id, import_id)
        if session is None:
            raise ImportSessionNotFoundError(import_id)
        return session

    async def update_item(
        self, user_id: str, import_id: str, item_id: str, patch: dict[str, object]
    ) -> ImportReviewItem:
        """Apply a review item patch; raise ``ValueError`` when values break a rule."""
        values = patch.get("values")
        if isinstance(values, dict):
            _check_date_order(values)
        return await self._repo.update_item(user_id, import_id, item_id, patch)

    async def confirm_item(
        self, user_id: str, import_id: str, item_id: str
    ) -> tuple[WorkspaceItemResponse, ImportReviewItem]:
        """Move a reviewed item into the workspace — the only way in (IM-2)."""
        session = await self.get_import(user_id, import_id)
        review = next((item for item in session.items if item.id == item_id), None)
        if review is None:
            raise ImportReviewItemNotFoundError(item_id)

        if not review.values.title.strip():
            raise ValueError("Add a title before confirming — nothing is saved without one.")
        _check_date_order(review.values.model_dump())

        return await self._repo.confirm_item(user_id, import_id, item_id)


def _check_date_order(values: dict[str, object]) -> None:
    start = str(values.get("startDate") or "")
    end = str(values.get("endDate") or "")
    if start and end and start > end:
        raise ValueError("The end date can't be before the start date.")
