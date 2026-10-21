import { Check, Construction } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";

/**
 * Shared placeholder for app routes whose full UI lands in later milestones
 * (PRD §9: F5/F6). It states plainly what the page will do, lists the planned
 * capabilities, and gives one working way forward — no dead buttons, no dead
 * ends, and nothing is invented to look finished.
 */
export function PlaceholderPage({
  title,
  milestone,
  description,
  capabilities,
}: {
  title: string;
  milestone: string;
  description: string;
  capabilities: string[];
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-5 py-10">
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        {milestone}
      </p>
      <h1 className="font-display text-4xl tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted">{description}</p>

      <div className="glass w-full rounded-md p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <Construction className="size-4 text-muted" aria-hidden="true" />
          What this page will do
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {capabilities.map((capability) => (
            <li key={capability} className="flex items-start gap-2 text-sm text-muted">
              <Check className="mt-0.5 size-4 shrink-0 text-evidence-verified" aria-hidden="true" />
              <span>{capability}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Not built yet — this is a placeholder for a later milestone. Nothing on this page is
          interactive.
        </p>
      </div>

      <LinkButton href="/workspace" variant="secondary" size="sm">
        Back to your workspace
      </LinkButton>
    </div>
  );
}
