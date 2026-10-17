"""Workspace API (milestone B1, PRD §6.1 WS-1..WS-6).

Endpoints, field names and enums mirror the F3 mock endpoints
(``frontend/src/mocks/handlers.ts``) so the MSW layer can be removed at B7
without a UI change:

* ``GET    /workspace``               — current version + active items
* ``GET    /workspace/changelog``     — append-only log, newest first
* ``GET    /workspace/items/{id}``    — a single active item
* ``POST   /workspace/items``         — create (201)
* ``PATCH  /workspace/items/{id}``    — partial update
* ``DELETE /workspace/items/{id}``    — soft delete (204)
* ``POST   /workspace/items/{id}/restore`` — undo a soft delete
* ``POST   /workspace/reorder``       — one version bump, PRD WS-6
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import UserClaims, get_current_user, get_workspace_service
from app.schemas.common import ErrorResponse
from app.schemas.workspace import (
    ChangeLogEntryResponse,
    WorkspaceItemCreate,
    WorkspaceItemResponse,
    WorkspaceItemUpdate,
    WorkspaceReorderRequest,
    WorkspaceResponse,
)
from app.services.workspace_service import WorkspaceService

router = APIRouter(
    tags=["workspace"],
    responses={401: {"model": ErrorResponse, "description": "Missing or invalid token."}},
)

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
WorkspaceSvc = Annotated[WorkspaceService, Depends(get_workspace_service)]


def _item_body_invalid(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"code": "invalid_item", "message": message},
    )


@router.get(
    "/workspace",
    response_model=WorkspaceResponse,
    response_model_exclude_none=True,
    summary="Get the workspace",
)
async def get_workspace(user: CurrentUser, service: WorkspaceSvc) -> WorkspaceResponse:
    return await service.get_workspace(user.sub)


@router.get(
    "/workspace/changelog",
    response_model=list[ChangeLogEntryResponse],
    response_model_exclude_none=True,
    summary="List the workspace change log (newest first)",
)
async def get_changelog(user: CurrentUser, service: WorkspaceSvc) -> list[ChangeLogEntryResponse]:
    return await service.list_changelog(user.sub)


@router.get(
    "/workspace/items/{item_id}",
    response_model=WorkspaceItemResponse,
    response_model_exclude_none=True,
    summary="Get a single workspace item",
)
async def get_item(item_id: str, user: CurrentUser, service: WorkspaceSvc) -> WorkspaceItemResponse:
    return await service.get_item(user.sub, item_id)


@router.post(
    "/workspace/items",
    response_model=WorkspaceItemResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace item",
)
async def create_item(
    payload: WorkspaceItemCreate, user: CurrentUser, service: WorkspaceSvc
) -> WorkspaceItemResponse:
    return await service.create_item(user.sub, payload)


@router.patch(
    "/workspace/items/{item_id}",
    response_model=WorkspaceItemResponse,
    response_model_exclude_none=True,
    summary="Update a workspace item",
)
async def update_item(
    item_id: str,
    payload: WorkspaceItemUpdate,
    user: CurrentUser,
    service: WorkspaceSvc,
) -> WorkspaceItemResponse:
    if not payload.patch():
        raise _item_body_invalid("No fields to update were provided.")
    try:
        return await service.update_item(user.sub, item_id, payload)
    except ValueError as exc:  # evidence / date rule violated by the merged item
        raise _item_body_invalid(str(exc)) from exc


@router.delete(
    "/workspace/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a workspace item (undo with restore)",
)
async def delete_item(item_id: str, user: CurrentUser, service: WorkspaceSvc) -> Response:
    await service.soft_delete_item(user.sub, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/workspace/items/{item_id}/restore",
    response_model=WorkspaceItemResponse,
    response_model_exclude_none=True,
    summary="Restore a soft-deleted workspace item",
)
async def restore_item(
    item_id: str, user: CurrentUser, service: WorkspaceSvc
) -> WorkspaceItemResponse:
    return await service.restore_item(user.sub, item_id)


@router.post(
    "/workspace/reorder",
    response_model=WorkspaceResponse,
    response_model_exclude_none=True,
    summary="Reorder a section's items (one version bump)",
)
async def reorder(
    payload: WorkspaceReorderRequest, user: CurrentUser, service: WorkspaceSvc
) -> WorkspaceResponse:
    return await service.reorder(user.sub, payload.section, payload.orderedIds)
