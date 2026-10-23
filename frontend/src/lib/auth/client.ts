import { ApiError } from "@/lib/api/client";
import type {
  AuthClient,
  Session,
  SigninParams,
  SignupParams,
} from "./types";
import { AuthError } from "./types";

/**
 * Mock-transport auth client: talks to `/api/v1/auth/*`, which MSW serves in
 * development (PRD §8.3). Screens depend on the `AuthClient` interface only —
 * a Supabase adapter implementing the same interface replaces this module.
 */
const BASE = "/api/v1/auth";

function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  if (err instanceof ApiError) {
    if (err.status === 401)
      return new AuthError("Invalid email or password.", "invalid_credentials");
    if (err.status === 409)
      return new AuthError(
        "An account with this email already exists. Try signing in.",
        "email_taken",
      );
    if (err.status === 400)
      return new AuthError("Check the highlighted fields and try again.", "validation");
    return new AuthError("Something went wrong. Try again.", "unknown");
  }
  if (err instanceof TypeError)
    return new AuthError("Network error. Check your connection and try again.", "network");
  return new AuthError("Something went wrong. Try again.", "unknown");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 204 || res.status === 205) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed: ${res.status}`;
    const code =
      res.status === 401
        ? "invalid_credentials"
        : res.status === 409
          ? "email_taken"
          : res.status === 400
            ? "validation"
            : "unknown";
    throw new AuthError(message, code as AuthError["code"]);
  }
  return body as T;
}

export function createMockAuthClient(): AuthClient {
  return {
    async getSession(): Promise<Session | null> {
      try {
        const data = await request<{ session: Session | null }>("/session");
        return data.session;
      } catch (err) {
        // No session is a normal state, not an error.
        if (err instanceof AuthError && err.code === "invalid_credentials") return null;
        throw toAuthError(err);
      }
    },
    async signUp(params: SignupParams): Promise<Session> {
      try {
        const data = await request<{ session: Session }>("/signup", {
          method: "POST",
          body: JSON.stringify(params),
        });
        return data.session;
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async signIn(params: SigninParams): Promise<Session> {
      try {
        const data = await request<{ session: Session }>("/signin", {
          method: "POST",
          body: JSON.stringify(params),
        });
        return data.session;
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async signInWithOAuth(provider: "google" | "github"): Promise<Session> {
      try {
        const data = await request<{ session: Session }>("/oauth", {
          method: "POST",
          body: JSON.stringify({ provider }),
        });
        return data.session;
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async requestPasswordReset(email: string): Promise<{ message: string }> {
      try {
        return await request<{ message: string }>("/password-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async signOut(): Promise<void> {
      try {
        await request<void>("/signout", { method: "POST" });
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async signOutEverywhere(): Promise<void> {
      // Mock mode has one session per browser; the same endpoint clears it.
      try {
        await request<void>("/signout", { method: "POST" });
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<void> {
      try {
        await request<void>("/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
      } catch (err) {
        throw toAuthError(err);
      }
    },
    async updateDisplayName(name: string): Promise<Session> {
      try {
        const data = await request<{ session: Session }>("/profile", {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
        return data.session;
      } catch (err) {
        throw toAuthError(err);
      }
    },
  };
}

/** Shared client instance for screens (adapter seam for tests). */
export const mockAuthClient: AuthClient = createMockAuthClient();
