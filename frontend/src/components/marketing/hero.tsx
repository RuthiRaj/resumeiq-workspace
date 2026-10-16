import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroBackdrop } from "@/components/marketing/hero-backdrop";
import { ScrollButton } from "@/components/marketing/scroll-button";

/**
 * Hero (server component). All copy and CTAs SSR as static HTML for SEO and
 * instant paint; only the decorative backdrop and the scroll behaviour are
 * client islands. The h1 carries no entrance animation (LCP budget, PRD §7.7).
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden">
      <HeroBackdrop />

      <div className="relative mx-auto flex min-h-[92svh] w-full max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <div className="flex max-w-3xl flex-col items-center gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
            ResumeIQ Workspace
          </p>
          <h1
            id="hero-heading"
            className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          >
            Your truth, in every resume.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Every claim on your resume traces back to evidence you own — your
            work, your projects, your proof. Nothing invented, ever.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Start your workspace</Button>
            </Link>
            <ScrollButton />
          </div>
          <p className="font-mono text-xs text-muted">
            Free, forever · No paywalls · No invented experience
          </p>
        </div>
      </div>
    </section>
  );
}
