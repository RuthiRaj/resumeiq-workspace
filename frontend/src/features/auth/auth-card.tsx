import Link from "next/link";
import type { ReactNode } from "react";
import { isLiveMode } from "@/lib/config/mode";

/**
 * Centered glass auth shell shared by signin/signup/forgot-password.
 * Pure server component: no providers, so marketing bundle is untouched.
 */
export function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center overflow-hidden px-6 py-16">
      <div aria-hidden="true" className="glow-violet pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2" />
      <div aria-hidden="true" className="glow-cyan pointer-events-none absolute -bottom-24 left-1/4 size-72" />
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span
          className="flex size-8 items-center justify-center rounded-sm bg-gradient-to-br from-accent-violet to-accent-cyan font-display text-lg text-white"
        >
          R
        </span>
        <span className="text-sm font-semibold tracking-tight">ResumeIQ</span>
      </Link>
      <section aria-labelledby="auth-title" className="glass relative rounded-md p-6 sm:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
          {eyebrow}
        </p>
        <h1 id="auth-title" className="mt-2 font-display text-3xl tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
        <div className="mt-6">{children}</div>
        <div className="mt-6 border-t border-white/[0.08] pt-4 text-sm text-muted">
          {footer}
        </div>
      </section>
      {isLiveMode() ? null : (
        <p className="mt-6 text-center text-xs leading-relaxed text-muted">
          Mock authentication for the frontend milestone — no real credentials leave
          your browser. Supabase Auth replaces this layer at backend integration.
        </p>
      )}
    </main>
  );
}
