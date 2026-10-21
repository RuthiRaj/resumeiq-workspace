import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetAnalysis } from "./target-analysis";

/**
 * S-08: a failed analysis poll used to be silent. The theatre kept the last
 * run and retried forever with no "connection lost" state. After two
 * consecutive failures the page must say so inline and offer a manual retry,
 * without hiding the theatre or the last known progress.
 *
 * S-09: the consent gate used to render before the consent lookup resolved,
 * which looked like "no consent" on a slow Data API. The page must show a
 * checking state, and a retryable error if the lookup fails.
 */
const poll = vi.hoisted(() => ({
  isError: true,
  failureCount: 2,
  refetch: vi.fn(),
}));

const consent = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  consent: { aiProcessing: true } as { aiProcessing: boolean } | null,
}));

vi.mock("./use-targets", () => ({
  POLL_FAILURES_BEFORE_NOTICE: 2,
  useTarget: () => ({
    data: {
      id: "target-1",
      role: "Backend engineer",
      company: "Example Ltd",
      analysis: null,
    },
    isError: false,
  }),
  useAnalysisRun: () => ({
    data: {
      run: {
        status: "running",
        stageIndex: 1,
        progress: 20,
        startedAt: "2026-10-20T00:00:00Z",
      },
    },
    isError: poll.isError,
    failureCount: poll.failureCount,
    isFetching: false,
    refetch: poll.refetch,
  }),
  useAnalysisReport: () => ({ data: undefined, isError: false }),
  useStartAnalysis: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock("@/lib/privacy/use-consent", () => ({
  hasAiConsent: (value: { aiProcessing: boolean } | null | undefined) =>
    Boolean(value?.aiProcessing),
  useConsent: () => ({
    data: consent.consent ? { consent: consent.consent } : undefined,
    isLoading: consent.isLoading,
    isSuccess: !consent.isLoading && !consent.isError,
    isError: consent.isError,
    isFetching: false,
    refetch: consent.refetch,
  }),
  useRecordConsent: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

vi.mock("@/features/workspace/use-workspace", () => ({
  useWorkspace: () => ({ data: { items: [] } }),
}));

afterEach(() => {
  cleanup();
  poll.isError = true;
  poll.failureCount = 2;
  poll.refetch.mockReset();
  consent.isLoading = false;
  consent.isError = false;
  consent.refetch.mockReset();
  consent.consent = { aiProcessing: true };
});

describe("analysis poll errors", () => {
  it("shows a non-blocking notice after consecutive failures and can retry", () => {
    render(<TargetAnalysis targetId="target-1" />);

    const notice = screen.getByTestId("analysis-poll-error");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(/lost the connection/i);
    // The theatre and its last known progress stay usable.
    expect(screen.getByTestId("analysis-theatre")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(poll.refetch).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a single transient failure", () => {
    poll.failureCount = 1;
    render(<TargetAnalysis targetId="target-1" />);

    expect(screen.queryByTestId("analysis-poll-error")).not.toBeInTheDocument();
  });
});

describe("consent lookup", () => {
  it("does not show the consent gate while the lookup is loading", () => {
    consent.isLoading = true;
    consent.consent = null;
    render(<TargetAnalysis targetId="target-1" />);

    expect(screen.queryByTestId("consent-gate")).not.toBeInTheDocument();
    expect(screen.getByTestId("consent-loading")).toHaveTextContent(
      /checking your ai-processing consent/i,
    );
  });

  it("offers a retry when the consent lookup fails instead of asking again", () => {
    consent.isError = true;
    consent.consent = null;
    render(<TargetAnalysis targetId="target-1" />);

    expect(screen.queryByTestId("consent-gate")).not.toBeInTheDocument();
    expect(
      screen.getByText("We couldn’t check your AI-processing consent"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(consent.refetch).toHaveBeenCalledTimes(1);
  });
});
