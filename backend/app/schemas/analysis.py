"""Job targets, the analysis run and the report contract (B4).

Mirrors ``frontend/src/lib/schemas/analysis.ts`` (field names, enums and shapes)
and the agreed contract in ``docs/api/contract-proposals.md`` §3-§5, so the F4
MSW layer can be replaced by this API at B7 without a UI rewrite.

Two hard product rules the shapes encode (PRD §4.7):

* a score is an explainable weighted factor sum -- **never** a probability of
  being hired and never an ATS guarantee. The methodology strings (including
  both disclaimers) travel in the report so a backend wording change reaches the
  UI without a frontend release;
* ``analysis`` is ``null`` until a run actually succeeds -- there is never a
  placeholder score.
"""

from __future__ import annotations

from typing import Annotated, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.workspace import WorkspaceSection

RequirementKind = Literal["required", "preferred"]
RequirementStatus = Literal["matched", "partial", "unsupported"]
GapType = Literal["not_evidenced", "genuinely_missing"]
RequirementPattern = Literal["experience", "education", "seniority"]
ResumeTemplate = Literal["precision", "classic", "compact"]
TargetLength = Literal["one_page", "two_page"]
JobTargetStatus = Literal["draft", "analyzing", "ready", "failed"]
AnalysisRunStatus = Literal["running", "succeeded", "failed"]
AtsSeverity = Literal["low", "med", "high"]
AtsCheckStatus = Literal["pass", "issue", "not_checked"]

AnalysisStageKey = Literal["reading", "extracting", "searching", "matching", "scoring", "writing"]

#: The six theatre stages, in order (PRD §7.4.4). Keys are contract; labels may
#: change wording but not meaning.
ANALYSIS_STAGES: tuple[dict[str, str], ...] = (
    {"key": "reading", "label": "Reading the job", "detail": "Parsing the posting you pasted."},
    {
        "key": "extracting",
        "label": "Extracting requirements",
        "detail": "Pulling out must-haves, nice-to-haves and responsibilities.",
    },
    {
        "key": "searching",
        "label": "Searching your workspace",
        "detail": "Collecting items that could answer those requirements.",
    },
    {
        "key": "matching",
        "label": "Matching evidence",
        "detail": "Comparing each requirement with your evidence.",
    },
    {
        "key": "scoring",
        "label": "Scoring",
        "detail": "Applying the published weights to the matches.",
    },
    {
        "key": "writing",
        "label": "Writing report",
        "detail": "Assembling the report, gaps and roadmap.",
    },
)
ANALYSIS_STAGE_COUNT = len(ANALYSIS_STAGES)
ANALYSIS_STAGE_KEYS: tuple[AnalysisStageKey, ...] = tuple(
    cast(AnalysisStageKey, stage["key"]) for stage in ANALYSIS_STAGES
)

# --- Scoring constants (PRD §6.5) ------------------------------------------

#: Starting weights. Factor values are the share of that job's requirements the
#: workspace evidences; factors with no applicable requirements are dropped and
#: the remaining weights renormalised.
SCORE_WEIGHTS: tuple[dict[str, object], ...] = (
    {"key": "required_skills", "name": "Required skills", "weight": 0.4},
    {"key": "preferred_skills", "name": "Preferred skills", "weight": 0.15},
    {"key": "experience", "name": "Relevant experience", "weight": 0.2},
    {"key": "education", "name": "Education", "weight": 0.1},
    {"key": "projects", "name": "Projects & achievements", "weight": 0.15},
)

SCORE_METHODOLOGY_NOTE = (
    "Weighted average of the factors below. For each factor we count how much of that "
    "job's requirements your workspace evidence supports — matched counts fully, partially "
    "matched counts half, unsupported counts zero. A factor with no matching requirements "
    "instead reflects how deep your workspace is in that area. Weights are fixed for every "
    "job, factors with nothing to compare are dropped, and the remaining weights are "
    "renormalised."
)
SCORE_DISCLAIMER = "This is not a probability of being hired."
ATS_DISCLAIMER = "Based on defined checks. Not a guarantee for any employer's ATS."
ATS_CHECK_NOTE = (
    "Deterministic checks only — no LLM scored this. The score starts at 100 and each issue "
    "subtracts 12 (high), 7 (medium) or 3 (low) points. Every issue lists what was found and "
    "how to fix it."
)


class Methodology(BaseModel):
    note: str
    scoreDisclaimer: str
    atsDisclaimer: str
    atsNote: str


DEFAULT_METHODOLOGY = Methodology(
    note=SCORE_METHODOLOGY_NOTE,
    scoreDisclaimer=SCORE_DISCLAIMER,
    atsDisclaimer=ATS_DISCLAIMER,
    atsNote=ATS_CHECK_NOTE,
)


class Requirement(BaseModel):
    id: str
    #: Requirement text as it appears in the job description.
    text: str
    kind: RequirementKind
    #: Non-skill requirement shape this maps to, or absent for skill requirements.
    pattern: RequirementPattern | None = None
    status: RequirementStatus
    #: Present only when ``status`` is ``unsupported`` (JD-4).
    gapType: GapType | None = None
    #: Workspace item ids used as evidence (empty when unsupported).
    evidenceIds: list[str] = Field(default_factory=list)
    #: How the match was decided, in the user's words.
    explanation: str = ""


