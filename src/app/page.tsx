import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * F0 placeholder landing. The cinematic R3F hero + scroll narrative land in F1.
 */
export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg px-6 text-center">
      <div aria-hidden="true" className="glow-violet absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2" />
      <div aria-hidden="true" className="glow-cyan absolute bottom-0 left-1/4 h-[320px] w-[520px]" />
      <main className="relative flex max-w-2xl flex-col items-center gap-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          ResumeIQ Workspace
        </p>
        <h1 className="font-display text-5xl leading-tight tracking-tight sm:text-6xl">
          Your truth, in every resume.
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted">
          Maintain your career information once, keep your standard resume
          synchronized, and generate tailored, evidence-based resumes for every
          application. Never fabricated — every claim traces to evidence.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/workspace">
            <Button size="lg">Open workspace</Button>
          </Link>
          <Link href="/design-system">
            <Button size="lg" variant="secondary">
              Design system
            </Button>
          </Link>
        </div>
        <p className="font-mono text-xs text-muted">
          Free forever · No paywalls · No invented experience
        </p>
      </main>
    </div>
  );
}
