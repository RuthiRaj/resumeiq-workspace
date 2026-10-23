/**
 * Live Supabase Auth adapter (I1).
 *
 * Implements the same `AuthClient` the mock transport implements, so every
 * screen keeps talking to the interface and never to Supabase directly.
 *
 * Privacy: only the publishable key is read (an anon/service-role key would
 * break the no-secrets test); tokens live in Supabase's own storage and are
 * never logged, rendered or copied into an error message.
 *
 * Bundle: `@supabase/supabase-js` is imported dynamically, so the marketing
 * bundle never contains it and mock mode never downloads it.
 */

import { supabasePublishableKey, supabaseUrl } from "@/lib/config/mode";
import { RequestTimeoutError, withTimeout } from "@/lib/async/with-timeout";
import type { AuthClient, Session, SessionUser, SignupParams } from "./types";
import { AuthError } from "./types";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
type SupabaseSession = import("@supabase/supabase-js").Session;
type SupabaseUser = import("@supabase/supabase-js").User;

let clientPromise: Promise<SupabaseClient> | null = null;

async function getClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const url = supabaseUrl();
      const key = supabasePublishableKey();
      if (!url || !key) {
        throw new AuthError(
          "Live sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
          "unknown",
        );
      }
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })();
  }
  return clientPromise;
}

function providerOf(user: SupabaseUser): SessionUser["provider"] {
  const provider = user.app_metadata?.provider;
  if (provider === "google" || provider === "github") return provider;
  return "password";
}

function displayName(user: SupabaseUser): string {
  const metadata = user.user_metadata ?? {};
  const candidate = metadata.full_name ?? metadata.name ?? metadata.display_name;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  const email = user.email ?? "";
  return email.includes("@") ? email.slice(0, email.indexOf("@")) : "Your account";
}

/** Pure mapping, exported so it can be unit-tested without a network. */
export function sessionFromSupabase(
  session: SupabaseSession,
): Session | null {
  const user = session.user;
  const token = session.access_token;
  if (!user || !token) return null;
  return {
    user: {
      id: user.id,
      name: displayName(user),
      email: user.email ?? "",
      provider: providerOf(user),
      createdAt: user.created_at ?? session.expires_at?.toString() ?? "",
    },
    token,
    createdAt: user.created_at ?? "",
  };
}

const NETWORK_MESSAGE =
  "We couldn't reach the sign-in service. Check your connection and try again.";

const AUTH_TIMEOUT_MS = 20_000;
const AUTH_TIMEOUT_MESSAGE =
  "The sign-in service took too long. Check your connection and try again.";

/**
 * Auth calls need a deadline: a hung Supabase request otherwise leaves a
 * button on "Signing in…" indefinitely (S-09). A timeout is reported like a
 * network failure so the screens show their existing retry copy.
 */
async function withAuthTimeout<T>(work: Promise<T>): Promise<T> {
  try {
    return await withTimeout(work, AUTH_TIMEOUT_MS, AUTH_TIMEOUT_MESSAGE);
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new AuthError(AUTH_TIMEOUT_MESSAGE, "network");
    }
    throw error;
  }
}

function mapSupabaseError(error: unknown, action: "signin" | "signup" | "reset" | "update"): AuthError {
  const candidate = error as { message?: unknown; status?: unknown; code?: unknown };
  const rawMessage =
    typeof candidate?.message === "string" ? candidate.message : "";
  const status = typeof candidate?.status === "number" ? candidate.status : 0;
  const lower = rawMessage.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return new AuthError(
      "That email and password don't match. Check them and try again.",
      "invalid_credentials",
    );
  }
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return new AuthError(
      "An account with this email already exists. Try signing in.",
      "email_taken",
    );
  }
  if (lower.includes("email not confirmed")) {
    return new AuthError(
      "Confirm your email first — check your inbox for the link.",
      "validation",
    );
  }
  if (lower.includes("rate limit") || status === 429) {
    return new AuthError(
      "Too many attempts. Wait a minute and try again.",
      "unknown",
    );
  }
  if (status === 0) {
    return new AuthError(NETWORK_MESSAGE, "network");
  }
  if (action === "reset") {
    return new AuthError(
      "We couldn't send the reset email. Try again in a moment.",
      status === 422 ? "validation" : "unknown",
    );
  }
  if (action === "update") {
    return new AuthError(
      "We couldn't update your account. Check the fields and try again.",
      status === 422 ? "validation" : "unknown",
    );
  }
  return new AuthError(
    action === "signup"
      ? "We couldn't create the account. Check the highlighted fields and try again."
      : "Something went wrong. Try again.",
    status === 422 ? "validation" : "unknown",
  );
}

