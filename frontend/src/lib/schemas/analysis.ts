import { z } from "zod";

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
  text: z.string(),
  kind: RequirementKindSchema,
  status: RequirementStatusSchema,
  gapType: GapTypeSchema.optional(),
  evidenceIds: z.array(z.string()).default([]),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const ScoreFactorSchema = z.object({
  name: z.string(),
  /** Weight as a fraction of 1 (e.g. 0.40). Weights sum to 1. */
  weight: z.number().min(0).max(1),
  /** Factor value 0–100. */
  value: z.number().min(0).max(100),
});
export type ScoreFactor = z.infer<typeof ScoreFactorSchema>;

export const AtsIssueSchema = z.object({
  id: z.string(),
  severity: z.enum(["low", "med", "high"]),
  message: z.string(),
  fix: z.string(),
});
export type AtsIssue = z.infer<typeof AtsIssueSchema>;

export const AtsReportSchema = z.object({
  score: z.number().min(0).max(100),
  keywordCoverage: z.number().min(0).max(100),
  issues: z.array(AtsIssueSchema).default([]),
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

/**
 * Full job-target analysis report (PRD §6.6).
 * Scores are explainable factor breakdowns — never a hiring probability.
 */
export const AnalysisReportSchema = z.object({
  /** Job-match score 0–100. Displayed with methodology, never as P(hired). */
  score: z.number().min(0).max(100),
  factors: z.array(ScoreFactorSchema),
  requirements: z.array(RequirementSchema),
  included: z.array(ContentDecisionSchema).default([]),
  excluded: z.array(ContentDecisionSchema).default([]),
  roadmap: z.array(RoadmapStepSchema).default([]),
  ats: AtsReportSchema,
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

export const JobTargetSchema = z.object({
  id: z.string(),
  role: z.string().min(1, "Target role is required"),
  company: z.string().optional(),
  jobDescription: z.string().min(1, "Job description is required"),
  requiredSkills: z.array(z.string()).default([]),
  template: z.string().optional(),
  length: z.enum(["one_page", "two_page"]).optional(),
  status: z.enum(["draft", "analyzing", "ready", "failed"]).default("draft"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobTarget = z.infer<typeof JobTargetSchema>;
