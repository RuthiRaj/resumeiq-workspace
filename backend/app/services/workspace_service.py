"""Workspace service (milestone B1).

Thin orchestration over :class:`~app.repositories.WorkspaceRepository`: it
enforces the app-level rules the DB cannot express (PRD §4.2 evidence rule,
date ordering) and derives the standard resume. Version bumping, the append-only
change log and soft-delete/restore live in the repository, which performs each
mutation atomically.
"""

from __future__ import annotations

from app.repositories.errors import ItemNotFoundError
from app.repositories.workspace import WorkspaceRepository
from app.schemas.resume import ResumeResponse
from app.schemas.workspace import (
    ChangeLogEntryResponse,
    WorkspaceItemCreate,
    WorkspaceItemResponse,
    WorkspaceItemUpdate,
    WorkspaceResponse,
    validate_item_rules,
)
from app.services.standard_resume import build_standard_resume


class WorkspaceService:
    def __init__(self, repository: WorkspaceRepository) -> None:
        self._repo = repository

    async def get_workspace(self, user_id: str) -> WorkspaceResponse:
        return await self._repo.get_workspace(user_id)

    async def get_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse:
        item = await self._repo.get_item(user_id, item_id)
        if item is None or item.deletedAt is not None:
            raise ItemNotFoundError(item_id)
        return item

    async def list_changelog(self, user_id: str) -> list[ChangeLogEntryResponse]:
        return await self._repo.list_changelog(user_id)

    async def create_item(self, user_id: str, item: WorkspaceItemCreate) -> WorkspaceItemResponse:
        # WorkspaceItemCreate already enforces the evidence + date rules.
        return await self._repo.create_item(user_id, item)

    async def update_item(
        self, user_id: str, item_id: str, update: WorkspaceItemUpdate
    ) -> WorkspaceItemResponse:
        patch = update.patch()
        current = await self._repo.get_item(user_id, item_id)
        if current is None or current.deletedAt is not None:
            raise ItemNotFoundError(item_id)
        # Validate the merged result, not just the patch, so an edit can neither
        # leave a verified item unsupported nor invert the date range.
        merged = current.model_copy(update={**patch, "id": current.id, "deletedAt": None})
        validate_item_rules(
            evidence=merged.evidence,
            attachments=merged.attachments,
            links=merged.links,
            start_date=merged.startDate,
            end_date=merged.endDate,
        )
        return await self._repo.update_item(user_id, item_id, patch)

    async def soft_delete_item(self, user_id: str, item_id: str) -> None:
        await self._repo.soft_delete_item(user_id, item_id)

    async def restore_item(self, user_id: str, item_id: str) -> WorkspaceItemResponse:
        return await self._repo.restore_item(user_id, item_id)

    async def reorder(
        self, user_id: str, section: str, ordered_ids: list[str]
    ) -> WorkspaceResponse:
        return await self._repo.reorder(user_id, section, ordered_ids)

    async def get_standard_resume(self, user_id: str) -> ResumeResponse:
        workspace = await self._repo.get_workspace(user_id)
        return build_standard_resume(workspace)