class ScoreFactor(BaseModel):
    name: str
    #: Weight as a fraction of 1 (effective weights in a report sum to 1).
    weight: float = Field(ge=0, le=1)
    #: Factor value 0-100.
    value: float = Field(ge=0, le=100)
    detail: str = ""


class AtsIssue(BaseModel):
    id: str
    severity: AtsSeverity
    message: str
    fix: str
    #: Longer explanation of the check that produced this issue.
    check: str = ""


class AtsExample(BaseModel):
    id: str
    issueId: str
    before: str
    after: str
    note: str


class AtsCheck(BaseModel):
    id: str
    label: str
    status: AtsCheckStatus
    detail: str
    #: Issues this check produced (empty when it passed).
    issueIds: list[str] = Field(default_factory=list)


class AtsKeyword(BaseModel):
    keyword: str
    present: bool
    requirementId: str | None = None


class AtsReport(BaseModel):
    score: float = Field(ge=0, le=100)
    keywordCoverage: float = Field(ge=0, le=100)
    keywords: list[AtsKeyword] = Field(default_factory=list)
    checks: list[AtsCheck] = Field(default_factory=list)
    issues: list[AtsIssue] = Field(default_factory=list)
    examples: list[AtsExample] = Field(default_factory=list)


class RoadmapStep(BaseModel):
    priority: int = Field(gt=0)
    action: str
    reason: str


class ContentDecision(BaseModel):
    itemId: str
    reason: str


class SkillFinding(BaseModel):
    name: str
    itemIds: list[str] = Field(default_factory=list)


class SkillGap(BaseModel):
    name: str
    reason: str


class SkillAnalysis(BaseModel):
    documented: list[SkillFinding] = Field(default_factory=list)
    demonstrated: list[SkillFinding] = Field(default_factory=list)
    notEvidenced: list[SkillGap] = Field(default_factory=list)
    toDevelop: list[SkillGap] = Field(default_factory=list)


class SectionToImprove(BaseModel):
    section: WorkspaceSection
    reason: str


class ContentReport(BaseModel):
    supportedRequirementIds: list[str] = Field(default_factory=list)
    needsEvidenceRequirementIds: list[str] = Field(default_factory=list)
    sectionsToImprove: list[SectionToImprove] = Field(default_factory=list)


class AnalysisReport(BaseModel):
    targetId: str
    #: Workspace version the report was computed from (staleness, PRD §6.8).
    workspaceVersion: int = Field(ge=0)
    generatedAt: str
    #: Job-match score 0-100. Displayed with methodology, never as P(hired).
    score: float = Field(ge=0, le=100)
    factors: list[ScoreFactor] = Field(default_factory=list)
    methodology: Methodology
    requirements: list[Requirement] = Field(default_factory=list)
    skills: SkillAnalysis
    included: list[ContentDecision] = Field(default_factory=list)
    excluded: list[ContentDecision] = Field(default_factory=list)
    content: ContentReport
    roadmap: list[RoadmapStep] = Field(default_factory=list)
    ats: AtsReport
    #: True when optional AI enrichment contributed to this report (B4). The
    #: deterministic score and classifications are never AI-derived.
    aiUsed: bool = False


# --- Targets ----------------------------------------------------------------


class TargetAnalysisSummary(BaseModel):
    score: float = Field(ge=0, le=100)
    analysedAt: str
    workspaceVersion: int = Field(ge=0)
    #: True when the workspace moved on after this analysis (PRD §6.8).
    stale: bool = False


class JobTarget(BaseModel):
    id: str
    role: str = Field(min_length=1)
    company: str | None = None
    jobDescription: str = Field(min_length=1)
    requiredSkills: list[str] = Field(default_factory=list)
    template: ResumeTemplate | None = None
    length: TargetLength | None = None
    status: JobTargetStatus = "draft"
    #: Present once an analysis has succeeded; never a placeholder score.
    analysis: TargetAnalysisSummary | None = None
    #: Dev fixtures only; always ``False`` for real users.
    sample: bool = False
    createdAt: str
    updatedAt: str


RoleText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
CompanyText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
JobDescriptionText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=40, max_length=20_000)
]
SkillText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class TargetCreate(BaseModel):
    """``POST /targets`` body (contract §3.3)."""

    model_config = ConfigDict(extra="ignore")

    role: RoleText
    company: CompanyText = ""
    jobDescription: JobDescriptionText
    requiredSkills: list[SkillText] = Field(default_factory=list, max_length=25)
    template: ResumeTemplate = "precision"
    length: TargetLength = "one_page"


# --- Analysis run -----------------------------------------------------------


class AnalysisFailure(BaseModel):
    code: str
    message: str
    stage: AnalysisStageKey


class AnalysisRun(BaseModel):
    id: str
    targetId: str
    status: AnalysisRunStatus
    stage: AnalysisStageKey
    stageIndex: int = Field(ge=0)
    stageCount: int = Field(gt=0)
    progress: float = Field(ge=0, le=100)
    workspaceVersion: int = Field(ge=0)
    startedAt: str
    updatedAt: str
    finishedAt: str | None = None
    failure: AnalysisFailure | None = None


class AnalysisRunResponse(BaseModel):
    run: AnalysisRun
    #: Present once the run succeeded.
    report: AnalysisReport | None = None
