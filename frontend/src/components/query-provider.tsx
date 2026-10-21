"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMockBackendReady } from "@/lib/use-mock-backend";

let client: QueryClient | null = null;
function getQueryClient(): QueryClient {
  if (!client) {
    client = new QueryClient({
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      },
    });
  }
  return client;
}

/**
 * App-only data provider (F2+ routes under (app)/ and onboarding). NOT mounted
 * on marketing routes, so the landing page never ships @tanstack/react-query.
 *
 * The mock API must be intercepting before any screen fires its first request:
 * React runs child effects before parent effects, so without this gate a
 * protected route's `getSession()` would run before the MSW worker is ready,
 * get a passthrough 404, and bounce to `/signin` (PRD §8.4). In development we
 * therefore render nothing until `startMocks()` resolves; production never had
 * a mock API, so it renders immediately.
 *
 * The credential screens do not use this provider: they must keep their form
 * in the server HTML even without JavaScript. They render immediately and wait
 * on the same readiness flag before enabling submit (see AuthFormProviders).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  const mocksReady = useMockBackendReady();

  return (
    <QueryClientProvider client={queryClient}>
      {mocksReady ? children : null}
    </QueryClientProvider>
  );
}
