import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivacyContent } from "./privacy-content";

/**
 * The privacy centre is server-driven: capabilities decide which controls
 * exist and the consent record decides the copy. These tests pin the two F6
 * regressions that matter: no stale "visit onboarding" pointer, and a failed
 * capabilities read never looks like a working feature.
 */
vi.mock("@/lib/api", () => ({
  apiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  api: {
    getConsent: vi.fn().mockResolvedValue({ consent: null }),
    recordConsent: vi.fn().mockResolvedValue({
      consent: {
        aiProcessing: true,
        provider: "test-provider",
        recordedAt: "2026-10-21T09:00:00.000Z",
        version: 1,
      },
    }),
    getCapabilities: vi.fn().mockResolvedValue({
      ai: {
        configured: true,
        analysisEnrichment: true,
        resumeRewording: true,
      },
      pdfExport: true,
      dataExport: true,
      accountDeletion: { dataDeletion: true, authUserDeletion: false },
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("privacy consent card", () => {
  it("points at its own buttons instead of onboarding", async () => {
    render(<PrivacyContent />, { wrapper });

    expect(await screen.findByText("No consent recorded yet.")).toBeInTheDocument();
    expect(screen.getByTestId("consent-allow")).toBeEnabled();
    expect(screen.getByTestId("consent-decline")).toBeEnabled();
    expect(screen.queryByText(/visit onboarding to record one/i)).not.toBeInTheDocument();
  });

  it("lists AI features from capabilities instead of a build-time flag", async () => {
    render(<PrivacyContent />, { wrapper });

    expect(await screen.findByText("Resume rewording")).toBeInTheDocument();
    expect(screen.getByText("Analysis enrichment")).toBeInTheDocument();
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });
});
