import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetForm } from "./target-form";

/**
 * S-13: the development fixture picker was shown in a live `next dev` session
 * too, where it inserts fictional postings into a real target. It is a
 * mock-mode tool and must stay out of live builds.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./use-targets", () => ({
  useCreateTarget: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/privacy/use-consent", () => ({
  hasAiConsent: () => false,
  useConsent: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRecordConsent: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("development fixtures", () => {
  it("hides the sample posting picker in live mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    render(<TargetForm />);

    expect(screen.queryByText(/load a sample posting/i)).not.toBeInTheDocument();
  });

  it("keeps the sample posting picker for mock development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    render(<TargetForm />);

    expect(screen.getByText(/load a sample posting/i)).toBeInTheDocument();
  });
});
