import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * F2 placeholder: target-intake form lands in F4. The command palette and
 * quick-create menu point here, so this page explains what's next instead
 * of 404ing.
 */
export default function NewTargetPage() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        Coming in F4
      </p>
      <h1 className="font-display text-4xl tracking-tight">New job target</h1>
      <p className="text-sm leading-relaxed text-muted">
        Paste a job description and we&apos;ll extract must-have skills,
        nice-to-haves, seniority and keywords — then match each requirement
        against your workspace evidence. The intake form and analysis theatre
        land in F4.
      </p>
      <div className="glass flex w-full flex-col gap-2 rounded-md p-4">
        <p className="text-sm font-medium">What you can do today</p>
        <p className="text-sm text-muted">
          Save the job description text somewhere handy. In F4 you&apos;ll
          paste the role, company and description here.
        </p>
      </div>
      <Link href="/targets">
        <Button variant="secondary" size="sm">
          Back to job targets
        </Button>
      </Link>
    </div>
  );
}
