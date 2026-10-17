import { ScoreRing } from "@/components/domain/score-ring";
import type { CompletenessBreakdown } from "./workspace-utils";

/**
 * Completeness ring with its methodology in plain sight. This is a workspace
 * coverage indicator, never a hiring probability (PRD §4.7, §7.7).
 */
export function CompletenessCard({ breakdown }: { breakdown: CompletenessBreakdown }) {
  const evidencePercent = Math.round(breakdown.evidenceScore * 100);
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-md p-5 sm:flex-row sm:gap-6">
      <ScoreRing value={breakdown.score} label="Complete" size={132} />
      <div className="min-w-0 text-center sm:text-left">
        <h2 className="text-base font-medium text-text">Workspace completeness</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {breakdown.coveredSections} of {breakdown.totalSections} sections have at least one
          item, and your evidence quality averages {evidencePercent}%.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          How this is calculated: 60% section coverage + 40% average evidence quality (Verified
          100%, User-attested 60%, Related 30%, Missing 0%). It measures how complete your
          workspace is — not your chances of being hired.
        </p>
      </div>
    </div>
  );
}
