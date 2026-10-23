import { z } from "zod";
import { AtsReportSchema } from "./analysis";
import { EvidenceStateSchema, WorkspaceSectionSchema } from "./workspace";

/**
 * Resume wire schemas (B1 standard resume + B5 tailored resumes).
 *
 * Mirrors `docs/api/contract-proposals.md` §6 and `docs/api/openapi.json` on
 * `master` (B5 plus the B6 additions: `removedEvidenceIds` on summaries and
 * versions, `stale` on versions, and the `purged` version reason). A claim is a
 * single line in the resume that points back at the workspace item(s) that
 * evidence it. The generator only copies the user's own fields; a hand edit or
 * an AI rewrite is rejected unless it is grounded in the cited evidence.
 * See docs/DECISIONS.md ADR-044/ADR-045.
 */

export const ResumeKindSchema = z.enum(["standard", "tailored"]);
export type ResumeKind = z.infer<typeof ResumeKindSchema>;

export const ResumeVersionReasonSchema = z.enum([
  "generated",
  "edited",
  "restored",
  "refreshed",
  /** B6: the version was rewritten to drop claims whose source was deleted. */
  "purged",
]);
export type ResumeVersionReason = z.infer<typeof ResumeVersionReasonSchema>;

export const ClaimSchema = z.object({
  text: z.string(),
  /** Workspace item IDs backing this claim. Empty = needs confirmation. */
  evidenceIds: z.array(z.string()).default([]),
  /** True once a human confirmed an unsupported statement. */
  confirmed: z.boolean().default(false),
  /** True when the optional AI reworder produced this text (B5). */
  aiRewritten: z.boolean().default(false),
  /** Computed on read: a cited workspace item no longer exists (B5). */
  removed: z.boolean().default(false),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ResumeSectionSchema = z.object({
  key: z.string(),
  claims: z.array(ClaimSchema).default([]),
});
export type ResumeSection = z.infer<typeof ResumeSectionSchema>;

export const ResumeSchema = z.object({
  id: z.string(),
  kind: ResumeKindSchema,
  /**
   * Present for tailored resumes only. The backend serialises "no target" as
   * `null` on the standard resume (live wire, I1), so both are accepted.
   */
  targetId: z.string().nullish(),
  /** Human label ("Senior Frontend Engineer at Halcyon Systems"). */
  title: z.string().nullish(),
  /** Workspace version this resume was generated from (staleness, PRD §6.8). */
  workspaceVersion: z.number().int().nonnegative(),
  stale: z.boolean().default(false),
  sections: z.array(ResumeSectionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** True when at least one visible claim was produced by the AI reworder. */
  aiUsed: z.boolean().default(false),
  /** Deterministic ATS checks run on the generated resume (PRD §6.7). */
  ats: AtsReportSchema.nullish(),
  /** Section keys edited by hand; refresh leaves them alone by default. */
  editedSections: z.array(z.string()).default([]),
  /** Cited item ids that no longer exist in the current workspace. */
  removedEvidenceIds: z.array(z.string()).default([]),
});
export type Resume = z.infer<typeof ResumeSchema>;

/**
 * `GET /resumes` list row: a Resume without sections/ATS. B6 added
 * `removedEvidenceIds` here so `/history` can warn from the list response
 * instead of fetching every snapshot (ADR-041).
 */
export const ResumeSummarySchema = z.object({
  id: z.string(),
  kind: ResumeKindSchema,
  targetId: z.string().nullish(),
  title: z.string().nullish(),
  workspaceVersion: z.number().int().nonnegative(),
  stale: z.boolean().default(false),
  aiUsed: z.boolean().default(false),
  editedSections: z.array(z.string()).default([]),
  /** Cited item ids that no longer exist in the current workspace. */
  removedEvidenceIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ResumeSummary = z.infer<typeof ResumeSummarySchema>;

/**
 * Immutable snapshot returned by `GET /resumes/{id}/versions`, newest first.
 * `stale` and `removedEvidenceIds` are computed on read against the current
 * workspace (B6), not stored, so an old snapshot can be flagged before it is
 * restored or purged.
 */
export const ResumeVersionSchema = z.object({
  id: z.string(),
  resumeId: z.string(),
  workspaceVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  reason: ResumeVersionReasonSchema,
  title: z.string().nullish(),
  aiUsed: z.boolean().default(false),
  sections: z.array(ResumeSectionSchema).default([]),
  ats: AtsReportSchema.nullish(),
  editedSections: z.array(z.string()).default([]),
  stale: z.boolean().default(false),
  removedEvidenceIds: z.array(z.string()).default([]),
});
export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;

/**
 * Persisted snapshot of an item a resume cited (B5 source evidence). It never
 * goes over the wire as its own endpoint; the mock store keeps it so diff and
 * refresh can tell removed items from edited ones.
 */
export const ResumeEvidenceSchema = z.object({
  itemId: z.string(),
  section: WorkspaceSectionSchema,
  title: z.string(),
  organization: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  location: z.string().nullish(),
  bullets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  evidence: EvidenceStateSchema,
  order: z.number().int().nonnegative(),
  fingerprint: z.string(),
});
export type ResumeEvidence = z.infer<typeof ResumeEvidenceSchema>;

/* ------------------------------------------------------------------ requests */

export const ResumeGenerateRequestSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Requires recorded AI consent and a configured provider. */
  rewordWithAi: z.boolean().default(false),
});
export type ResumeGenerateRequest = z.infer<typeof ResumeGenerateRequestSchema>;

export const ResumeClaimEditSchema = z.object({
  text: z.string().trim().min(1).max(600),
  /**
   * Matches B5 `ResumeClaimEdit`: at least one cited item and at most ten.
   * An ungrounded rewording of a cited line still reaches the service and
   * gets the specific `resume_claim_ungrounded` error; an empty citation list
   * is a request-shape error before that point, exactly like the live API.
   */
  evidenceIds: z.array(z.string().min(1).max(64)).min(1).max(10),
}).strict();
export type ResumeClaimEdit = z.infer<typeof ResumeClaimEditSchema>;

/** Replaces a section's claims; the server validates every citation. */
export const ResumeSectionEditSchema = z
  .object({
    claims: z.array(ResumeClaimEditSchema).min(1).max(50),
  })
  .strict();
export type ResumeSectionEdit = z.infer<typeof ResumeSectionEditSchema>;

export const ResumeRefreshRequestSchema = z.object({
  /** Empty = every section. Only unedited sections are refreshed. */
  sections: z.array(z.string()).max(20).default([]),
  /** Explicit per-section choice to replace hand-edited content too. */
  overwriteEditedSections: z.array(z.string()).max(20).default([]),
  rewordWithAi: z.boolean().default(false),
});
export type ResumeRefreshRequest = z.infer<typeof ResumeRefreshRequestSchema>;

/* ------------------------------------------------------- diff / refresh result */

export const ResumeDiffEntrySchema = z.object({
  itemId: z.string(),
  section: WorkspaceSectionSchema,
  title: z.string(),
});
export type ResumeDiffEntry = z.infer<typeof ResumeDiffEntrySchema>;

export const ResumeDiffSchema = z.object({
  resumeId: z.string(),
  targetId: z.string().nullish(),
  workspaceVersion: z.number().int().nonnegative(),
  currentWorkspaceVersion: z.number().int().nonnegative(),
  stale: z.boolean().default(false),
  added: z.array(ResumeDiffEntrySchema).default([]),
  removed: z.array(ResumeDiffEntrySchema).default([]),
  edited: z.array(ResumeDiffEntrySchema).default([]),
  changedSections: z.array(z.string()).default([]),
  removedEvidenceIds: z.array(z.string()).default([]),
});
export type ResumeDiff = z.infer<typeof ResumeDiffSchema>;

export const ResumeRefreshSkipSchema = z.object({
  section: z.string(),
  reason: z.literal("edited").default("edited"),
});
export type ResumeRefreshSkip = z.infer<typeof ResumeRefreshSkipSchema>;

export const ResumeRefreshResultSchema = z.object({
  resume: ResumeSchema,
  refreshedSections: z.array(z.string()).default([]),
  skippedSections: z.array(ResumeRefreshSkipSchema).default([]),
});
export type ResumeRefreshResult = z.infer<typeof ResumeRefreshResultSchema>;
