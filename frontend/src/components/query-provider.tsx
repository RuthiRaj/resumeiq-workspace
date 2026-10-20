"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isLiveMode } from "@/lib/config/mode";

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

/** Live mode talks to the real API, so MSW must stay out of the way (I1). */
const MOCKS_REQUIRED = process.env.NODE_ENV === "development" && !isLiveMode();

/**
 * App-only data provider (F2+ routes under (app)/ and the auth screens). NOT
 * mounted on marketing routes, so the landing page never ships
 * @tanstack/react-query or the dev MSW starter.
 *
 * The mock API must be intercepting before any screen fires its first request:
 * React runs child effects before parent effects, so without this gate a
 * protected route's `getSession()` would run before the MSW worker is ready,
 * get a passthrough 404, and bounce to `/signin` (PRD §8.4). In development we
 * therefore render nothing until `startMocks()` resolves; production never had
 * a mock API, so it renders immediately.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  const [mocksReady, setMocksReady] = useState(!MOCKS_REQUIRED);

  useEffect(() => {
    if (!MOCKS_REQUIRED) return;
    let cancelled = false;
    void import("@/mocks/start")
      .then(({ startMocks }) => startMocks())
      .catch(() => false)
      .then(() => {
        // Render either way: if the worker failed to start, screens show their
        // honest error states (see `startMocks`), never a blank page.
        if (!cancelled) setMocksReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {mocksReady ? children : null}
    </QueryClientProvider>
  );
}
