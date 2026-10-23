import { z } from "zod";

/**
 * Feature switches from `GET /capabilities` (B6, contract §9.1).
 *
 * Mirrors `docs/api/openapi.json` (`Capabilities`, `AiCapabilities`,
 * `AccountDeletionCapability`). The response contains booleans only: no
 * provider name, model id, URL or key ever reaches the browser, and `true`
 * means "this server can offer it", never "the provider is healthy".
 */

export const AiCapabilitiesSchema = z.object({
  configured: z.boolean(),
  analysisEnrichment: z.boolean(),
  resumeRewording: z.boolean(),
});
export type AiCapabilities = z.infer<typeof AiCapabilitiesSchema>;

export const AccountDeletionCapabilitySchema = z.object({
  dataDeletion: z.boolean().default(true),
  /** False while the auth identity still needs an operator (ADR-043). */
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
