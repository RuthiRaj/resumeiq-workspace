import { z } from "zod";
import { WorkspaceSectionSchema } from "./workspace";

/**
 * Job targets, the analysis theatre and the AI report contract
 * (PRD §6.4 JD-1..JD-5, §6.5 score methodology, §6.6 report, §6.7 ATS,
 * §7.5 `/targets*`). Scores here are explainable weighted factor sums —
 * never a hiring probability and never an ATS guarantee (PRD §4.7).
 * The B4 backend must serve exactly these shapes.
 */

export const RequirementKindSchema = z.enum(["required", "preferred"]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const RequirementStatusSchema = z.enum([
  "matched",
  "partial",
  "unsupported",
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

/** Unsupported-requirement gap split (PRD §6.4 JD-4). */
export const GapTypeSchema = z.enum(["not_evidenced", "genuinely_missing"]);
export type GapType = z.infer<typeof GapTypeSchema>;

export const RequirementSchema = z.object({
  id: z.string(),
  /** Requirement text as it appears in the job description. */
  text: z.string(),
  kind: RequirementKindSchema,
  /**
   * Non-skill requirement shape this maps to, when it did not come from the
   * skill taxonomy (`null`/absent for skill requirements).
   */
  pattern: z.enum(["experience", "education", "seniority"]).nullish(),
  status: RequirementStatusSchema,
  /** Present only when `status` is `unsupported` (JD-4). */
  gapType: GapTypeSchema.nullish(),
  /** Workspace item ids used as evidence (empty when unsupported). */
  evidenceIds: z.array(z.string()).default([]),
  /**
   * How the match was decided, in the user's words. Shown next to the status
   * so a classification is never a black box (PRD §7.7).
   */
  explanation: z.string().default(""),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const ScoreFactorSchema = z.object({
  name: z.string(),
  /** Weight as a fraction of 1 (e.g. 0.40). Effective weights sum to 1. */
  weight: z.number().min(0).max(1),
  /** Factor value 0–100. */
  value: z.number().min(0).max(100),
  /** One line explaining how this factor's value was reached. */
  detail: z.string().default(""),
});
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

/**
 * Starting weights (PRD §6.5). Factor values are the share of that job's
 * requirements the workspace evidences; factors with no applicable
 * requirements are dropped and the remaining weights renormalised.
 */
export const SCORE_WEIGHTS = [
  { key: "required_skills", name: "Required skills", weight: 0.4 },
  { key: "preferred_skills", name: "Preferred skills", weight: 0.15 },
  { key: "experience", name: "Relevant experience", weight: 0.2 },
  { key: "education", name: "Education", weight: 0.1 },
  { key: "projects", name: "Projects & achievements", weight: 0.15 },
] as const;

export const SCORE_METHODOLOGY_NOTE =
  "Weighted average of the factors below. For each factor we count how much of that job's requirements your workspace evidence supports — matched counts fully, partially matched counts half, unsupported counts zero. A factor with no matching requirements instead reflects how deep your workspace is in that area. Weights are fixed for every job, factors with nothing to compare are dropped, and the remaining weights are renormalised.";

export const SCORE_DISCLAIMER =
  "This is not a probability of being hired.";

export const ATS_DISCLAIMER =
  "Based on defined checks. Not a guarantee for any employer's ATS.";

export const ATS_CHECK_NOTE =
  "Deterministic checks only — no LLM scored this. The score starts at 100 and each issue subtracts 12 (high), 7 (medium) or 3 (low) points. Every issue lists what was found and how to fix it.";

export const MethodologySchema = z.object({
  note: z.string(),
  scoreDisclaimer: z.string(),
  atsDisclaimer: z.string(),
  atsNote: z.string(),
});
export type Methodology = z.infer<typeof MethodologySchema>;

export const DEFAULT_METHODOLOGY: Methodology = {
  note: SCORE_METHODOLOGY_NOTE,
  scoreDisclaimer: SCORE_DISCLAIMER,
  atsDisclaimer: ATS_DISCLAIMER,
  atsNote: ATS_CHECK_NOTE,
};

export const AtsIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(["low", "med", "high"]),
  message: z.string(),
  fix: z.string(),
  /** Longer explanation of the check that produced this issue. */
  check: z.string().default(""),
});
export type AtsIssue = z.infer<typeof AtsIssueSchema>;

/**
 * Before/after example (PRD §6.7). The `after` text is a *presentational*
 * rewrite of the `before` text only — same facts, no new claims.
 */
export const AtsExampleSchema = z.object({
  id: z.string(),
  issueId: z.string(),
  before: z.string(),
  after: z.string(),
  note: z.string(),
});
export type AtsExample = z.infer<typeof AtsExampleSchema>;

/** One named check with its outcome, so the panel shows what was verified. */
export const AtsCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pass", "issue", "not_checked"]),
  detail: z.string(),
  /** Issues this check produced (empty when it passed). */
  issueIds: z.array(z.string()).default([]),
});
export type AtsCheck = z.infer<typeof AtsCheckSchema>;

export const AtsReportSchema = z.object({
  score: z.number().min(0).max(100),
  keywordCoverage: z.number().min(0).max(100),
  /** Job keywords the checks looked for and whether the resume contains them. */
  keywords: z
    .array(
      z.object({
        keyword: z.string(),
        present: z.boolean(),
        requirementId: z.string().nullish(),
      }),
    )
    .default([]),
  checks: z.array(AtsCheckSchema).default([]),
  issues: z.array(AtsIssueSchema).default([]),
  examples: z.array(AtsExampleSchema).default([]),
});
export type AtsReport = z.infer<typeof AtsReportSchema>;

export const RoadmapStepSchema = z.object({
  priority: z.number().int().positive(),
  action: z.string(),
  reason: z.string(),
});
export type RoadmapStep = z.infer<typeof RoadmapStepSchema>;

export const ContentDecisionSchema = z.object({
  itemId: z.string(),
  reason: z.string(),
});
export type ContentDecision = z.infer<typeof ContentDecisionSchema>;

/** A skill that appears somewhere in the workspace, with its sources. */
export const SkillFindingSchema = z.object({
  name: z.string(),
  /** Workspace items that evidence this skill. */
  itemIds: z.array(z.string()).default([]),
});
export type SkillFinding = z.infer<typeof SkillFindingSchema>;

export const SkillGapSchema = z.object({
  name: z.string(),
  reason: z.string(),
});
export type SkillGap = z.infer<typeof SkillGapSchema>;

/** Skills analysis (PRD §6.6.2). */
export const SkillAnalysisSchema = z.object({
  /** Skills the user listed as workspace skill items. */
  documented: z.array(SkillFindingSchema).default([]),
  /** Skills demonstrated by a project, experience, certificate or course. */
  demonstrated: z.array(SkillFindingSchema).default([]),
  /** Job requirements with no workspace evidence at all. */
  notEvidenced: z.array(SkillGapSchema).default([]),
  /** What to develop next, in prioritised order. */
  toDevelop: z.array(SkillGapSchema).default([]),
});
export type SkillAnalysis = z.infer<typeof SkillAnalysisSchema>;

/** Resume content report extras (PRD §6.6.3). */
export const ContentReportSchema = z.object({
  supportedRequirementIds: z.array(z.string()).default([]),
  needsEvidenceRequirementIds: z.array(z.string()).default([]),
  sectionsToImprove: z
    .array(
      z.object({
        section: WorkspaceSectionSchema,
        reason: z.string(),
      }),
    )
    .default([]),
});
export type ContentReport = z.infer<typeof ContentReportSchema>;

/**
 * Full job-target analysis report (PRD §6.6).
 * Scores are explainable factor breakdowns — never a hiring probability.
 */
export const AnalysisReportSchema = z.object({
  targetId: z.string(),
  /** Workspace version the report was computed from (staleness, PRD §6.8). */
  workspaceVersion: z.number().int().nonnegative(),
  generatedAt: z.string(),
  /** Job-match score 0–100. Displayed with methodology, never as P(hired). */
  score: z.number().min(0).max(100),
  factors: z.array(ScoreFactorSchema),
  methodology: MethodologySchema,
  requirements: z.array(RequirementSchema),
  skills: SkillAnalysisSchema,
  included: z.array(ContentDecisionSchema).default([]),
  excluded: z.array(ContentDecisionSchema).default([]),
  content: ContentReportSchema.default({
    supportedRequirementIds: [],
    needsEvidenceRequirementIds: [],
    sectionsToImprove: [],
  }),
  roadmap: z.array(RoadmapStepSchema).default([]),
  ats: AtsReportSchema,
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

/**
 * The report's requirements split three ways for display (JD-3), and the two
 * unsupported gap buckets (JD-4). Derived from `requirements` so the split can
 * never disagree with the list it is drawn from.
 */
export interface RequirementGroups {
  matched: Requirement[];
  partial: Requirement[];
  unsupported: Requirement[];
  notEvidenced: Requirement[];
  genuinelyMissing: Requirement[];
}

export function groupRequirements(
  requirements: Requirement[],
): RequirementGroups {
  return {
    matched: requirements.filter((r) => r.status === "matched"),
    partial: requirements.filter((r) => r.status === "partial"),
    unsupported: requirements.filter((r) => r.status === "unsupported"),
    notEvidenced: requirements.filter((r) => r.gapType === "not_evidenced"),
    genuinelyMissing: requirements.filter(
      (r) => r.gapType === "genuinely_missing",
    ),
  };
}

/** Accepted templates + length preferences (PRD §6.4 JD-1). */
export const RESUME_TEMPLATES = ["precision", "classic", "compact"] as const;
export const ResumeTemplateSchema = z.enum(RESUME_TEMPLATES);
export type ResumeTemplate = z.infer<typeof ResumeTemplateSchema>;

export const TEMPLATE_OPTIONS: { value: ResumeTemplate; label: string }[] = [
  { value: "precision", label: "Precision" },
  { value: "classic", label: "Classic" },
  { value: "compact", label: "Compact" },
];

export const TARGET_LENGTHS = ["one_page", "two_page"] as const;
export const TargetLengthSchema = z.enum(TARGET_LENGTHS);
export type TargetLength = z.infer<typeof TargetLengthSchema>;

export const LENGTH_OPTIONS: { value: TargetLength; label: string }[] = [
  { value: "one_page", label: "One page" },
  { value: "two_page", label: "Two pages" },
];

export const JobTargetStatusSchema = z.enum([
  "draft",
  "analyzing",
  "ready",
  "failed",
]);
export type JobTargetStatus = z.infer<typeof JobTargetStatusSchema>;

/** Score summary attached to a saved target so the list needs one request. */
export const TargetAnalysisSummarySchema = z.object({
  score: z.number().min(0).max(100),
  analysedAt: z.string(),
  workspaceVersion: z.number().int().nonnegative(),
  /** True when the workspace moved on after this analysis (PRD §6.8). */
  stale: z.boolean().default(false),
});
export type TargetAnalysisSummary = z.infer<
  typeof TargetAnalysisSummarySchema
>;

export const JobTargetSchema = z.object({
  id: z.string(),
  role: z.string().min(1),
  company: z.string().nullish(),
  jobDescription: z.string().min(1),
  requiredSkills: z.array(z.string()).default([]),
  template: ResumeTemplateSchema.nullish(),
  length: TargetLengthSchema.nullish(),
  status: JobTargetStatusSchema.default("draft"),
  /** Present once an analysis has succeeded. */
  analysis: TargetAnalysisSummarySchema.nullish(),
  /** Saved for the three demo fixtures (dev-only, never set for real users). */
  sample: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobTarget = z.infer<typeof JobTargetSchema>;

/**
 * List-row summary produced after a successful analysis, so `/targets` needs
 * one request instead of one report fetch per row.
 */
export function jobTargetSummary(
  report: AnalysisReport,
  analysedAt: string,
): TargetAnalysisSummary {
  return {
    score: report.score,
    analysedAt,
    workspaceVersion: report.workspaceVersion,
    stale: false,
  };
}

/** Intake form (PRD §6.4 JD-1) — validated before anything is sent. */
export const TargetCreateSchema = z.object({
  role: z
    .string()
    .trim()
    .min(2, "Add the role you're applying for")
    .max(120, "Keep the role under 120 characters"),
  company: z.string().trim().max(120, "Keep the company under 120 characters"),
  jobDescription: z
    .string()
    .trim()
    .min(40, "Paste the job description — at least a couple of sentences.")
    .max(20_000, "That's longer than this tool accepts (20,000 characters)."),
  requiredSkills: z
    .array(z.string().trim().min(1).max(40, "Skills are 40 characters max"))
    .max(25, "Up to 25 skills")
    .default([]),
  template: ResumeTemplateSchema.default("precision"),
  length: TargetLengthSchema.default("one_page"),
});
export type TargetCreateValues = z.infer<typeof TargetCreateSchema>;

export const TargetCreateResponseSchema = JobTargetSchema;
export type TargetCreateResponse = z.infer<typeof TargetCreateResponseSchema>;

/**
 * Analysis theatre stages (PRD §7.4.4). The label is what the theatre prints;
 * `detail` explains what is happening so the wait is informative, never a
 * decorative spinner.
 */
export const ANALYSIS_STAGES = [
  {
    key: "reading",
    label: "Reading the job",
    detail: "Parsing the posting you pasted.",
  },
  {
    key: "extracting",
    label: "Extracting requirements",
    detail: "Pulling out must-haves, nice-to-haves and responsibilities.",
  },
  {
    key: "searching",
    label: "Searching your workspace",
    detail: "Collecting items that could answer those requirements.",
  },
  {
    key: "matching",
    label: "Matching evidence",
    detail: "Comparing each requirement with your evidence.",
  },
  {
    key: "scoring",
    label: "Scoring",
    detail: "Applying the published weights to the matches.",
  },
  {
    key: "writing",
    label: "Writing report",
    detail: "Assembling the report, gaps and roadmap.",
  },
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];
export type AnalysisStageKey = AnalysisStage["key"];

export const AnalysisStageKeySchema = z.enum(
  ANALYSIS_STAGES.map((stage) => stage.key) as [
    AnalysisStageKey,
    ...AnalysisStageKey[],
  ],
);

/** Per-stage timings for the mock analysis (PRD §8.4: 3–8s staged analysis). */
export const ANALYSIS_STAGE_DURATIONS_MS: Record<AnalysisStageKey, number> = {
  reading: 900,
  extracting: 900,
  searching: 800,
  matching: 1000,
  scoring: 600,
  writing: 900,
};

export const ANALYSIS_TOTAL_MS = ANALYSIS_STAGES.reduce(
  (total, stage) => total + ANALYSIS_STAGE_DURATIONS_MS[stage.key],
  0,
);

/** Cumulative elapsed time at which each stage *finishes*. */
export const ANALYSIS_STAGE_ENDS_MS: number[] = (() => {
  const ends: number[] = [];
  let elapsed = 0;
  for (const stage of ANALYSIS_STAGES) {
    elapsed += ANALYSIS_STAGE_DURATIONS_MS[stage.key];
    ends.push(elapsed);
  }
  return ends;
})();

/**
 * Stage currently running after `elapsedMs` (pure + deterministic, so the
 * theatre and its tests agree). Clamps to the last stage.
 */
export function stageIndexAt(elapsedMs: number): number {
  const clamped = Math.max(0, elapsedMs);
  for (let index = 0; index < ANALYSIS_STAGE_ENDS_MS.length; index += 1) {
    if (clamped < ANALYSIS_STAGE_ENDS_MS[index]) return index;
  }
  return ANALYSIS_STAGES.length - 1;
}

/** Progress 0–100 for the theatre bar at `elapsedMs`. */
export function progressAt(elapsedMs: number): number {
  return Math.max(0, Math.min(100, Math.round((elapsedMs / ANALYSIS_TOTAL_MS) * 100)));
}

export const AnalysisRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
]);
export type AnalysisRunStatus = z.infer<typeof AnalysisRunStatusSchema>;

export const AnalysisFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  stage: AnalysisStageKeySchema,
});
export type AnalysisFailure = z.infer<typeof AnalysisFailureSchema>;

export const AnalysisRunSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  status: AnalysisRunStatusSchema,
  stage: AnalysisStageKeySchema,
  stageIndex: z.number().int().nonnegative(),
  stageCount: z.number().int().positive(),
  progress: z.number().min(0).max(100),
  workspaceVersion: z.number().int().nonnegative(),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullish(),
  failure: AnalysisFailureSchema.nullish(),
});
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;

export const AnalysisRunResponseSchema = z.object({
  run: AnalysisRunSchema,
  /** Present once the run succeeded. */
  report: AnalysisReportSchema.nullish(),
});
export type AnalysisRunResponse = z.infer<typeof AnalysisRunResponseSchema>;
