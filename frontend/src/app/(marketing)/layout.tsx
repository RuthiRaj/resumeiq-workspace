import Link from "next/link";
import { LazyMotion, domAnimation } from "motion/react";
import { Button } from "@/components/ui/button";
import { SmoothScroll } from "@/components/marketing/smooth-scroll";
import "./marketing.css";

/**
 * Marketing layout (F1): minimal header + footer, Lenis smooth scroll.
 * Motion runs through LazyMotion/domAnimation so the landing never ships the
 * full animation feature set. No app sidebar here.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LazyMotion features={domAnimation} strict>
      <SmoothScroll />
      <header
        data-app-chrome
        className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-bg/70 backdrop-blur-xl"
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-6">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-sm bg-gradient-to-br from-accent-violet to-accent-cyan font-display text-lg text-white"
            >
              R
            </span>
            <span className="text-sm font-semibold tracking-tight">ResumeIQ</span>
          </Link>
          <nav aria-label="Landing sections" className="ml-6 hidden items-center gap-5 text-sm text-muted sm:flex">
            <Link href="#how-it-works" className="transition-colors hover:text-text">
              How it works
            </Link>
            <Link href="#faq" className="transition-colors hover:text-text">
              FAQ
            </Link>
          </nav>
          <div className="flex-1" />
          <Link href="/signin">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </header>

      <div className="pt-16">{children}</div>

      <footer data-app-chrome className="border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-sm bg-gradient-to-br from-accent-violet to-accent-cyan font-display text-base text-white"
            >
              R
            </span>
            <span className="text-sm font-semibold tracking-tight">ResumeIQ</span>
          </div>
          <p className="text-xs text-muted">
            Your truth, in every resume. Free, forever.
          </p>
          <nav aria-label="Footer" className="flex items-center gap-5 text-sm text-muted sm:ml-auto">
            <Link href="/privacy" className="transition-colors hover:text-text">
              Privacy
            </Link>
            <Link href="/signin" className="transition-colors hover:text-text">
              Sign in
            </Link>
            <Link href="/design-system" className="transition-colors hover:text-text">
              Design system
            </Link>
          </nav>
        </div>
      </footer>
    </LazyMotion>
  );
}