async function currentSession(): Promise<SupabaseSession | null> {
  const supabase = await getClient();
  const { data, error } = await withAuthTimeout(supabase.auth.getSession());
  if (error) throw mapSupabaseError(error, "signin");
  const session = data.session;
  if (!session) return null;

  // Refresh shortly before expiry so an in-flight API call never takes an
  // expired Bearer token (I1 session refresh).
  const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
  if (expiresAt > 0 && expiresAt - Date.now() < 60_000) {
    const { data: refreshed, error: refreshError } = await withAuthTimeout(
      supabase.auth.refreshSession(),
    );
    if (refreshError) return null;
    return refreshed.session;
  }
  return session;
}

/** Bearer token for the FastAPI client. Returns null when signed out. */
export async function getLiveAccessToken(): Promise<string | null> {
  const session = await currentSession();
  return session?.access_token ?? null;
}

/** The Supabase client, for the one non-API call in this milestone (consent). */
export async function getSupabaseClient(): Promise<SupabaseClient> {
  return getClient();
}

export function createSupabaseAuthClient(): AuthClient {
  return {
    async getSession() {
      try {
        const session = await currentSession();
        return session ? sessionFromSupabase(session) : null;
      } catch {
        return null;
      }
    },

    async signUp({ name, email, password }: SignupParams) {
      const supabase = await getClient();
      const { data, error } = await withAuthTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: { data: { name } },
        }),
      );
      if (error) throw mapSupabaseError(error, "signup");
      const session = data.session ? sessionFromSupabase(data.session) : null;
      if (!session) {
        throw new AuthError(
          "Account created. Check your email to confirm it, then sign in.",
          "email_confirmation_required",
        );
      }
      return session;
    },

    async signIn({ email, password }) {
      const supabase = await getClient();
      const { data, error } = await withAuthTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
      );
      if (error) throw mapSupabaseError(error, "signin");
      const session = data.session ? sessionFromSupabase(data.session) : null;
      if (!session) {
        throw new AuthError("Sign-in did not return a session. Try again.", "unknown");
      }
      return session;
    },

    async signInWithOAuth() {
      // Social sign-in needs provider configuration and a redirect round trip;
      // the screens hide the buttons in live mode (see ADR-033).
      throw new AuthError(
        "Social sign-in isn't available in live mode yet. Use email and password.",
        "unknown",
      );
    },

    async requestPasswordReset(email: string) {
      const supabase = await getClient();
      const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(email));
      if (error) throw mapSupabaseError(error, "reset");
      // Same message whether or not the account exists: never disclose accounts.
      return {
        message: "If that email has an account, a reset link is on its way.",
      };
    },

    async signOut() {
      try {
        const supabase = await getClient();
        await supabase.auth.signOut();
      } catch {
        // Signing out locally must still succeed when the network is down.
      }
    },

    async signOutEverywhere() {
      const supabase = await getClient();
      const { error } = await withAuthTimeout(
        supabase.auth.signOut({ scope: "global" }),
      );
      if (error) throw mapSupabaseError(error, "signin");
    },

    /**
     * Supabase expects a recent authentication for a password change, so the
     * current password is re-verified first. A wrong password is reported with
     * the same message as a failed sign-in and changes nothing.
     */
    async changePassword(currentPassword: string, newPassword: string) {
      const supabase = await getClient();
      const session = await currentSession();
      const email = session?.user?.email;
      if (!session || !email) {
        throw new AuthError("Sign in again to change your password.", "invalid_credentials");
      }
      if (providerOf(session.user) !== "password") {
        throw new AuthError(
          "This account signs in with a provider, so it has no password to change.",
          "validation",
        );
      }
      const verified = await withAuthTimeout(
        supabase.auth.signInWithPassword({ email, password: currentPassword }),
      );
      if (verified.error) {
        const message = verified.error.message?.toLowerCase() ?? "";
        if (message.includes("invalid login credentials")) {
          throw new AuthError(
            "Current password is incorrect. Nothing was changed.",
            "invalid_credentials",
          );
        }
        throw mapSupabaseError(verified.error, "signin");
      }
      const { error } = await withAuthTimeout(
        supabase.auth.updateUser({ password: newPassword }),
      );
      if (error) throw mapSupabaseError(error, "update");
    },

    async updateDisplayName(name: string) {
      const trimmed = name.trim();
      if (!trimmed) throw new AuthError("Enter your name.", "validation");
      const supabase = await getClient();
      const { error } = await withAuthTimeout(
        supabase.auth.updateUser({ data: { name: trimmed } }),
      );
      if (error) throw mapSupabaseError(error, "update");
      const session = await currentSession();
      const mapped = session ? sessionFromSupabase(session) : null;
      if (!mapped) {
        throw new AuthError("Your session expired. Sign in again.", "invalid_credentials");
      }
      return mapped;
    },

    async subscribe(listener) {
      const supabase = await getClient();
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        // The provider resolves the persisted session itself on mount; an
        // initial event would only race that first read.
        if (event === "INITIAL_SESSION") return;
        listener(session ? sessionFromSupabase(session) : null);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}
