import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContent } from "./privacy-content";

/**
 * S-10: the consent card said "visit onboarding to record one" while the same
 * card already had the buttons to record it.
 */
vi.mock("@/lib/api", () => ({
  api: {
    getConsent: vi.fn().mockResolvedValue({ consent: null }),
    recordConsent: vi.fn().mockResolvedValue({ consent: null }),
  },
}));

afterEach(() => {
  cleanup();
});

describe("privacy consent card", () => {
  it("points at its own buttons instead of onboarding", async () => {
    render(<PrivacyContent />);

    expect(
      await screen.findByText("No consent recorded yet — use the buttons below."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/visit onboarding to record one/i)).not.toBeInTheDocument();
  });

  it("renders the onboarding action as a link, not a button inside a link", async () => {
    render(<PrivacyContent />);

    const action = await screen.findByRole("link", { name: "Revisit onboarding" });
    expect(action.querySelector("button")).toBeNull();
  });
});
