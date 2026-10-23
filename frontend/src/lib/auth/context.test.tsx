import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { setAccessTokenProvider } from "@/lib/api/token";
import { AuthProvider, useAuth } from "./context";
import type { AuthClient, Session } from "./types";

const SESSION: Session = {
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    provider: "password",
    createdAt: "2026-10-01T09:00:00.000Z",
  },
  token: "access-token",
  createdAt: "2026-10-01T09:00:00.000Z",
};

function baseClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: async () => SESSION,
    signUp: async () => SESSION,
    signIn: async () => SESSION,
    signInWithOAuth: async () => SESSION,
    requestPasswordReset: async () => ({ message: "ok" }),
    signOut: async () => {},
    signOutEverywhere: async () => {},
    changePassword: async () => {},
    updateDisplayName: async () => SESSION,
    ...overrides,
  };
}

function Probe() {
  const { status, user } = useAuth();
  return (
    <span data-testid="auth-status">
      {`${status}:${user?.email ?? "none"}`}
    </span>
  );
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
  window.history.replaceState({}, "", "/signin");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setAccessTokenProvider(null);
  window.history.replaceState({}, "", "/");
});

describe("AuthProvider live session handling", () => {
  it("follows auth-state changes from the live client", async () => {
    let emit: ((next: Session | null) => void) | undefined;
    const subscribe = vi.fn(
      async (listener: (next: Session | null) => void) => {
        emit = listener;
        return () => {};
      },
    );

    render(
      <AuthProvider client={baseClient({ subscribe })}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "authenticated:ada@example.com",
      ),
    );
    expect(subscribe).toHaveBeenCalledTimes(1);

    act(() => emit?.(null));

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "unauthenticated",
      ),
    );
  });

  it("clears the session when an API call returns 401", async () => {
    const signOut = vi.fn(async () => {});
    setAccessTokenProvider(async () => "access-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: { code: "unauthorized", message: "Session expired." },
            }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            },
          ),
      ),
    );

    render(
      <AuthProvider client={baseClient({ signOut })}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "authenticated",
      ),
    );

    await act(async () => {
      await api.getWorkspace().catch(() => {});
    });

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent(
        "unauthenticated",
      ),
    );
  });
});
