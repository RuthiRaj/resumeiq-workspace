import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * F2 placeholder: the route onboarding links to. Full side-by-side
 * extraction review lands in F4 — this page is honest about that and never
 * a dead end.
 */
export default function WorkspaceImportPage() {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        Coming in F4
      </p>
      <h1 className="font-display text-4xl tracking-tight">Import documents</h1>
      <p className="text-sm leading-relaxed text-muted">
        Upload a resume, certificate or course document and review every
        extracted field side-by-side before anything enters your workspace.
        Uncertain fields will be flagged for verification — nothing is saved
        until you confirm each item.
      </p>
      <div className="glass flex w-full flex-col gap-2 rounded-md p-4">
        <p className="text-sm font-medium">What you can do today</p>
        <p className="text-sm text-muted">
          Gather one PDF resume and one certificate. The F4 review screen will
          walk you through each field.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/workspace">
          <Button variant="secondary" size="sm">
            Back to workspace
          </Button>
        </Link>
        <Link href="/onboarding">
          <Button variant="ghost" size="sm">
            Revisit onboarding
          </Button>
        </Link>
      </div>
    </div>
  );
}
