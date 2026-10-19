"""Typed AI tasks (B3): evidence in, grounded claims out.

Every generation task returns a :class:`GroundedResult`: a list of claims, each
citing one or more supplied evidence ids. The prompts (``app/ai/prompts``) may
reword, classify and compress, but they may not add employers, titles, dates,
numbers or technologies (PRD RG-2..RG-4). The deterministic claim validator
(``app/ai/claims.py``) enforces that after generation.

These models double as the JSON-schema contract sent to the provider, so every
LLM-facing field is required and has no default: Groq's strict mode requires
exactly that (verified 2026-10-19, ADR-029).
"""

from __future__ import annotations

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

EvidenceId = Annotated[str, StringConstraints(min_length=1, max_length=64)]
ClaimText = Annotated[str, StringConstraints(min_length=1, max_length=600)]
ClaimT = TypeVar("ClaimT", bound="Claim")

EvidenceKind = Literal[
    "workspace_item",
    "job_description",
    "resume_parse",
    "requirement",
    "profile",
]

RequirementCategory = Literal["must_have", "nice_to_have", "responsibility", "keyword"]

ResumeFieldName = Literal[
    "full_name",
    "headline",
    "location",
    "email",
    "phone",
    "website",
    "linkedin",
    "github",
]


class EvidenceItem(BaseModel):
    """One piece of supplied evidence. The model sees only these."""

    model_config = ConfigDict(extra="forbid")

    id: EvidenceId
    kind: EvidenceKind
    text: Annotated[str, StringConstraints(min_length=1, max_length=4000)]
    #: Structured hints the validator may use as ground truth (technologies,
    #: organisations, titles, dates) when the free text is not explicit.
    technologies: list[str] = Field(default_factory=list, max_length=30)
    organizations: list[str] = Field(default_factory=list, max_length=30)
    titles: list[str] = Field(default_factory=list, max_length=30)
    dates: list[str] = Field(default_factory=list, max_length=30)


class Claim(BaseModel):
    """A generated statement and the evidence it must be grounded in."""

    model_config = ConfigDict(extra="forbid")

    text: ClaimText
    evidence_ids: Annotated[list[EvidenceId], Field(min_length=1, max_length=10)]


class RequirementClaim(Claim):
    """A job requirement, copied or compressed from the job description."""

    category: RequirementCategory


class FieldClaim(Claim):
    """One refined resume field; ``text`` carries the value."""

    field: ResumeFieldName


class GroundedResult(BaseModel, Generic[ClaimT]):
    """Base result: every task returns claims with evidence ids."""

    model_config = ConfigDict(extra="forbid")

    claims: Annotated[list[ClaimT], Field(min_length=1, max_length=25)]


class JobRequirementsResult(GroundedResult[RequirementClaim]):
    pass


class BulletRewriteResult(GroundedResult[Claim]):
    #: One rewritten bullet: reworded, never extended with new facts.
    claims: Annotated[list[Claim], Field(min_length=1, max_length=1)]


class GapExplanationResult(GroundedResult[Claim]):
    claims: Annotated[list[Claim], Field(min_length=1, max_length=5)]


class ResumeFieldsResult(GroundedResult[FieldClaim]):
    claims: Annotated[list[FieldClaim], Field(min_length=1, max_length=12)]


# --- Task inputs -----------------------------------------------------------


class ParseJobRequirementsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_description: Annotated[str, StringConstraints(min_length=1, max_length=12000)]


class RewriteBulletInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bullet: Annotated[str, StringConstraints(min_length=1, max_length=1200)]
    target_role: Annotated[str, StringConstraints(max_length=200)] = ""


class ExplainGapInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement: Annotated[str, StringConstraints(min_length=1, max_length=600)]
    gap_kind: Literal["not_evidenced", "missing"] = "not_evidenced"


class ExtractResumeFieldsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The deterministic parser's own text output. The model refines it; it may
    #: not read the original document (which B2 discards anyway).
    parser_text: Annotated[str, StringConstraints(min_length=1, max_length=12000)]


TaskInput = (
    ParseJobRequirementsInput | RewriteBulletInput | ExplainGapInput | ExtractResumeFieldsInput
)
