"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
 * App-only data provider (F2+ routes under (app)/). NOT mounted on marketing
 * routes, so the landing page never ships @tanstack/react-query or the dev
 * MSW starter. Toasts are mounted separately (see Toaster, used by AppShell).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  useEffect(() => {
    // Start the MSW mock API in development only (PRD §8.3).
    void import("@/mocks/start").then(({ startMocks }) => startMocks());
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
