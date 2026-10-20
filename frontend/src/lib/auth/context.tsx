"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setUnauthorizedHandler } from "@/lib/api/client";
import { createAuthClient } from "./create-client";
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
  const [authClient] = useState<AuthClient>(() => client ?? createAuthClient());
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const expiringRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await authClient.getSession();
      if (next) expiringRef.current = false;
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    } catch {
      setSession(null);
      setStatus("unauthenticated");
    }
  }, [authClient]);

  /**
   * A 401 from the API means the access token is no longer valid. Clear the
   * session once, then leave the app; auth pages stay put so the user can sign
   * in again without a redirect loop.
   */
  const expireSession = useCallback(() => {
    if (expiringRef.current) return;
    expiringRef.current = true;
    setSession(null);
    setStatus("unauthenticated");
    void authClient.signOut().catch(() => {});
    if (typeof window === "undefined") return;
    const { pathname, search } = window.location;
    const onAuthPage =
      pathname.startsWith("/signin") ||
      pathname.startsWith("/signup") ||
      pathname.startsWith("/forgot-password");
    if (onAuthPage) return;
    const next = `${pathname}${search}`;
    // Full navigation, not a client push: it clears the React Query cache that
    // still belongs to the expired session.
    window.location.assign(
      new URL(
        `/signin?reason=expired&next=${encodeURIComponent(next)}`,
        window.location.origin,
      ).toString(),
    );
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

  // Live transport: follow sign-out and token-refresh events. The mock client
  // has nothing to subscribe to, so this is a no-op there.
  useEffect(() => {
    const subscribe = authClient.subscribe?.bind(authClient);
    if (!subscribe) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    subscribe((next) => {
      if (cancelled) return;
      if (next) expiringRef.current = false;
      setSession(next);
      setStatus(next ? "authenticated" : "unauthenticated");
    })
      .then((stop) => {
        if (cancelled) stop();
        else unsubscribe = stop;
      })
      .catch(() => {
        // The mount read of getSession still governs if subscribing fails.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [authClient]);

  // The API client is outside React, so it reaches the session through this
  // registration. A 401 then clears the session and redirects to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(expireSession);
    return () => setUnauthorizedHandler(null);
  }, [expireSession]);

  const signUp = useCallback(
    async (params: SignupParams) => {
      const next = await authClient.signUp(params);
      expiringRef.current = false;
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authClient],
  );

  const signIn = useCallback(
    async (params: SigninParams) => {
      const next = await authClient.signIn(params);
      expiringRef.current = false;
      setSession(next);
      setStatus("authenticated");
      return next;
    },
    [authClient],
  );

  const signInWithOAuth = useCallback(
    async (provider: "google" | "github") => {
      const next = await authClient.signInWithOAuth(provider);
      expiringRef.current = false;
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
