"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createMockAuthClient } from "./client";
import type {
  AuthClient,
  Session,
  SessionUser,
  SigninParams,
  SignupParams,
} from "./types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  session: Session | null;
  signUp: (params: SignupParams) => Promise<Session>;
  signIn: (params: SigninParams) => Promise<Session>;
  signInWithOAuth: (provider: "google" | "github") => Promise<Session>;
  requestPasswordReset: (email: string) => Promise<{ message: string }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session provider (mock transport). Resolves the persisted session once on
 * mount so it survives reloads; route guards consume `status`.
 */
export function AuthProvider({
  children,
  client,
}: {
  children: React.ReactNode;
  client?: AuthClient;
}) {
  // Stabilise the client identity: a fresh object per render would re-fire
  // the session effect below into an infinite getSession loop.
  const [authClient] = useState<AuthClient>(() => client ?? createMockAuthClient());
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await authClient.getSession();
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    } catch {
      setSession(null);
      setStatus("unauthenticated");
    }
  }, [authClient]);

  // Resolve the persisted session once on mount (setState runs in promise
  // callbacks, not synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;
    authClient.getSession().then(
      (next) => {
        if (cancelled) return;
        setSession(next);
        setStatus(next ? "authenticated" : "unauthenticated");
      },
      () => {
        if (cancelled) return;
        setSession(null);
        setStatus("unauthenticated");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authClient]);

  const signUp = useCallback(
    async (params: SignupParams) => {
      const next = await authClient.signUp(params);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authClient],
  );

  const signIn = useCallback(
    async (params: SigninParams) => {
      const next = await authClient.signIn(params);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authClient],
  );

  const signInWithOAuth = useCallback(
    async (provider: "google" | "github") => {
      const next = await authClient.signInWithOAuth(provider);
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authClient],
  );

  const requestPasswordReset = useCallback(
    (email: string) => authClient.requestPasswordReset(email),
    [authClient],
  );

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setSession(null);
    setStatus("unauthenticated");
  }, [authClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      session,
      signUp,
      signIn,
      signInWithOAuth,
      requestPasswordReset,
      signOut,
      refresh,
    }),
    [status, session, signUp, signIn, signInWithOAuth, requestPasswordReset, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>.");
  return ctx;
}

/** Null-safe variant for surfaces rendered without a provider (e.g. previews). */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
