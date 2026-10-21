"use client";

import { useEffect, useRef, useState } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { ApiError } from "@/lib/api";
import { AnalysisTheatre } from "./analysis-theatre";
import { ConsentGate } from "./consent-gate";
import { ReportView } from "./report-view";
import {
  POLL_FAILURES_BEFORE_NOTICE,
  useAnalysisReport,
  useAnalysisRun,
  useStartAnalysis,
  useTarget,
} from "./use-targets";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { hasAiConsent, useConsent, useRecordConsent } from "@/lib/privacy/use-consent";

/**
 * `/targets/[id]` — the consent gate, the analysis theatre and the finished
 * report in one place, chosen by state (PRD §6.4, §6.9 EX-3).
 *
 * 1. Consent missing or declined → the gate stands in for the analysis.
 * 2. No report yet (or one was just re-run) → the theatre, driven by the run.
 * 3. A report exists → the report, with a staleness warning when the workspace
 *    has moved on.
 */
export function TargetAnalysis({ targetId }: { targetId: string }) {
  const targetQuery = useTarget(targetId);
  const consentQuery = useConsent();
  const recordConsent = useRecordConsent();
  const start = useStartAnalysis(targetId);

  const [runEnabled, setRunEnabled] = useState(false);
  const runQuery = useAnalysisRun(targetId, runEnabled);
  const startedRef = useRef(false);

  const consentGranted = hasAiConsent(consentQuery.data?.consent);
  const run = runQuery.data?.run ?? null;
  const running = run?.status === "running";
  const failed = run?.status === "failed";
  const freshReport = runQuery.data?.report ?? null;

  // A saved analysis means there is something to show, so fetching the report
  // is worth it even before any run happens in this session.
  const hasSavedAnalysis = Boolean(targetQuery.data?.analysis);
  const reportQuery = useAnalysisReport(
    targetId,
    (hasSavedAnalysis || Boolean(freshReport)) && !running && !failed,
  );
  const report = freshReport ?? reportQuery.data ?? null;

  const workspace = useWorkspace();

  function beginRun() {
    start.mutate(undefined, {
      onSuccess: () => setRunEnabled(true),
    });
  }

  // Start the first analysis automatically once consent allows it. Guarded by a
  // ref so React's development double-mount can't start two runs.
  useEffect(() => {
    if (startedRef.current) return;
    if (!consentGranted) return;
    if (!targetQuery.data) return;
    if (targetQuery.data.analysis) return;
    startedRef.current = true;
    beginRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentGranted, targetQuery.data]);

  const target = targetQuery.data;
  const items = workspace.data?.items ?? [];

  if (!target) {
    if (targetQuery.isError) {
      const notFound =
        targetQuery.error instanceof ApiError && targetQuery.error.status === 404;
      // A missing target and an unreachable one are different problems, and the
      // copy has to say which one happened.
      return (
        <div className="py-8">
          {notFound ? (
            <EmptyState
              icon={Target}
              title="We couldn't find that job target"
              description="It may have been removed, or the link may be from a different workspace. Your other targets are all still here."
            >
              <LinkButton href="/targets" size="sm" variant="secondary">
                Back to job targets
              </LinkButton>
              <LinkButton href="/targets/new" size="sm" variant="secondary">
                Add a new target
              </LinkButton>
            </EmptyState>
          ) : (
            <ErrorState
              title="We couldn't open that job target"
              description={targetQuery.error.message}
              onRetry={() => void targetQuery.refetch()}
              retrying={targetQuery.isFetching}
            />
          )}
        </div>
      );
    }
    return (
      <div
        role="status"
        className="flex flex-col gap-3 py-8"
        aria-busy="true"
        aria-label="Loading target"
      >
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
          Job target
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          {target.role}
        </h1>
        {target.company ? (
          <p className="text-sm text-muted">{target.company}</p>
        ) : null}
      </header>

      {consentQuery.isLoading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Checking your AI-processing consent"
          data-testid="consent-loading"
          className="flex flex-col gap-2"
        >
          <p className="text-sm text-muted">Checking your AI-processing consent…</p>
          <Skeleton className="h-20 w-full" />
        </div>
      ) : consentQuery.isError ? (
        <ErrorState
          title="We couldn’t check your AI-processing consent"
          description="Nothing has been analysed. Check your connection and try again."
          onRetry={() => void consentQuery.refetch()}
          retrying={consentQuery.isFetching}
        />
      ) : !consentGranted ? (
        <div className="flex flex-col gap-4">
          <ConsentGate
            busy={recordConsent.isPending}
            error={recordConsent.isError ? recordConsent.error.message : null}
            onRecord={(accepted) => {
              recordConsent.mutate(accepted);
            }}
          />
          {consentQuery.data?.consent && !consentQuery.data.consent.aiProcessing ? (
            <p className="text-xs text-muted" data-testid="consent-declined">
              You&apos;ve declined AI processing, so this target has no report
              yet. Nothing is calculated until you change that.
            </p>
          ) : null}
        </div>
      ) : running || failed ? (
        <div className="flex flex-col gap-4">
          {runQuery.isError &&
          runQuery.failureCount >= POLL_FAILURES_BEFORE_NOTICE ? (
            <div
              role="status"
              data-testid="analysis-poll-error"
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border-l-2 border-evidence-attested bg-evidence-attested/[0.06] p-3"
            >
              <p className="text-sm text-text">
                We&apos;ve lost the connection to the analysis. The last known
                progress is below and it keeps retrying in the background.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void runQuery.refetch()}
                disabled={runQuery.isFetching}
                aria-busy={runQuery.isFetching}
              >
                {runQuery.isFetching ? "Checking…" : "Check again"}
              </Button>
            </div>
          ) : null}
          {run ? (
            <AnalysisTheatre
              run={run}
              role={target.role}
              retrying={start.isPending}
              onRetry={beginRun}
            />
          ) : (
            <Skeleton className="h-72 w-full" />
          )}
        </div>
      ) : report ? (
        <ReportView
          target={target}
          report={report}
          items={items}
          rerunning={start.isPending}
          stale={Boolean(target.analysis?.stale)}
          onRerun={beginRun}
        />
      ) : reportQuery.isError ? (
        <ErrorState
          title="We couldn't load the report for this target"
          description={reportQuery.error.message}
          onRetry={() => void reportQuery.refetch()}
          retrying={reportQuery.isFetching}
        />
      ) : (
        <div
          role="status"
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Starting analysis"
        >
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-72 w-full" />
        </div>
      )}

      {start.isError ? (
        <ErrorState
          title="The analysis couldn't start"
          description={start.error.message}
          onRetry={beginRun}
          retrying={start.isPending}
        />
      ) : null}
    </div>
  );
}
