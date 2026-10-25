"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, RefreshCw } from "lucide-react";

/**
 * Global error page (app/global-error.tsx).
 * Shown when an unhandled error occurs anywhere in the app.
 * No stack traces, just a friendly message with links back to the workspace or home.
 * This is a client component because it uses 'use client' and interactive elements.
 */
export default function GlobalError({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-full">
        <main className="flex min-h-[70vh] items-center justify-center px-6">
          <div className="glass rounded-lg p-10 max-w-md w-full text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-evidence-missing/10 text-evidence-missing">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="font-display text-3xl tracking-tight mb-3">Something went wrong</h1>
            <p className="text-muted mb-6 max-w-sm mx-auto">
              An unexpected error occurred. Please try again or go back to the home page.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button variant="primary" size="lg" onClick={reset}>
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
              <Link href="/">
                <Button variant="secondary" size="lg">
                  <Home className="mr-2 h-4 w-4" aria-hidden="true" />
                  Go home
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}