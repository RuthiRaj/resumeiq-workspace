import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { QueryProvider } from "@/components/query-provider";
import { Toaster } from "@/components/toaster";
import { AuthProvider } from "@/lib/auth/context";
import { AuthGuard } from "@/features/auth/auth-guard";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Authenticated routes: data + session providers, route guard, shell, toasts.
 * Kept out of the root layout so marketing routes never ship this JS.
 */
export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <AuthProvider>
        <Suspense
          fallback={
            <div className="mx-auto max-w-3xl px-6 py-10" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
          }
        >
          <AuthGuard>
            <AppShell>{children}</AppShell>
          </AuthGuard>
        </Suspense>
        <Toaster />
      </AuthProvider>
    </QueryProvider>
  );
}
