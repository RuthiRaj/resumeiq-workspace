"""Import API (milestone B2, PRD §6.2 IM-1..IM-3).

Endpoints, field names and enums mirror the agreed contract in
``docs/api/contract-proposals.md`` §2 so the F4 MSW layer can be replaced by
this API at B7 without a UI change:

* ``POST   /imports``                          — upload a PDF/DOCX (201)
* ``GET    /imports``                          — recent imports (list rows)
* ``GET    /imports/{import_id}``              — one session with review items
* ``PATCH  /imports/{import_id}/items/{id}``   — edit values / status / support
* ``POST   /imports/{import_id}/items/{id}/confirm`` — atomically create the
  workspace item and mark the review item confirmed (201)

Nothing reaches the workspace until that last call succeeds.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.api.deps import UserClaims, get_current_user, get_import_service
from app.core.config import Settings
from app.schemas.common import ErrorResponse
from app.schemas.imports import (
    ImportConfirmResponse,
    ImportItemPatch,
    ImportReviewItem,
    ImportSession,
    ImportSummary,
    ImportUploadResponse,
)
from app.services.import_service import ImportService

router = APIRouter(
    tags=["imports"],
    responses={401: {"model": ErrorResponse, "description": "Missing or invalid token."}},
)

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
ImportSvc = Annotated[ImportService, Depends(get_import_service)]


def _file_required() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": "import_file_required", "message": "Choose a PDF or DOCX file first."},
    )


def _values_invalid(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"code": "values_invalid", "message": message},
    )


@router.post(
    "/imports",
    response_model=ImportUploadResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document for extraction review",
    description=(
        "Accepts a PDF or DOCX (multipart field `file`), sniffed on magic bytes "
        "(not the file name), capped at the configured import size. The document "
        "is parsed in memory and discarded; only the extracted text and candidate "
        "items are stored. Document contents are never logged."
    ),
)
async def create_import(
    request: Request,
    user: CurrentUser,
    service: ImportSvc,
    file: Annotated[UploadFile | None, File()] = None,
) -> ImportUploadResponse:
    if file is None:
        raise _file_required()

    settings: Settings = request.app.state.settings
    # Read at most one byte past the cap so an oversized upload is detected
    # without ever holding more than the cap in memory.
    data = await file.read(settings.max_import_bytes + 1)
    await file.close()

    session = await service.create_import(
        user.sub, file_name=(file.filename or "").strip(), data=data
    )
    return ImportUploadResponse(session=session)


@router.get(
    "/imports",
    response_model=list[ImportSummary],
    response_model_exclude_none=True,
    summary="List recent imports",
)
async def list_imports(user: CurrentUser, service: ImportSvc) -> list[ImportSummary]:
    return await service.list_imports(user.sub)


@router.get(
    "/imports/{import_id}",
    response_model=ImportSession,
    response_model_exclude_none=True,
    summary="Get an import session with its review items",
)
async def get_import(import_id: str, user: CurrentUser, service: ImportSvc) -> ImportSession:
    return await service.get_import(user.sub, import_id)


@router.patch(
    "/imports/{import_id}/items/{item_id}",
    response_model=ImportReviewItem,
    response_model_exclude_none=True,
    summary="Update a review item (values, status or certificate support)",
)
async def update_item(
    import_id: str,
    item_id: str,
    payload: ImportItemPatch,
    user: CurrentUser,
    service: ImportSvc,
) -> ImportReviewItem:
    patch = payload.patch()
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "invalid_request",
                "message": "Provide values, a status or support to update.",
            },
        )
    try:
        return await service.update_item(user.sub, import_id, item_id, patch)
    except ValueError as exc:
        raise _values_invalid(str(exc)) from exc


@router.post(
    "/imports/{import_id}/items/{item_id}/confirm",
    response_model=ImportConfirmResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
    summary="Confirm a review item into the workspace",
    description=(
        "Creates the workspace item from the user's verified values and marks the "
        "review item confirmed, in one transaction. Confirmed items are "
        "User-attested unless an external verification link is attached (then "
        "Verified). User-uploaded files do not count as verification. Idempotent: "
        "confirming twice returns the same workspace item."
    ),
)
async def confirm_item(
    import_id: str, item_id: str, user: CurrentUser, service: ImportSvc
) -> ImportConfirmResponse:
    try:
        workspace_item, review = await service.confirm_item(user.sub, import_id, item_id)
    except ValueError as exc:
        raise _values_invalid(str(exc)) from exc
    return ImportConfirmResponse(item=workspace_item, review=review)
