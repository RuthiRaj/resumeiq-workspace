"""In-memory import repository.

The unit-test double for the import service/API, and a readable reference for the
rules the Supabase implementation must match:

* an import session is created with one review item per extracted candidate,
  each ``pending`` and carrying the parser's values (never raw extraction);
* ``support`` can be replaced with ``None`` (removing it) — the same
  absent-versus-explicit-null distinction the wire needs;
* confirming an item creates the workspace item **once** and is idempotent:
  confirming again returns the same workspace item rather than duplicating it.

It composes the workspace repository so the confirm path exercises the real
workspace rules (evidence, ordering, versioning) rather than re-implementing them.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from app.extraction.engine import ParsedDocument
from app.repositories.errors import (
    ImportReviewItemNotFoundError,
    ImportSessionNotFoundError,
)
from app.repositories.imports import initial_values, values_to_workspace_create
from app.repositories.memory import _iso_now
from app.repositories.workspace import WorkspaceRepository
from app.schemas.imports import (
    ImportFileType,
    ImportReviewItem,
    ImportSession,
    ImportSummary,
)
from app.schemas.workspace import WorkspaceItemCreate, WorkspaceItemResponse


class InMemoryImportRepository:
    """Per-user import state held in memory (tests only)."""

    def __init__(
        self,
        workspace: WorkspaceRepository,
        clock: Callable[[], str] | None = None,
    ) -> None:
        self._workspace = workspace
        self._clock = clock or _iso_now
        self._sessions: dict[str, ImportSession] = {}
        self._owners: dict[str, str] = {}
        # (import_id, wire item id) -> the workspace item it became.
        self._confirmed: dict[tuple[str, str], str] = {}

    # -- reads ---------------------------------------------------------------
    async def list_sessions(self, user_id: str) -> list[ImportSummary]:
        summaries = [
            ImportSummary(
                id=session.id,
                fileName=session.fileName,
                fileType=session.fileType,
                itemCount=len(session.items),
                pendingCount=sum(1 for item in session.items if item.status == "pending"),
                confirmedCount=sum(1 for item in session.items if item.status == "confirmed"),
                createdAt=session.createdAt,
            )
            for session in self._sessions.values()
            if self._owners.get(session.id) == user_id
        ]
        return sorted(summaries, key=lambda summary: summary.createdAt, reverse=True)

    async def get_session(self, user_id: str, import_id: str) -> ImportSession | None:
        session = self._sessions.get(import_id)
        if session is None or self._owners.get(import_id) != user_id:
            return None
        return session.model_copy(deep=True)

    # -- writes --------------------------------------------------------------
    async def create_session(
        self,
        user_id: str,
        *,
        file_name: str,
        file_type: ImportFileType,
        file_size: int,
        parsed: ParsedDocument,
    ) -> ImportSession:
        session_id = f"imp-{uuid4().hex[:12]}"
        now = self._clock()
        session = ImportSession(
            id=session_id,
            fileName=file_name,
            fileType=file_type,
            fileSize=file_size,
            pageCount=parsed.page_count,
            sourceText=parsed.source_text,
            previewAvailable=parsed.preview_available,
            items=[
                ImportReviewItem(
                    id=item.id,
                    extraction=item,
                    values=initial_values(item),
                    status="pending",
                    support=None,
                    decidedAt=None,
                )
                for item in parsed.items
            ],
            createdAt=now,
            updatedAt=now,
        )
        self._sessions[session_id] = session
        self._owners[session_id] = user_id
        return session.model_copy(deep=True)

    async def update_item(
        self, user_id: str, import_id: str, item_id: str, patch: dict[str, object]
    ) -> ImportReviewItem:
        session = self._owned(user_id, import_id)
        index = self._index_of(session, item_id)
        current = session.items[index]

        merged = current.model_dump()
        for key in ("values", "status", "support"):
            if key in patch:
                merged[key] = patch[key]
        updated = ImportReviewItem.model_validate(merged)

        items = list(session.items)
        items[index] = updated
        self._sessions[import_id] = session.model_copy(
            update={"items": items, "updatedAt": self._clock()}
        )
        return updated.model_copy(deep=True)

    async def confirm_item(
        self, user_id: str, import_id: str, item_id: str
    ) -> tuple[WorkspaceItemResponse, ImportReviewItem]:
        session = self._owned(user_id, import_id)
        index = self._index_of(session, item_id)
        current = session.items[index]

        # Idempotent: a second confirm returns the item the first one created.
        existing_id = self._confirmed.get((import_id, item_id))
        if existing_id is not None:
            workspace_item = await self._workspace.get_item(user_id, existing_id)
            if workspace_item is not None:
                return workspace_item, current.model_copy(deep=True)

        create: WorkspaceItemCreate = values_to_workspace_create(
            section=current.extraction.section,
            import_id=import_id,
            item_id=item_id,
            values=current.values,
            support=current.support,
        )
        workspace_item = await self._workspace.create_item(user_id, create)
        self._confirmed[(import_id, item_id)] = workspace_item.id

        updated = current.model_copy(update={"status": "confirmed", "decidedAt": self._clock()})
        items = list(session.items)
        items[index] = updated
        self._sessions[import_id] = session.model_copy(
            update={"items": items, "updatedAt": self._clock()}
        )
        return workspace_item, updated.model_copy(deep=True)

    # -- helpers -------------------------------------------------------------
    def _owned(self, user_id: str, import_id: str) -> ImportSession:
        session = self._sessions.get(import_id)
        if session is None or self._owners.get(import_id) != user_id:
            raise ImportSessionNotFoundError(import_id)
        return session

    @staticmethod
    def _index_of(session: ImportSession, item_id: str) -> int:
        for index, item in enumerate(session.items):
            if item.id == item_id:
                return index
        raise ImportReviewItemNotFoundError(item_id)
