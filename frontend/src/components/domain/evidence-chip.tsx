import type { EvidenceState } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const stateRing: Record<EvidenceState, string> = {
  verified: "border-evidence-verified/50 text-evidence-verified",
  attested: "border-evidence-attested/50 text-evidence-attested",
  related: "border-evidence-related/50 text-evidence-related",
  missing: "border-evidence-missing/50 text-evidence-missing",
};

/**
 * Evidence chip — attaches to a single claim in a tailored resume (PRD §7.4.6).
 * Clicking opens the source workspace item (wired in F5).
 */
export function EvidenceChip({
  state,
  label,
  onOpen,
  className,
}: {
  state: EvidenceState;
  label: string;
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={onOpen ? "Open source workspace item" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-transparent px-2 py-0.5",
        "text-[11px] font-medium transition-colors duration-200 hover:bg-white/[0.06]",
        stateRing[state],
        className,
      )}
    >
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current" />
      {label}
    </button>
  );
}
