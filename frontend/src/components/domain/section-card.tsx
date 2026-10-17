import Link from "next/link";
import type { WorkspaceItem } from "@/lib/schemas";
import {
  EVIDENCE_META,
  EVIDENCE_ORDER,
} from "@/features/workspace/evidence";
import { evidenceCounts, weakestEvidence } from "@/features/workspace/workspace-utils";
import type { WorkspaceSectionMeta } from "@/features/workspace/sections";
import { cn } from "@/lib/utils";

/**
 * Dashboard section card (PRD §7.4.3): item count plus an evidence-state glow
 * so gaps are visible at a glance. The glow tracks the *weakest* state present,
 * not the majority, and never invents a healthy colour for an empty section.
 */
export function SectionCard({
  meta,
  items,
}: {
  meta: WorkspaceSectionMeta;
  items: WorkspaceItem[];
}) {
  const count = items.length;
  const counts = evidenceCounts(items);
  const weakest = weakestEvidence(items);
  const Icon = meta.icon;
  const breakdown = EVIDENCE_ORDER.filter((state) => counts[state] > 0)
    .map((state) => `${counts[state]} ${EVIDENCE_META[state].label.toLowerCase()}`)
    .join(", ");

  return (
    <Link
      href={`/workspace/${meta.key}`}
      aria-label={`${meta.label}, ${count} ${count === 1 ? "item" : "items"}${breakdown ? `: ${breakdown}` : ", empty"}`}
      className={cn(
        "glass group flex flex-col gap-3 rounded-md p-4 transition-colors duration-200 hover:bg-white/[0.09]",
        weakest ? EVIDENCE_META[weakest].glow : "ring-1 ring-white/[0.06]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 items-center justify-center rounded-sm border border-white/[0.12] bg-elevated">
          <Icon className="size-4 text-accent-cyan" aria-hidden="true" />
        </span>
        <span className="font-mono text-lg tabular-nums text-text">{count}</span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-text">{meta.label}</p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
          {count === 0 ? meta.emptyHint : meta.description}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-3">
        {count === 0 ? (
          <span className="text-[11px] uppercase tracking-widest text-muted">Empty — add one</span>
        ) : (
          EVIDENCE_ORDER.filter((state) => counts[state] > 0).map((state) => (
            <span key={state} className="flex items-center gap-1 text-[11px] text-muted">
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", EVIDENCE_META[state].dot)}
              />
              {counts[state]}
              <span className="sr-only"> {EVIDENCE_META[state].label}</span>
            </span>
          ))
        )}
      </div>
    </Link>
  );
}
