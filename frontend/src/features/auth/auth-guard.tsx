"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Client-side route guard for the (app) group (F2 mock auth).
 * Why client-side, not `proxy.ts`: the mock session lives in localStorage,
 * which the edge/server proxy cannot read. Next 16 docs (`dist/docs`,
 * proxy = ex-middleware) explicitly discourage full session management in
 * proxy — optimistic checks only. Supabase cookies (B0) will enable a real
 * proxy/route-handler check later without changing this component's contract.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    }
  }, [status, pathname, searchParams, router]);

  if (status === "loading") {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 py-10"
        aria-busy="true"
        aria-label="Checking your session"
      >
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 py-10"
        aria-busy="true"
        aria-label="Redirecting to sign in"
      >
        <p className="text-sm text-muted">Checking your session — redirecting to sign in…</p>
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  return <>{children}</>;
}
