"use client";

import { AuthProvider } from "@/lib/auth/context";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Standalone providers for routes outside the (app) shell (signin, signup,
 * forgot-password, onboarding). Mirrors the (app) layout stack without the
 * sidebar so auth screens stay functional and MSW-backed in dev.
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
