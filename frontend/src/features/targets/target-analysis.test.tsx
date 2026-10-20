import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetAnalysis } from "./target-analysis";

/**
 * S-08: a failed analysis poll used to be silent. The theatre kept the last
 * run and retried forever with no "connection lost" state. After two
 * consecutive failures the page must say so inline and offer a manual retry,
 * without hiding the theatre or the last known progress.
 */
const poll = vi.hoisted(() => ({
  isError: true,
  failureCount: 2,
  refetch: vi.fn(),
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
  hasAiConsent: () => true,
  useConsent: () => ({
    data: { consent: { aiProcessing: true } },
    isLoading: false,
    isSuccess: true,
    isError: false,
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
