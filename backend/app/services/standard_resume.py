"""Standard-resume derivation (PRD §6.3 SYN-1..3).

Deterministic and AI-free: it reads only the caller's *current, non-deleted*
workspace items, so deleted information can never appear in the standard resume
(SYN-2). Every claim points back at the workspace item id that evidences it
(SYN-3). Operates on the repository's wire view (:class:`WorkspaceResponse`),
which already excludes soft-deleted items and is scoped to one user.
"""

from __future__ import annotations

from app.schemas.resume import Claim, ResumeResponse, ResumeSection
from app.schemas.workspace import WORKSPACE_SECTION_ORDER, WorkspaceResponse

#: Standard resumes are derived fresh; the genesis stamp matches the mock layer.
_GENESIS = "2026-10-16T09:00:00.000Z"


def _header_claim_text(
    title: str, organization: str | None, start: str | None, end: str | None
) -> str:
    dates = " – ".join(part for part in (start, end) if part)
    return " · ".join(part for part in (title, organization, dates) if part and part.strip())


def build_standard_resume(workspace: WorkspaceResponse) -> ResumeResponse:
    """Build the standard resume from the current workspace state."""
    active = [item for item in workspace.items if item.deletedAt is None]
    sections: list[ResumeSection] = []
    for key in WORKSPACE_SECTION_ORDER:
        items = [item for item in active if item.section == key]
        if not items:
            continue
        claims: list[Claim] = []
        for item in items:
            # Confirmed only when the item is verified or user-attested;
            # related/missing surface as needing confirmation (PRD §4.2).
            confirmed = item.evidence in ("verified", "attested")
            claims.append(
                Claim(
                    text=_header_claim_text(
                        item.title, item.organization, item.startDate, item.endDate
                    ),
                    evidenceIds=[item.id],
                    confirmed=confirmed,
                )
            )
            for bullet in item.bullets:
                if bullet.strip():
                    claims.append(Claim(text=bullet, evidenceIds=[item.id], confirmed=confirmed))
        sections.append(ResumeSection(key=key, claims=claims))

    return ResumeResponse(
        id="resume-standard",
        kind="standard",
        targetId=None,
        workspaceVersion=workspace.version,
        stale=False,
        sections=sections,
        createdAt=_GENESIS,
        updatedAt=workspace.updatedAt,
    )
