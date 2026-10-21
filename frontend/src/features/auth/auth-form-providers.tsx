"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/toaster";
import { AuthProvider } from "@/lib/auth/context";
import { useMockBackendReady } from "@/lib/use-mock-backend";
import { AuthFormReadyProvider } from "./auth-form-ready";

/**
 * Providers for the credential screens (sign in, sign up, forgot password).
 *
 * Unlike `AuthPageProviders`, this does not gate the tree on the mock worker:
 * the form is server-rendered and usable without JavaScript, and the submit
 * button stays disabled via `useAuthFormReady()` until the worker (or live
 * transport) is ready. They do not use React Query, so it is not mounted here.
 */
export function AuthFormProviders({ children }: { children: ReactNode }) {
  const ready = useMockBackendReady();

  return (
    <AuthFormReadyProvider ready={ready}>
      <AuthProvider ready={ready}>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </AuthProvider>
    </AuthFormReadyProvider>
  );
}
