"use client";

import { AuthProvider } from "@/lib/auth/context";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Standalone providers for interactive routes outside the (app) shell that
 * make API calls (onboarding). Mirrors the (app) layout stack without the
 * sidebar. Credential screens use `AuthFormProviders` instead, because their
 * form must render before the mock worker is ready (and without JavaScript).
 */
export function AuthPageProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </AuthProvider>
    </QueryProvider>
  );
}
