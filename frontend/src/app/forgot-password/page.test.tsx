import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth/context";
import type { AuthClient, Session } from "@/lib/auth/types";
import { ForgotPasswordForm } from "./page";

const SESSION: Session = {
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    provider: "password",
    createdAt: "2026-10-01T09:00:00.000Z",
  },
  token: "token",
  createdAt: "2026-10-01T09:00:00.000Z",
};

function client(): AuthClient {
  return {
    getSession: async () => null,
    signUp: async () => SESSION,
    signIn: async () => SESSION,
    signInWithOAuth: async () => SESSION,
    requestPasswordReset: async () => ({ message: "If that email has an account, a reset link is on its way." }),
    signOut: async () => {},
    signOutEverywhere: async () => {},
    changePassword: async () => {},
    updateDisplayName: async () => SESSION,
  };
}

function renderForm() {
  return render(
    <AuthProvider client={client()}>
      <ForgotPasswordForm />
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("forgot-password copy", () => {
  it("keeps the mock note in mock mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    renderForm();

    expect(screen.getByText(/no email is actually sent/i)).toBeInTheDocument();
  });

  it("says Supabase Auth sends the link in live mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    renderForm();

    expect(screen.queryByText(/no email is actually sent/i)).not.toBeInTheDocument();
    expect(screen.getByText(/through Supabase Auth/i)).toBeInTheDocument();
  });
});
