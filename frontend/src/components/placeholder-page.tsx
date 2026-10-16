import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Shared placeholder for app routes whose full UI lands in later milestones.
 * Guarantees no dead ends: every sidebar destination renders loading-ready,
 * honest "coming in F<n>" content instead of a 404.
 */
export function PlaceholderPage({
  title,
  milestone,
  description,
}: {
  title: string;
  milestone: string;
  description: string;
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        {milestone}
      </p>
      <h1 className="font-display text-4xl tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
      <Link href="/design-system">
        <Button variant="secondary" size="sm">
          View design system
        </Button>
      </Link>
    </div>
  );
}
