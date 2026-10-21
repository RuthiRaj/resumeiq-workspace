"""Resume wire schemas (B1 standard resume + B5 tailored resumes).

Mirrors ``frontend/src/lib/schemas/resume.ts``. A *claim* is a single statement
in the resume that points back at the workspace item(s) that evidence it; the
generation service never emits a claim whose evidence is missing (SYN-2/3).
B5 adds the tailored-resume fields (title, AI flag, ATS result, edited sections)
and the version/diff/refresh shapes in ``docs/api/contract-proposals.md`` §6.

Every statement carries ``evidenceIds``. ``removed`` is computed on read: it is
true when a cited workspace item has been deleted since the resume was built, so
the UI can flag the line for removal without silently dropping it (RG-6).
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.analysis import AtsReport
from app.schemas.workspace import EvidenceState

ResumeKind = Literal["standard", "tailored"]
ResumeVersionReason = Literal["generated", "edited", "restored", "refreshed"]

TitleText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ClaimText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
EvidenceId = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class Claim(BaseModel):
    text: str
    #: Workspace item ids backing this claim. Empty = needs confirmation.
    evidenceIds: list[str] = Field(default_factory=list)
    #: True once a human confirmed an unsupported statement.
    confirmed: bool = False
    #: True when the optional AI rewording produced this text (B5).
    aiRewritten: bool = False
    #: Computed on read: a cited item no longer exists in the workspace.
    removed: bool = False


class ResumeSection(BaseModel):
    key: str
    claims: list[Claim] = Field(default_factory=list)


class ResumeEvidence(BaseModel):
    """Snapshot of an item the resume cited, used for diff/refresh (B5).

    Never sent to the client directly; it is persisted in
    ``resumes.source_evidence`` and in ``resume_versions.snapshot``. The
    ``fingerprint`` is a deterministic hash of the content fields (not the
    workspace position), so moving an item around is not reported as an edit.
    """

    itemId: str
    section: str
    title: str
    organization: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    location: str | None = None
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    evidence: EvidenceState
    order: int = 0
    fingerprint: str


class ResumeResponse(BaseModel):
    id: str
    kind: ResumeKind
    targetId: str | None = None
    title: str | None = None
    #: Workspace version this resume was generated from (staleness, PRD §6.8).
    workspaceVersion: int
    stale: bool = False
    sections: list[ResumeSection] = Field(default_factory=list)
    createdAt: str
    updatedAt: str
    #: True when at least one visible claim was produced by the AI reworder.
    aiUsed: bool = False
    #: Deterministic ATS checks run on the generated resume (PRD §6.7).
    ats: AtsReport | None = None
    #: Section keys the user edited by hand; refresh never overwrites them
    #: unless that section is named explicitly in ``overwriteEditedSections``.
    editedSections: list[str] = Field(default_factory=list)
    #: Cited item ids that no longer exist in the current workspace.
    removedEvidenceIds: list[str] = Field(default_factory=list)


class ResumeSummary(BaseModel):
    """List row for ``GET /resumes`` (standard + tailored)."""

    id: str
    kind: ResumeKind
    targetId: str | None = None
    title: str | None = None
    workspaceVersion: int
    stale: bool = False
    aiUsed: bool = False
    editedSections: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str


class ResumeVersionResponse(BaseModel):
    id: str
    resumeId: str
    workspaceVersion: int
    createdAt: str
    reason: ResumeVersionReason
    title: str | None = None
    aiUsed: bool = False
    sections: list[ResumeSection] = Field(default_factory=list)
    ats: AtsReport | None = None
    editedSections: list[str] = Field(default_factory=list)


# --- Requests ---------------------------------------------------------------


class ResumeGenerateRequest(BaseModel):
    """``POST /targets/{target_id}/resume`` body (contract §6.1)."""

    model_config = ConfigDict(extra="ignore")

    title: TitleText | None = None
    #: Opt-in: requires a configured provider *and* recorded AI consent.
    rewordWithAi: bool = False


class ResumeClaimEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: ClaimText
    evidenceIds: list[EvidenceId] = Field(min_length=1, max_length=10)


class ResumeSectionEdit(BaseModel):
    """``PATCH /resumes/{id}/sections/{key}`` body: the section's new claims."""

    model_config = ConfigDict(extra="forbid")

    claims: list[ResumeClaimEdit] = Field(min_length=1, max_length=50)


class ResumeRefreshRequest(BaseModel):
    """``POST /resumes/{id}/refresh`` body (contract §6.6)."""

    model_config = ConfigDict(extra="ignore")

    #: Empty = every section. Only unedited sections are refreshed.
    sections: list[str] = Field(default_factory=list, max_length=20)
    #: Explicit per-section choice to replace hand-edited content too.
    overwriteEditedSections: list[str] = Field(default_factory=list, max_length=20)
    rewordWithAi: bool = False


# --- Diff / refresh results -------------------------------------------------


class ResumeDiffEntry(BaseModel):
    itemId: str
    section: str
    title: str


class ResumeDiff(BaseModel):
    """``GET /resumes/{id}/diff`` — the resume against the current workspace."""

    resumeId: str
    targetId: str | None = None
    workspaceVersion: int
    currentWorkspaceVersion: int
    stale: bool
    added: list[ResumeDiffEntry] = Field(default_factory=list)
    removed: list[ResumeDiffEntry] = Field(default_factory=list)
    edited: list[ResumeDiffEntry] = Field(default_factory=list)
    changedSections: list[str] = Field(default_factory=list)
    removedEvidenceIds: list[str] = Field(default_factory=list)


class ResumeRefreshSkip(BaseModel):
    section: str
    reason: Literal["edited"] = "edited"


class ResumeRefreshResponse(BaseModel):
    resume: ResumeResponse
    refreshedSections: list[str] = Field(default_factory=list)
    skippedSections: list[ResumeRefreshSkip] = Field(default_factory=list)
