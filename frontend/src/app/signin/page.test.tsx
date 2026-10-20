import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SigninForm } from "./page";
import { AuthProvider } from "@/lib/auth/context";
import type { AuthClient, Session } from "@/lib/auth/types";

const navigation = vi.hoisted(() => ({
  search: "",
  router: { replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

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
  };
}

function renderForm() {
  return render(
    <AuthProvider client={client()}>
      <SigninForm />
    </AuthProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  navigation.search = "";
  navigation.router.replace.mockReset();
  navigation.router.refresh.mockReset();
});

describe("sign-in copy", () => {
  it("keeps the mock password hint in mock mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    renderForm();

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.getByText(/Passwords are mock-only/i)).toBeInTheDocument();
  });

  it("uses Supabase Auth copy in live mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    renderForm();

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.queryByText(/mock-only/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Supabase Auth/i)).toBeInTheDocument();
    expect(screen.queryByText(/Mock authentication/i)).not.toBeInTheDocument();
  });

  it("explains an expired session", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    navigation.search = "reason=expired";
    renderForm();

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/session expired/i);
  });
});
