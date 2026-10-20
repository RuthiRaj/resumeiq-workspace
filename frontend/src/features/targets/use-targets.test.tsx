import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useAnalysisRun } from "./use-targets";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: mocks.useQuery,
    useQueryClient: mocks.useQueryClient,
  };
});

type PollQuery = {
  state: {
    data?: { run: { status: string } };
    error: unknown;
  };
};

type PollOptions = {
  refetchInterval: (query: PollQuery) => number | false;
};

function pollOptions(): PollOptions {
  const calls = mocks.useQuery.mock.calls;
  return calls[calls.length - 1]?.[0] as PollOptions;
}

function intervalFor(error: unknown): number | false {
  return pollOptions().refetchInterval({
    state: { data: { run: { status: "running" } }, error },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
  mocks.useQuery.mockReset();
  mocks.useQuery.mockReturnValue({ data: undefined });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("analysis polling", () => {
  it("polls every 2s in live mode, not every 300ms", () => {
    renderHook(() => useAnalysisRun("target-1", true));

    expect(intervalFor(null)).toBe(2_000);
  });

  it("honours Retry-After on a 429", () => {
    renderHook(() => useAnalysisRun("target-1", true));
    const error = Object.assign(
      new ApiError(
        "Too many requests. Wait a moment and try again.",
        429,
        "/targets/target-1/analysis/run",
        "rate_limited",
      ),
      { retryAfterMs: 60_000 },
    );

    expect(intervalFor(error)).toBe(60_000);
  });

  it("stops polling when the run is no longer running", () => {
    renderHook(() => useAnalysisRun("target-1", true));

    expect(
      pollOptions().refetchInterval({
        state: { data: { run: { status: "succeeded" } }, error: null },
      }),
    ).toBe(false);
  });
});
