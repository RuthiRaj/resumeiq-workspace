import { Badge } from "@/components/ui/badge";
import type { EvidenceState } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const LABELS: Record<EvidenceState, string> = {
  verified: "Verified",
  attested: "User-attested",
  related: "Related, unverified",
  missing: "Missing",
};

/** Evidence-state badge for workspace items (PRD §4). */
export function EvidenceBadge({
  state,
  className,
}: {
  state: EvidenceState;
  className?: string;
}) {
  return (
    <Badge
      variant={state}
      aria-label={`Evidence: ${LABELS[state]}`}
      className={cn(className)}
    >
      <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current" />
      {LABELS[state]}
    </Badge>
  );
}
