"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, FileDiff, History, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/domain/error-state";
import { StaleBadge } from "@/components/domain/sync-indicator";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { useAnalysisReport, useTarget } from "@/features/targets/use-targets";
import type { WorkspaceItem } from "@/lib/schemas";
import { GenerateResumeCard } from "./generate-resume-card";
import { ResumeCanvas } from "./resume-canvas";
import { ResumeDiffDrawer } from "./resume-diff-drawer";
import { EvidenceSheet } from "./evidence-sheet";
import { ResumeSidePanel } from "./resume-side-panel";
import { useResume, useResumeList } from "./use-resume";

function StudioSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading resume studio">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * `/targets/[id]/resume`: the editable tailored-resume canvas. It resolves the
 * requested snapshot (or the newest one for the target) and shows the source
 * evidence, ATS checks, requirement coverage, stale diff and per-section
 * refresh next to the text.
 */
export function ResumeStudio({ targetId }: { targetId: string }) {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("resume");
  const target = useTarget(targetId);
  const list = useResumeList();
  const workspace = useWorkspace();
  const [diffOpen, setDiffOpen] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);

  const latestId = useMemo(() => {
    const matches = (list.data ?? [])
      .filter(
        (entry) => entry.kind === "tailored" && entry.targetId === targetId,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return matches[0]?.id ?? null;
  }, [list.data, targetId]);

  const resumeId = requestedId ?? latestId;
  const resume = useResume(resumeId);
  const report = useAnalysisReport(targetId, Boolean(target.data?.analysis));

  const items = workspace.data?.items ?? [];
  const evidenceItem = evidenceId
    ? items.find((item: WorkspaceItem) => item.id === evidenceId)
    : undefined;

  if (target.isLoading || list.isLoading) return <StudioSkeleton />;

  if (target.isError) {
    return (
      <ErrorState
        title="This job target could not load"
        description="The resume belongs to a target. Retry, or go back to all targets."
        onRetry={() => void target.refetch()}
        retrying={target.isFetching}
      />
    );
  }

  if (list.isError) {
    return (
      <ErrorState
        title="Your resumes could not load"
        description="Nothing was deleted. Retry to list the saved snapshots for this target."
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  }

  if (!target.data) {
    return (
      <ErrorState
        title="This job target no longer exists"
        description="It may have been removed. Open the targets list to pick another report."
        onRetry={() => void target.refetch()}
        retrying={target.isFetching}
      />
    );
  }

  const staleReport = Boolean(target.data.analysis?.stale);

  if (!resumeId) {
    return (
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <Link
            href={`/targets/${targetId}`}
            className="inline-flex w-fit items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-text hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to the report
          </Link>
          <h1 className="font-display text-3xl tracking-tight">
            Tailored resume
          </h1>
          <p className="text-sm text-muted">
            {target.data.role} at {target.data.company || "this company"}
          </p>
        </header>
        <GenerateResumeCard target={target.data} stale={staleReport} />
        {!target.data.analysis ? (
          <p className="glass rounded-md p-4 text-sm text-muted">
            Run the analysis first. A resume is generated from a finished report,
            not from the posting alone, so every line points at workspace evidence.
          </p>
        ) : null}
      </div>
    );
  }

  if (resume.isLoading) return <StudioSkeleton />;

  if (resume.isError || !resume.data) {
    return (
      <ErrorState
        title="This resume could not load"
        description="The snapshot may have been removed. Retry, or generate a new version from the report."
        onRetry={() => void resume.refetch()}
        retrying={resume.isFetching}
      />
    );
  }

  const data = resume.data;
  const needsReview = data.stale || data.removedEvidenceIds.length > 0;

  return (
    <div className="flex flex-col gap-5" data-testid="resume-studio">
      <header className="flex flex-col gap-3">
        <Link
          href={`/targets/${targetId}`}
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-text hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to the report
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl tracking-tight">
                {data.title || "Tailored resume"}
              </h1>
              {data.stale ? <StaleBadge /> : null}
              {data.aiUsed ? <Badge variant="outline">AI rewording used</Badge> : null}
            </div>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>{target.data.role}</span>
              <span aria-hidden="true">·</span>
              <span>{target.data.company || "No company"}</span>
              <span aria-hidden="true">·</span>
              <span>Workspace version {data.workspaceVersion}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {new Date(data.updatedAt).toLocaleString()}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {needsReview ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDiffOpen(true)}
                data-testid="open-diff"
              >
                <FileDiff className="size-4" aria-hidden="true" />
                Review changes
              </Button>
            ) : null}
            <Link
              href="/history"
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
            >
              <History className="size-3.5" aria-hidden="true" />
              History
            </Link>
          </div>
        </div>
      </header>

      {needsReview ? (
        <section
          className="glass flex flex-col gap-2 rounded-md border-l-2 border-evidence-related p-4 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="studio-stale-heading"
          data-testid={data.stale ? "resume-stale-banner" : "resume-removed-banner"}
        >
          <div>
            <h2 id="studio-stale-heading" className="text-sm font-medium text-text">
              {data.stale
                ? "This snapshot is stale"
                : "This snapshot still cites removed sources"}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {data.stale
                ? "The workspace changed after this resume was generated. Review the added, removed and edited source items, then refresh only the sections you choose. Hand-edited sections are never overwritten without confirmation."
                : "A refresh was skipped for a hand-edited section, so its removed lines stay visible and marked. Review the changes and explicitly overwrite that section when you are ready."}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setDiffOpen(true)}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Review and refresh
          </Button>
        </section>
      ) : null}

      {resume.isFetching ? (
        <p className="text-xs text-muted" role="status">
          Checking for workspace changes…
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <div className="glass mb-3 flex flex-col gap-1 rounded-md p-3 text-xs leading-relaxed text-muted">
            <p className="text-text">
              Edit wording here. The facts are locked to the cited evidence.
            </p>
            <p>
              A line that adds a metric, technology, employer, title or date the
              evidence does not contain is rejected with{" "}
              <code className="font-mono text-[11px] text-text">resume_claim_ungrounded</code>{" "}
              and your text stays in place. To change a fact, edit the workspace
              item instead.
            </p>
          </div>
          <ResumeCanvas
            resume={data}
            items={items}
            onOpenEvidence={(itemId) => setEvidenceId(itemId)}
          />
        </div>
        <ResumeSidePanel
          resume={data}
          report={report.data}
          items={items}
          onOpenEvidence={(itemId) => setEvidenceId(itemId)}
        />
      </div>

      <ResumeDiffDrawer
        resume={data}
        open={diffOpen}
        onOpenChange={setDiffOpen}
      />
      <EvidenceSheet
        open={Boolean(evidenceId)}
        onOpenChange={(open) => {
          if (!open) setEvidenceId(null);
        }}
        item={evidenceItem}
        itemId={evidenceId ?? undefined}
      />
    </div>
  );
}
