"""Standard-resume wire schemas (milestone B1, PRD §6.3 SYN-1..3).

Mirrors ``frontend/src/lib/schemas/resume.ts``. A *claim* is a single statement
in the resume that points back at the workspace item(s) that evidence it; the
generation service never emits a claim whose evidence is missing (SYN-2/3).
"""

from typing import Literal

from pydantic import BaseModel, Field


class Claim(BaseModel):
    text: str
    #: Workspace item ids backing this claim. Empty = needs confirmation.
    evidenceIds: list[str] = Field(default_factory=list)
    #: True once a human confirmed an unsupported statement.
    confirmed: bool = False


class ResumeSection(BaseModel):
    key: str
    claims: list[Claim] = Field(default_factory=list)


class ResumeResponse(BaseModel):
    id: str
    kind: Literal["standard", "tailored"]
    targetId: str | None = None
    #: Workspace version this resume was generated from (staleness, PRD §6.8).
    workspaceVersion: int
    stale: bool = False
    sections: list[ResumeSection] = Field(default_factory=list)
    createdAt: str
    updatedAt: str
