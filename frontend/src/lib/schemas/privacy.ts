import { z } from "zod";

/**
 * B6 privacy wire schemas.
 *
 * Mirrors `docs/api/openapi.json` (`Capabilities`, `UserDataExport`,
 * `AccountDeletionResult`) and `docs/api/contract-proposals.md` section 9. The
 * capabilities response deliberately contains feature switches only: no
 * provider name, model id, URL or key ever reaches the browser.
 */

export const AiCapabilitiesSchema = z.object({
  configured: z.boolean(),
  analysisEnrichment: z.boolean(),
  resumeRewording: z.boolean(),
});
export type AiCapabilities = z.infer<typeof AiCapabilitiesSchema>;

export const AccountDeletionCapabilitySchema = z.object({
  dataDeletion: z.boolean().default(true),
  /** False in B6: the auth identity needs an operator (ADR-043). */
  authUserDeletion: z.boolean().default(false),
});
export type AccountDeletionCapability = z.infer<
  typeof AccountDeletionCapabilitySchema
>;

export const CapabilitiesSchema = z.object({
  ai: AiCapabilitiesSchema,
  pdfExport: z.boolean().default(true),
  dataExport: z.boolean().default(true),
  accountDeletion: AccountDeletionCapabilitySchema,
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

/** Stored rows are opaque to the UI; only the envelope is validated. */
const ExportRowsSchema = z.array(z.record(z.string(), z.unknown())).default([]);

export const UserDataExportSchema = z.object({
  format: z.literal("resumeiq.data-export.v1"),
  exportedAt: z.string().min(1),
  userId: z.string().min(1),
  email: z.string().nullable().default(null),
  workspace: ExportRowsSchema,
  workspaceVersions: ExportRowsSchema,
  evidenceLinks: ExportRowsSchema,
  changeLog: ExportRowsSchema,
  targets: ExportRowsSchema,
  jdRequirements: ExportRowsSchema,
  reports: ExportRowsSchema,
  analysisRuns: ExportRowsSchema,
  resumes: ExportRowsSchema,
  resumeVersions: ExportRowsSchema,
  resumeClaims: ExportRowsSchema,
  consentRecords: ExportRowsSchema,
  imports: ExportRowsSchema,
  importReviewItems: ExportRowsSchema,
  profile: z.record(z.string(), z.unknown()).nullable().default(null),
  skills: ExportRowsSchema,
  skillRelations: ExportRowsSchema,
  auditEvents: ExportRowsSchema,
});
export type UserDataExport = z.infer<typeof UserDataExportSchema>;

export const AccountDeletionResultSchema = z.object({
  dataDeleted: z.boolean(),
  /** False until an operator removes the Supabase auth identity (B6). */
  authUserDeleted: z.boolean(),
  /** `"auth_user"` while the sign-in identity still exists. */
  remainingStep: z.literal("auth_user").nullable().default(null),
  deletedAt: z.string().min(1),
  deletedCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  message: z.string().min(1),
});
export type AccountDeletionResult = z.infer<typeof AccountDeletionResultSchema>;
