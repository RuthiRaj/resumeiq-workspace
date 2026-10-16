"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/toaster";

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

/** Root providers: TanStack Query + toasts + dev MSW worker. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  useEffect(() => {
    // Start the MSW mock API in development only (PRD §8.3).
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      import("@/mocks/browser")
        .then(({ worker }) => worker.start())
        .catch(() => {
          // Mock worker is optional; the app renders without it.
        });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
