import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TargetForm } from "./target-form";

/**
 * S-09: submitting while the consent lookup is still in flight opened the
 * consent gate as if the user had declined. The form must wait for the lookup
 * and say so instead of asking for consent that may already be recorded.
 *
 * S-13: the development fixture picker was shown in a live `next dev` session
 * too. It is a mock-mode tool and must stay out of live builds.
 */
const consent = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  granted: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./use-targets", () => ({
  useCreateTarget: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/privacy/use-consent", () => ({
  hasAiConsent: (value: { aiProcessing: boolean } | null | undefined) =>
    Boolean(value?.aiProcessing),
  useConsent: () => ({
    data: consent.granted ? { consent: { aiProcessing: true } } : undefined,
    isLoading: consent.isLoading,
    isError: consent.isError,
    isSuccess: !consent.isLoading && !consent.isError,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useRecordConsent: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

function fillRequiredFields() {
  fireEvent.change(screen.getByTestId("target-role"), {
    target: { value: "Backend engineer" },
  });
  fireEvent.change(screen.getByTestId("target-jd"), {
    target: {
      value:
        "We are looking for a backend engineer to build reporting APIs with Python " +
        "and PostgreSQL, and to work with TypeScript on the dashboard.",
    },
  });
}

beforeEach(() => {
  consent.isLoading = false;
  consent.isError = false;
  consent.granted = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("consent lookup while submitting", () => {
  it("waits for the lookup instead of opening the gate", async () => {
    consent.isLoading = true;
    render(<TargetForm />);
    fillRequiredFields();

    fireEvent.click(screen.getByTestId("target-submit"));

    expect(screen.queryByTestId("consent-gate")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /still checking your ai-processing consent/i,
    );
  });
});
