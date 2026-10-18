import type { EvidenceState } from "@/lib/schemas";
import { EVIDENCE_QUALITY } from "@/lib/analysis/weights";
import type { BadgeVariant } from "@/components/ui/badge";

/**
 * Plain-language explanations for every evidence state (PRD §4.2). These are
 * shown next to the selector so choosing a state is an informed choice, never
 * a hidden flag. The wording never claims more than the evidence supports.
 */
export interface EvidenceMeta {
  state: EvidenceState;
  /** Badge/label text. */
  label: string;
  description: string;
  badge: BadgeVariant;
  /** Tailwind text colour for dots and counts. */
  text: string;
  /** Tailwind background for dots. */
  dot: string;
  /** Ring + glow applied to section cards holding this state. */
  glow: string;
  /** Relative quality weight (0–1), from the shared evidence-quality table
   *  in `lib/analysis/weights.ts` so scoring can never drift from this UI. */
  weight: number;
}

export const EVIDENCE_ORDER: EvidenceState[] = [
  "verified",
  "attested",
  "related",
  "missing",
];

export const EVIDENCE_META: Record<EvidenceState, EvidenceMeta> = {
  verified: {
    state: "verified",
    label: "Verified",
    description:
      "A document or link is attached that supports this item. This is the strongest state.",
    badge: "verified",
    text: "text-evidence-verified",
    dot: "bg-evidence-verified",
    glow: "ring-1 ring-evidence-verified/40 shadow-[0_0_28px_-10px_rgba(52,211,153,0.55)]",
    weight: EVIDENCE_QUALITY.verified,
  },
  attested: {
    state: "attested",
    label: "User-attested",
    description:
      "You typed this yourself. Nothing confirms it yet — attach a document or link to verify it.",
    badge: "attested",
    text: "text-evidence-attested",
    dot: "bg-evidence-attested",
    glow: "ring-1 ring-evidence-attested/40 shadow-[0_0_28px_-10px_rgba(96,165,250,0.5)]",
    weight: EVIDENCE_QUALITY.attested,
  },
  related: {
    state: "related",
    label: "Related, unverified",
    description:
      "Adjacent or partial evidence only. Related is not the same as equivalent — for example, JavaScript is not TypeScript.",
    badge: "related",
    text: "text-evidence-related",
    dot: "bg-evidence-related",
    glow: "ring-1 ring-evidence-related/40 shadow-[0_0_28px_-10px_rgba(251,191,36,0.5)]",
    weight: EVIDENCE_QUALITY.related,
  },
  missing: {
    state: "missing",
    label: "Missing",
    description:
      "No evidence recorded yet. Add a document, link or detail before relying on this.",
    badge: "missing",
    text: "text-evidence-missing",
    dot: "bg-evidence-missing",
    glow: "ring-1 ring-evidence-missing/40 shadow-[0_0_28px_-10px_rgba(251,113,133,0.5)]",
    weight: EVIDENCE_QUALITY.missing,
  },
};
