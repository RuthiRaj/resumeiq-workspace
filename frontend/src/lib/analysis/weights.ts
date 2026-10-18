import type { EvidenceState } from "@/lib/schemas";

/**
 * Relative evidence quality per state (0–1). Single source of truth: the
 * workspace completeness ring (F3) and the F4 match scoring both read it, so
 * the two can never drift apart. See docs/DECISIONS.md (ADR-021).
 */
export const EVIDENCE_QUALITY: Record<EvidenceState, number> = {
  verified: 1,
  attested: 0.6,
  related: 0.3,
  missing: 0,
};

/** A workspace item can only support a claim when its evidence is real. */
export function isSupportingEvidence(state: EvidenceState): boolean {
  return state === "verified" || state === "attested";
}

/** Mean evidence quality of a set of items (0 when empty). */
export function meanEvidenceQuality(
  states: EvidenceState[],
): number {
  if (states.length === 0) return 0;
  const total = states.reduce((sum, state) => sum + EVIDENCE_QUALITY[state], 0);
  return total / states.length;
}
