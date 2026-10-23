"""B6 export/privacy wire schemas (PRD §6.9 EX-1..EX-3).

The shapes are deliberately explicit: a data export must be usable without
reading the backend source, so every public table that can hold the caller's
data has its own key. Values are the stored JSON rows, which keeps soft-deleted
workspace items, day-precision dates and provenance columns intact.

No auth table is read or exported. ``userId``/``email`` come from the verified
access token, not from ``auth.users`` rows.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

JsonRow = dict[str, Any]


class AiCapabilities(BaseModel):
    """What the server can do with AI, without naming a provider or a model."""

    configured: bool
    analysisEnrichment: bool
    resumeRewording: bool


class AccountDeletionCapability(BaseModel):
    """Two-step truth: public data is removable here; the auth row is not.

    Supabase's self-service API has no "delete my auth user" call for a normal
    access token. Adding a service-role key to this process only to finish that
    step would give every request path an RLS-bypassing credential, so B6 stops
    after deleting every public row and exposes the remaining step explicitly.
    """

    dataDeletion: bool = True
    authUserDeletion: bool = False


class Capabilities(BaseModel):
    """``GET /capabilities`` — feature switches, never provider names or keys."""

    ai: AiCapabilities
    pdfExport: bool = True
    dataExport: bool = True
    accountDeletion: AccountDeletionCapability


class UserDataExport(BaseModel):
    """``GET /export`` — every public row owned by the caller, as stored JSON."""

    format: Literal["resumeiq.data-export.v1"] = "resumeiq.data-export.v1"
    exportedAt: str
    userId: str
    email: str | None = None

    workspace: list[JsonRow] = Field(default_factory=list)
    workspaceVersions: list[JsonRow] = Field(default_factory=list)
    evidenceLinks: list[JsonRow] = Field(default_factory=list)
    changeLog: list[JsonRow] = Field(default_factory=list)
    targets: list[JsonRow] = Field(default_factory=list)
    jdRequirements: list[JsonRow] = Field(default_factory=list)
    reports: list[JsonRow] = Field(default_factory=list)
    analysisRuns: list[JsonRow] = Field(default_factory=list)
    resumes: list[JsonRow] = Field(default_factory=list)
    resumeVersions: list[JsonRow] = Field(default_factory=list)
    resumeClaims: list[JsonRow] = Field(default_factory=list)
    consentRecords: list[JsonRow] = Field(default_factory=list)
    imports: list[JsonRow] = Field(default_factory=list)
    importReviewItems: list[JsonRow] = Field(default_factory=list)
    profile: JsonRow | None = None
    skills: list[JsonRow] = Field(default_factory=list)
    skillRelations: list[JsonRow] = Field(default_factory=list)
    auditEvents: list[JsonRow] = Field(default_factory=list)


class AccountDeleteRequest(BaseModel):
    """Explicit confirmation; a typo must never delete an account."""

    model_config = ConfigDict(extra="forbid")

    confirmation: str = Field(min_length=1, max_length=64, examples=["delete my account"])


class AccountDeletionResult(BaseModel):
    """What was actually removed.

    ``authUserDeleted`` is false in B6 on purpose. The response says so rather
    than claiming a complete account deletion. ``remainingStep`` is ``None``
    only when an auth-user deletion path was actually available and succeeded.
    """

    dataDeleted: bool
    authUserDeleted: bool
    remainingStep: Literal["auth_user"] | None = None
    deletedAt: str
    deletedCounts: dict[str, int] = Field(default_factory=dict)
    message: str
