"""In-memory workspace repository.

Serves two purposes: the unit-test double for the workspace service/API, and a
readable reference for the versioning rules the Supabase implementation must
match (mirrors the F3 mock store in
``frontend/src/mocks/workspace-store.ts``):

* a brand-new workspace starts at version 1;
* every mutation bumps the version **exactly once** and appends change-log rows
  in the same commit;
* deletes are soft, so undo is a restore (logged as an edit);
* reorder bumps once but logs one row per moved id;
* the change log keeps the item label captured at write time.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import UTC, datetime

from app.repositories.errors import InvalidReorderError, ItemNotFoundError
from app.schemas.workspace import (
    Attachment,
    ChangeLogEntryResponse,
    WorkspaceItemCreate,
    WorkspaceItemResponse,
    WorkspaceResponse,
)

_GENESIS = "2026-10-16T09:00:00.000Z"
_COUNTER = {"n": 0}


def _iso_now() -> str:
    return datetime.now(UTC).isoformat()


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return slug[:24] or "item"


def _label(item: WorkspaceItemResponse) -> str:
    return item.title.strip() or "Untitled item"


class InMemoryWorkspaceRepository:
    """Per-user workspace state held in memory (tests only)."""

    def __init__(self, clock: Callable[[], str] | None = None) -> None:
        self._clock = clock or _iso_now
        self._items: dict[str, list[WorkspaceItemResponse]] = {}
        self._changelog: dict[str, list[ChangeLogEntryResponse]] = {}
        self._versions: dict[str, int] = {}
        self._updated_at: dict[str, str] = {}

    # -- reads ---------------------------------------------------------------
    async def get_workspace(self, user_id: str) -> WorkspaceResponse:
        items = sorted(self._active(user_id), key=lambda item: item.order)
        return WorkspaceResponse(
            version=self._versions.get(user_id, 1),
            items=items,
            updatedAt=self._updated_at.get(user_id, _GENESIS),
        )

    async def get_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse | None:
        for item in self._items.get(user_id, []):
            if item.id == item_id:
                return item.model_copy()
        return None

    async def list_changelog(self, user_id: str) -> list[ChangeLogEntryResponse]:
        return sorted(self._changelog.get(user_id, []), key=lambda e: e.seq, reverse=True)

    # -- writes --------------------------------------------------------------
    async def create_item(self, user_id: str, item: WorkspaceItemCreate) -> WorkspaceItemResponse:
        _COUNTER["n"] += 1
        items = self._items.setdefault(user_id, [])
        order = (
            max(
                (i.order for i in items if not i.deletedAt and i.section == item.section),
                default=-1,
            )
            + 1
        )
        created = WorkspaceItemResponse(
            id=f"ws-item-{item.section}-{_COUNTER['n']}-{_slug(item.title)}",
            section=item.section,
            title=item.title,
            organization=item.organization,
            startDate=item.startDate,
            endDate=item.endDate,
            location=item.location,
            bullets=list(item.bullets),
            tags=list(item.tags),
            links=list(item.links),
            attachments=[Attachment(**a.model_dump()) for a in item.attachments],
            evidence=item.evidence,
            order=order,
            deletedAt=None,
        )

        def apply() -> None:
            items.append(created)
            self._log(user_id, created.id, "add", _label(created))

        self._commit(user_id, apply)
        return created.model_copy()

    async def update_item(
        self, user_id: str, item_id: str, patch: dict[str, object]
    ) -> WorkspaceItemResponse:
        items = self._items.setdefault(user_id, [])
        index = self._active_index(user_id, item_id)
        if index is None:
            raise ItemNotFoundError(item_id)
        target = items[index]
        merged = WorkspaceItemResponse.model_validate(
            {**target.model_dump(), **patch, "id": target.id, "deletedAt": None}
        )

        def apply() -> None:
            items[index] = merged
            self._log(user_id, item_id, "edit", _label(merged))

        self._commit(user_id, apply)
        return merged.model_copy()

    async def soft_delete_item(self, user_id: str, item_id: str) -> None:
        items = self._items.setdefault(user_id, [])
        index = self._active_index(user_id, item_id)
        if index is None:
            raise ItemNotFoundError(item_id)
        target = items[index]
        deleted = target.model_copy(update={"deletedAt": self._clock()})

        def apply() -> None:
            items[index] = deleted
            self._log(user_id, item_id, "delete", _label(target))

        self._commit(user_id, apply)

    async def restore_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse:
        items = self._items.setdefault(user_id, [])
        index = next(
            (i for i, item in enumerate(items) if item.id == item_id and item.deletedAt),
            None,
        )
        if index is None:
            raise ItemNotFoundError(item_id)
        restored = items[index].model_copy(update={"deletedAt": None})

        def apply() -> None:
            items[index] = restored
            self._log(user_id, item_id, "edit", _label(restored))

        self._commit(user_id, apply)
        return restored.model_copy()

    async def reorder(
        self, user_id: str, section: str, ordered_ids: list[str]
    ) -> WorkspaceResponse:
        items = self._items.setdefault(user_id, [])
        active = {i.id: i for i in items if not i.deletedAt and i.section == section}
        unknown = [i for i in ordered_ids if i not in active]
        if unknown:
            raise InvalidReorderError(f"ids not in section '{section}': {unknown}")

        def apply() -> None:
            for position, item_id in enumerate(ordered_ids):
                target = active[item_id]
                items[items.index(target)] = target.model_copy(update={"order": position})
            for item_id in ordered_ids:
                self._log(user_id, item_id, "reorder", _label(active[item_id]))

        self._commit(user_id, apply)
        return await self.get_workspace(user_id)

    # -- internals -----------------------------------------------------------
    def _active(self, user_id: str) -> list[WorkspaceItemResponse]:
        return [i for i in self._items.get(user_id, []) if not i.deletedAt]

    def _active_index(self, user_id: str, item_id: str) -> int | None:
        return next(
            (
                i
                for i, item in enumerate(self._items.get(user_id, []))
                if item.id == item_id and not item.deletedAt
            ),
            None,
        )

    def _commit(self, user_id: str, mutate: Callable[[], None]) -> None:
        self._versions[user_id] = self._versions.get(user_id, 1) + 1
        self._updated_at[user_id] = self._clock()
        mutate()

    def _log(self, user_id: str, item_id: str, op: str, label: str | None) -> None:
        entries = self._changelog.setdefault(user_id, [])
        seq = (entries[-1].seq if entries else 0) + 1
        entries.append(
            ChangeLogEntryResponse(
                seq=seq,
                workspaceVersion=self._versions.get(user_id, 1),
                itemId=item_id,
                op=op,
                at=self._clock(),
                label=label,
            )
        )
