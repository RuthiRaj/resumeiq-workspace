import type { AccountDeletionResult } from "@/lib/schemas";

/**
 * Account-deletion copy + confirmation rules (B6 §9.4).
 *
 * The server compares the phrase case-insensitively after trimming. The UI
 * additionally requires the exact lowercase phrase so a stray autocapitalised
 * paste cannot arm a destructive button.
 */
export const ACCOUNT_DELETION_PHRASE = "delete my account";

/** What the confirmation dialog promises is removed (data only). */
export const ACCOUNT_DELETION_SCOPE = [
  "Every workspace item, including soft-deleted ones and their change log",
  "Job targets, job-description requirements, analyses and reports",
  "Tailored resumes, every saved version and every cited claim",
  "Imports, review cards and their uploaded files",
  "Your AI-processing consent records",
] as const;

/** What is explicitly *not* removed by the API in B6. */
export const ACCOUNT_DELETION_REMAINING = [
  "Your Supabase sign-in identity (email and password). The service operator removes it as a separate step.",
  "Resume presentation preferences stored only in this browser.",
] as const;

export function isDeletionPhraseConfirmed(value: string): boolean {
  return value.trim() === ACCOUNT_DELETION_PHRASE;
}

export interface DeletionOutcome {
  title: string;
  description: string;
  /** True while the sign-in identity still needs the operator. */
  authPending: boolean;
}

export function describeDeletionResult(
  result: AccountDeletionResult,
): DeletionOutcome {
  const authPending = !result.authUserDeleted;
  return {
    title: result.dataDeleted ? "Your data was deleted" : "Nothing left to delete",
    description: authPending
      ? "Your data is deleted. Your sign-in email will be removed by the operator — until then you can still sign in, but the workspace is empty."
      : result.message,
    authPending,
  };
}

/** Stable list for the result panel; counts are optional in the contract. */
export function deletionCountsSummary(
  counts: AccountDeletionResult["deletedCounts"],
): string {
  const order = [
    "workspace_items",
    "targets",
    "resumes",
    "resume_versions",
    "imports",
    "consent_records",
  ];
  const parts = order
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => `${counts[key]} ${key.replaceAll("_", " ")}`);
  return parts.length ? parts.join(" · ") : "No stored rows remained.";
}
