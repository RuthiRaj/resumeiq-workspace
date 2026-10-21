import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialForm, CredentialSubmitButton } from "./credential-form";

const hydration = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/use-hydrated", () => ({
  useHydrated: () => hydration.value,
}));

beforeEach(() => {
  hydration.value = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderForm(onSubmit: () => void) {
  return render(
    <CredentialForm onSubmit={onSubmit}>
      <input aria-label="Email" type="email" />
      <CredentialSubmitButton idleLabel="Sign in" pendingLabel="Signing in…" />
    </CredentialForm>,
  );
}

describe("CredentialForm", () => {
  it("posts, points at an inert action and disables native validation", () => {
    renderForm(vi.fn());
    const form = document.querySelector("form");

    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "#");
    expect(form).toHaveAttribute("novalidate");
  });

  it("always prevents the native submission", () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    const result = fireEvent.submit(document.querySelector("form")!);

    expect(result).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores an early submit before hydration", () => {
    hydration.value = false;
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    const result = fireEvent.submit(document.querySelector("form")!);

    expect(result).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the submit button disabled until hydration, then explains a slow start", () => {
    vi.useFakeTimers();
    hydration.value = false;
    renderForm(vi.fn());

    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByRole("button", { name: "Preparing a secure form…" })).toBeDisabled();
  });

  it("enables the button once hydrated", async () => {
    renderForm(vi.fn());
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});
