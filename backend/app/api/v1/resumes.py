"""Tailored-resume API (milestone B5).

Endpoints mirror ``docs/api/contract-proposals.md`` §6:

* ``POST   /targets/{target_id}/resume``                     -- generate (201)
* ``GET    /resumes``                                        -- standard + tailored
* ``GET    /resumes/{resume_id}``                            -- one resume
* ``PATCH  /resumes/{resume_id}/sections/{section_key}``     -- hand edit
* ``GET    /resumes/{resume_id}/versions``                   -- history
* ``POST   /resumes/{resume_id}/versions/{version_id}/restore``
* ``POST   /resumes/{resume_id}/stale``                      -- flag stale
* ``GET    /resumes/{resume_id}/diff``                       -- vs workspace
* ``POST   /resumes/{resume_id}/refresh``                    -- selective refresh

``GET /resume/standard`` (B1) stays untouched; the standard resume is *also*
returned by the list and by ``GET /resumes/resume-standard`` with the same id.

AI rewording is opt-in per request. It is refused unless a provider is
configured (``ai_not_configured``) and the caller has recorded AI-processing
consent (``ai_consent_required``); otherwise generation is deterministic.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.ai.consent import ConsentGrant
from app.ai.errors import AINotConfiguredError
from app.api.deps import (
    UserClaims,
    get_current_user,
    get_resume_reworder,
    get_resume_service,
    require_ai_consent,
)
from app.export.errors import ExportVerificationError
from app.export.pdf import pdf_filename, render_and_verify
from app.schemas.resume import (
    ResumeDiff,
    ResumeGenerateRequest,
    ResumePurgeResult,
    ResumeRefreshRequest,
    ResumeRefreshResponse,
    ResumeResponse,
    ResumeSectionEdit,
    ResumeSummary,
    ResumeVersionPurgeResult,
    ResumeVersionResponse,
)
from app.services.resume_service import ResumeService

router = APIRouter(tags=["resumes"])

CurrentUser = Annotated[UserClaims, Depends(get_current_user)]
Resumes = Annotated[ResumeService, Depends(get_resume_service)]


def _ai_consent(request: Request, user: UserClaims, *, requested: bool) -> ConsentGrant | None:
    """Return the grant only when AI was requested and every gate passed."""
    if not requested:
        return None
    if get_resume_reworder(request) is None:
        raise AINotConfiguredError()
    return require_ai_consent(request, user)


@router.post(
    "/targets/{target_id}/resume",
    response_model=ResumeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a tailored resume for a target",
    responses={
        403: {"description": "ai_consent_required"},
        404: {"description": "target_not_found"},
        409: {"description": "analysis_required | analysis_stale"},
        503: {"description": "ai_not_configured"},
    },
)
async def generate_resume(
    target_id: str,
    body: ResumeGenerateRequest,
    request: Request,
    user: CurrentUser,
    service: Resumes,
) -> ResumeResponse:
    consent = _ai_consent(request, user, requested=body.rewordWithAi)
    return await service.generate(
        user.sub,
        target_id,
        title=body.title,
        reword_with_ai=body.rewordWithAi,
        consent=consent,
    )


@router.get(
    "/resumes",
    response_model=list[ResumeSummary],
    summary="List the caller's standard and tailored resumes",
)
async def list_resumes(user: CurrentUser, service: Resumes) -> list[ResumeSummary]:
    return await service.list_resumes(user.sub)


@router.get(
    "/resumes/{resume_id}",
    response_model=ResumeResponse,
    summary="Read one resume",
    responses={404: {"description": "resume_not_found"}},
)
async def get_resume(resume_id: str, user: CurrentUser, service: Resumes) -> ResumeResponse:
    return await service.get_resume(user.sub, resume_id)


@router.patch(
    "/resumes/{resume_id}/sections/{section_key}",
    response_model=ResumeResponse,
    summary="Replace one tailored-resume section by hand",
    responses={
        404: {"description": "resume_not_found | resume_section_not_found"},
        409: {"description": "resume_not_tailored"},
        422: {"description": "resume_evidence_not_found | resume_claim_ungrounded"},
    },
)
async def edit_section(
    resume_id: str,
    section_key: str,
    edit: ResumeSectionEdit,
    user: CurrentUser,
    service: Resumes,
) -> ResumeResponse:
    return await service.edit_section(user.sub, resume_id, section_key, edit)


@router.get(
    "/resumes/{resume_id}/versions",
    response_model=list[ResumeVersionResponse],
    summary="List a tailored resume's insert-only versions",
    responses={
        404: {"description": "resume_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def list_versions(
    resume_id: str, user: CurrentUser, service: Resumes
) -> list[ResumeVersionResponse]:
    return await service.list_versions(user.sub, resume_id)


@router.post(
    "/resumes/{resume_id}/versions/{version_id}/restore",
    response_model=ResumeResponse,
    summary="Restore a version as a new version (non-destructive)",
    responses={
        404: {"description": "resume_not_found | resume_version_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def restore_version(
    resume_id: str,
    version_id: str,
    user: CurrentUser,
    service: Resumes,
) -> ResumeResponse:
    return await service.restore(user.sub, resume_id, version_id)


@router.post(
    "/resumes/{resume_id}/stale",
    response_model=ResumeResponse,
    summary="Mark a tailored resume stale",
    responses={
        404: {"description": "resume_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def mark_stale(resume_id: str, user: CurrentUser, service: Resumes) -> ResumeResponse:
    return await service.mark_stale(user.sub, resume_id)


@router.get(
    "/resumes/{resume_id}/diff",
    response_model=ResumeDiff,
    summary="Diff a resume against the current workspace",
    responses={404: {"description": "resume_not_found"}},
)
async def diff_resume(resume_id: str, user: CurrentUser, service: Resumes) -> ResumeDiff:
    return await service.diff(user.sub, resume_id)


@router.post(
    "/resumes/{resume_id}/refresh",
    response_model=ResumeRefreshResponse,
    summary="Refresh unedited sections from the current workspace",
    responses={
        403: {"description": "ai_consent_required"},
        404: {"description": "resume_not_found | target_not_found"},
        409: {"description": "resume_not_tailored | analysis_required"},
        422: {"description": "resume_section_invalid"},
        503: {"description": "ai_not_configured"},
    },
)
async def refresh_resume(
    resume_id: str,
    body: ResumeRefreshRequest,
    request: Request,
    user: CurrentUser,
    service: Resumes,
) -> ResumeRefreshResponse:
    consent = _ai_consent(request, user, requested=body.rewordWithAi)
    return await service.refresh(user.sub, resume_id, body, consent=consent)


# --- Deletion, purge and PDF export (B6) ------------------------------------


@router.delete(
    "/resumes/{resume_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Permanently delete a tailored resume and its history",
    responses={
        404: {"description": "resume_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def delete_resume(resume_id: str, user: CurrentUser, service: Resumes) -> Response:
    await service.delete_resume(user.sub, resume_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/resumes/{resume_id}/versions/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete one saved resume version",
    responses={
        404: {"description": "resume_not_found | resume_version_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def delete_version(
    resume_id: str,
    version_id: str,
    user: CurrentUser,
    service: Resumes,
) -> Response:
    await service.delete_version(user.sub, resume_id, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/resumes/{resume_id}/purge",
    response_model=ResumePurgeResult,
    summary="Remove claims that cite deleted workspace items",
    responses={
        404: {"description": "resume_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def purge_resume(resume_id: str, user: CurrentUser, service: Resumes) -> ResumePurgeResult:
    return await service.purge(user.sub, resume_id)


@router.post(
    "/resumes/{resume_id}/versions/{version_id}/purge",
    response_model=ResumeVersionPurgeResult,
    summary="Remove removed-item claims from one saved version",
    responses={
        404: {"description": "resume_not_found | resume_version_not_found"},
        409: {"description": "resume_not_tailored"},
    },
)
async def purge_version(
    resume_id: str,
    version_id: str,
    user: CurrentUser,
    service: Resumes,
) -> ResumeVersionPurgeResult:
    return await service.purge_version(user.sub, resume_id, version_id)


@router.get(
    "/resumes/{resume_id}/export.pdf",
    response_class=Response,
    response_model=None,
    summary="Stream a single-column, text-selectable resume PDF",
    responses={
        200: {
            "content": {"application/pdf": {}},
            "description": (
                "The generated PDF. X-Export-* headers report the text-extraction check."
            ),
        },
        404: {"description": "resume_not_found"},
        502: {"description": "export_verification_failed"},
    },
)
async def export_resume_pdf(resume_id: str, user: CurrentUser, service: Resumes) -> Response:
    resume = await service.get_resume(user.sub, resume_id)
    pdf_bytes, check = render_and_verify(resume)
    if not check.passed:
        raise ExportVerificationError(check)
    headers = {
        **check.headers(),
        "Content-Disposition": f'attachment; filename="{pdf_filename(resume)}"',
        # Generated per request, served from memory and never persisted.
        "Cache-Control": "no-store",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
