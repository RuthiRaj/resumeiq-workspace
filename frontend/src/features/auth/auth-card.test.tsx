import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthCard } from "./auth-card";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderCard() {
  return render(
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in"
      description="Your workspace is waiting."
      footer={<a href="/signup">Create an account</a>}
    >
      <p>form</p>
    </AuthCard>,
  );
}

describe("AuthCard mock-auth footer", () => {
  it("keeps the mock note in mock mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    renderCard();

    expect(screen.getByText(/Mock authentication/i)).toBeInTheDocument();
  });

  it("does not claim mock auth in live mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    renderCard();

    expect(screen.queryByText(/Mock authentication/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no real credentials leave your browser/i),
    ).not.toBeInTheDocument();
  });
});
