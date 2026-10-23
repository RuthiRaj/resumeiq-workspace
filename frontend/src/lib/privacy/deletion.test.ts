import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_PHRASE,
  deletionCountsSummary,
  describeDeletionResult,
  isDeletionPhraseConfirmed,
} from "./deletion";
import type { AccountDeletionResult } from "@/lib/schemas";

function result(
  overrides: Partial<AccountDeletionResult> = {},
): AccountDeletionResult {
  return {
    dataDeleted: true,
    authUserDeleted: false,
    remainingStep: "auth_user",
    deletedAt: "2026-10-22T09:00:00.000Z",
    deletedCounts: {},
    message: "Your ResumeIQ data was deleted.",
    ...overrides,
  };
}

describe("isDeletionPhraseConfirmed", () => {
  it("requires the exact phrase", () => {
    expect(isDeletionPhraseConfirmed(ACCOUNT_DELETION_PHRASE)).toBe(true);
    expect(isDeletionPhraseConfirmed(" delete my account ")).toBe(true);
    expect(isDeletionPhraseConfirmed("Delete my account")).toBe(false);
    expect(isDeletionPhraseConfirmed("delete my account please")).toBe(false);
    expect(isDeletionPhraseConfirmed("")).toBe(false);
  });
});

describe("describeDeletionResult", () => {
  it("says the auth identity is still the operator's step", () => {
    const described = describeDeletionResult(result());

    expect(described.authPending).toBe(true);
    expect(described.description).toContain("sign-in email");
    expect(described.description).toContain("operator");
  });

  it("uses the server message only when the auth user was deleted", () => {
    const described = describeDeletionResult(
      result({ authUserDeleted: true, message: "Account removed." }),
    );

    expect(described.authPending).toBe(false);
    expect(described.description).toBe("Account removed.");
  });

  it("does not claim data was deleted when the server says it was not", () => {
    expect(describeDeletionResult(result({ dataDeleted: false })).title).toBe(
      "Nothing left to delete",
    );
  });
});

describe("deletionCountsSummary", () => {
  it("lists nonzero counts in a stable order", () => {
    expect(
      deletionCountsSummary({
        resume_versions: 4,
        workspace_items: 12,
        targets: 2,
        consent_records: 0,
      }),
    ).toBe("12 workspace items · 2 targets · 4 resume versions");
  });

  it("says nothing remained instead of printing zeros", () => {
    expect(deletionCountsSummary({})).toBe("No stored rows remained.");
  });
});
