"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageProgress } from "@/components/domain/stage-progress";
import { Panel } from "@/components/domain/panel";
import { ANALYSIS_STAGES, type AnalysisRun } from "@/lib/schemas";

/**
 * The analysis theatre (PRD §6.4, §7.4.4).
 *
 * The stages are real: the run advances on the server from elapsed time and
 * this component only renders what the run reports. A failed run says which
 * stage failed and offers a retry that starts a fresh run — never a stuck
 * spinner. Progress is also announced politely for screen readers.
 */
export function AnalysisTheatre({
  run,
  onRetry,
  retrying = false,
  role,
}: {
  run: AnalysisRun;
  onRetry: () => void;
  retrying?: boolean;
  role: string;
}) {
  const failed = run.status === "failed";

  return (
    <div data-testid="analysis-theatre">
      <Panel
        id="analysis-theatre"
        title={failed ? "The analysis stopped" : `Analysing “${role}”`}
        description={
          failed
            ? "Nothing from this run was saved. Retrying starts again from the first stage."
            : "Six stages, each one shown as it happens. You can leave this page — the run keeps going in your browser session."
        }
      >
        <StageProgress
          stages={ANALYSIS_STAGES}
          activeIndex={run.stageIndex}
          progress={run.progress}
          failedIndex={failed ? run.stageIndex : undefined}
          label="Analysis progress"
        />

        {failed && run.failure ? (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/[0.06] p-3"
          >
            <p className="text-sm text-text">{run.failure.message}</p>
            <p className="font-mono text-xs text-muted">
              stage: {run.failure.stage} · code: {run.failure.code}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={onRetry}
                disabled={retrying}
                aria-busy={retrying}
                data-testid="analysis-retry"
              >
                <RefreshCw
                  className={retrying ? "size-3.5 animate-spin" : "size-3.5"}
                  aria-hidden="true"
                />
                {retrying ? "Retrying…" : "Retry the analysis"}
              </Button>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-muted">
          Scores measure how well your own workspace answers this posting — never
          a probability of being hired, and never an ATS guarantee.
        </p>
      </Panel>
    </div>
  );
}
