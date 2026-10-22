"""Export, capabilities and account privacy API (milestone B6, PRD §6.9).

Endpoints mirror ``docs/api/contract-proposals.md`` §9:

* ``GET    /capabilities`` -- feature switches, never a provider name or key;
* ``GET    /export``       -- every public row owned by the caller (JSON);
* ``DELETE /account``      -- delete the caller's public rows after an explicit
  confirmation, and report honestly that the auth identity remains.

Every route is authenticated; no request accepts a user id, so the token's
``sub`` is the only selector. The export response is never cached.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.api.deps import UserClaims, get_current_user, get_privacy_service
from app.schemas.privacy import (
    AccountDeleteRequest,
    AccountDeletionCapability,
    AccountDeletionResult,
    AiCapabilities,
    Capabilities,
    UserDataExport,
)
from app.services.privacy_service import PrivacyService

router = APIRouter(tags=["privacy"])

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
Privacy = Annotated[PrivacyService, Depends(get_privacy_service)]


@router.get(
    "/capabilities",
    response_model=Capabilities,
    summary="Report which optional features this server can offer",
)
async def capabilities(
    request: Request,
    _user: CurrentUser,
) -> Capabilities:
    """Feature switches only: no provider, model, URL or key is disclosed."""
    settings = request.app.state.settings
    ai_configured = bool(settings.ai_configured)
    data_configured = bool(settings.data_api_configured)
    return Capabilities(
        ai=AiCapabilities(
            configured=ai_configured,
            analysisEnrichment=ai_configured,
            resumeRewording=ai_configured,
        ),
        pdfExport=data_configured,
        dataExport=data_configured,
        accountDeletion=AccountDeletionCapability(
            dataDeletion=data_configured,
            # No service-role key is held by this process (ADR-043).
            authUserDeletion=False,
        ),
    )


@router.get(
    "/export",
    response_model=UserDataExport,
    summary="Download every record this account owns",
    response_class=JSONResponse,
    responses={503: {"description": "data_export_unavailable"}},
)
async def export_data(user: CurrentUser, service: Privacy) -> JSONResponse:
    export = await service.export_user(user.sub, user.email)
    return JSONResponse(
        content=export.model_dump(mode="json"),
        headers={
            "Content-Disposition": 'attachment; filename="resumeiq-data-export.json"',
            "Cache-Control": "no-store",
        },
    )


@router.delete(
    "/account",
    response_model=AccountDeletionResult,
    summary="Delete this account's data after an explicit confirmation",
    responses={
        400: {"description": "account_confirmation_required"},
        503: {"description": "account_deletion_unavailable"},
    },
)
async def delete_account(
    body: AccountDeleteRequest,
    user: CurrentUser,
    service: Privacy,
) -> AccountDeletionResult:
    return await service.delete_account(user.sub, body.confirmation)
