import Link from "next/link";

/**
 * Not-found page (app/not-found.tsx).
 * Shown when the user visits an unknown route.
 * No stack traces, just a friendly message with links back to the workspace or home.
 * Server component to keep it out of client bundles.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="glass rounded-lg p-10 max-w-md w-full text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-evidence-missing/10 text-evidence-missing">
          <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="font-display text-3xl tracking-tight mb-3">Page not found</h1>
        <p className="text-muted mb-6 max-w-sm mx-auto">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-[filter,background-color,color] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 bg-action text-white hover:brightness-110 focus-visible:outline-accent-cyan h-12 px-6 text-base">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Go home
          </Link>
          <Link href="/signin" className="inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-[filter,background-color,color] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 glass text-text hover:bg-white/[0.09] h-12 px-6 text-base">
            Sign in to workspace
          </Link>
        </div>
      </div>
    </main>
  );
}