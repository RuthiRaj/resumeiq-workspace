"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  FileClock,
  FileText,
  History,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { StaleBadge } from "@/components/domain/sync-indicator";
import { toast } from "@/features/ui/toast-store";
import { apiErrorMessage } from "@/lib/api";
import type { ResumeSummary, ResumeVersion } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useTargets } from "@/features/targets/use-targets";
import { useWorkspace } from "@/features/workspace/use-workspace";
import {
  useResumeList,
  useResumeVersions,
  useRestoreResumeVersion,
} from "./use-resume";

const REASON_LABEL: Record<ResumeVersion["reason"], string> = {
  generated: "Generated",
  edited: "Hand edit saved",
  restored: "Restored from an earlier version",
  refreshed: "Refreshed from the workspace",
  purged: "Purged (removed sources dropped)",
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function ResumeCard({
  resume,
  selected,
  removedCount,
  targetLabel,
  onSelect,
}: {
  resume: ResumeSummary;
  selected: boolean;
  removedCount: number;
  targetLabel?: string;
  onSelect: () => void;
}) {
  return (
    <article
      className={cn(
        "glass flex flex-col gap-3 rounded-md p-4 transition-colors",
        selected && "border-accent-cyan/40 bg-white/[0.04]",
      )}
      data-testid={`history-resume-${resume.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-text">
              {resume.title || "Tailored resume"}
            </h3>
            {resume.stale ? <StaleBadge /> : null}
            {resume.aiUsed ? <Badge variant="outline">AI used</Badge> : null}
          </div>
          <p className="mt-1 text-xs text-muted">
            {targetLabel ? <>{targetLabel} · </> : null}
            Snapshot of workspace v{resume.workspaceVersion} · {formatDate(resume.updatedAt)}
          </p>
        </div>
        <Badge variant="outline">{resume.editedSections.length} edited</Badge>
      </div>

      {removedCount > 0 ? (
        <p
          className="flex items-start gap-1.5 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-2 text-[11px] leading-relaxed text-text"
          data-testid="removed-information-warning"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-evidence-missing" aria-hidden="true" />
          Contains {removedCount} removed source item{removedCount === 1 ? "" : "s"}.
          Those lines stay visible and marked until you edit or refresh the section.
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          Every cited source item still exists in the workspace.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/targets/${resume.targetId}/resume?resume=${resume.id}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
        >
          Open studio
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        <Button
          variant={selected ? "primary" : "secondary"}
          size="sm"
          onClick={onSelect}
          aria-pressed={selected}
        >
          <History className="size-3.5" aria-hidden="true" />
          {selected ? "Showing versions" : "Version history"}
        </Button>
      </div>
    </article>
  );
}

/**
 * `/history`: the live standard resume versus saved tailored snapshots, with
 * non-destructive restore. Deleted-source warnings come straight from
 * `ResumeSummary.removedEvidenceIds` and `ResumeVersion.removedEvidenceIds`
 * (B6), so no per-snapshot detail requests are needed. Delete/purge controls
 * belong to F6; this page states that instead of rendering dead buttons
 * (ADR-045).
 */
export function ResumeHistoryPage() {
  const list = useResumeList();
  const targets = useTargets();
  const workspace = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const tailored = useMemo(
    () => (list.data ?? []).filter((resume) => resume.kind === "tailored"),
    [list.data],
  );

  const selected =
    tailored.find((resume) => resume.id === selectedId) ?? tailored[0] ?? null;
  const versions = useResumeVersions(selected?.id, Boolean(selected));
  const restore = useRestoreResumeVersion(selected?.id ?? "");
  const targetById = new Map((targets.data ?? []).map((target) => [target.id, target]));

  if (list.isLoading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (list.isError) {
    return (
      <ErrorState
        title="Resume history could not load"
        description="Nothing was deleted. Retry to list the standard resume and every saved snapshot."
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  }

  const standard = (list.data ?? []).find((resume) => resume.kind === "standard");
  const selectedRemoved = selected?.removedEvidenceIds.length ?? 0;
  const restoreError = restore.error
    ? apiErrorMessage(
        restore.error,
        "The version could not be restored. Your current resume is unchanged.",
      )
    : null;

  return (
    <div className="flex flex-col gap-5" data-testid="resume-history">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">
          Snapshot library
        </p>
        <h1 className="font-display text-3xl tracking-tight">History</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          The standard resume is always current. Tailored resumes are saved
          snapshots of a finished analysis; they do not change when the workspace
          changes, and they tell you when they are stale.
        </p>
      </header>

      <section
        className="glass flex flex-col gap-3 rounded-md border-l-2 border-accent-cyan/60 p-4 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="history-standard-heading"
      >
        <div className="flex gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-elevated">
            <FileText className="size-4 text-accent-cyan" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="history-standard-heading" className="text-sm font-medium text-text">
                Standard resume
              </h2>
              <Badge variant="verified">Always current</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Derived from the workspace on every read. Workspace version{" "}
              <span className="font-mono tabular-nums text-text">
                {standard?.workspaceVersion ?? workspace.data?.version ?? "…"}
              </span>
              . This is not a saved application version.
            </p>
          </div>
        </div>
        <Link
          href="/resume"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
        >
          Open standard resume
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </section>

      {tailored.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No tailored resumes saved yet"
          description="Open a finished analysis report and choose “Generate tailored resume”. The snapshot appears here with its full version history."
        >
          <Link
            href="/targets"
            className="inline-flex h-10 items-center justify-center rounded-sm bg-action px-4 text-sm font-medium text-white hover:brightness-110 focus-visible:outline-accent-cyan"
          >
            Browse job targets
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-labelledby="saved-resumes-heading">
            <div className="flex items-center gap-2">
              <Archive className="size-4 text-accent-cyan" aria-hidden="true" />
              <h2 id="saved-resumes-heading" className="text-sm font-medium text-text">
                Saved tailored resumes
              </h2>
              <Badge variant="outline">{tailored.length}</Badge>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {tailored.map((resume) => {
                const target = resume.targetId ? targetById.get(resume.targetId) : null;
                return (
                  <ResumeCard
                    key={resume.id}
                    resume={resume}
                    selected={selected?.id === resume.id}
                    removedCount={resume.removedEvidenceIds.length}
                    targetLabel={
                      target
                        ? `${target.role}${target.company ? ` · ${target.company}` : ""}`
                        : undefined
                    }
                    onSelect={() => setSelectedId(resume.id)}
                  />
                );
              })}
            </div>
          </section>

          <aside
            className="glass flex h-fit flex-col gap-3 rounded-md p-4 lg:sticky lg:top-4"
            aria-labelledby="version-history-heading"
          >
            <div className="flex items-center gap-2">
              <FileClock className="size-4 text-accent-cyan" aria-hidden="true" />
              <h2 id="version-history-heading" className="text-sm font-medium text-text">
                Version history
              </h2>
              {selected ? (
                <Badge variant="outline">
                  {versions.data?.length ?? "…"} saved
                </Badge>
              ) : null}
            </div>
            {selected ? (
              <>
                <p className="text-xs leading-relaxed text-muted">
                  {selected.title || "Tailored resume"} · workspace v
                  {selected.workspaceVersion}
                </p>
                {selectedRemoved > 0 ? (
                  <p
                    className="flex items-start gap-1.5 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-2.5 text-[11px] leading-relaxed text-text"
                    data-testid="selected-removed-warning"
                  >
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-evidence-missing"
                      aria-hidden="true"
                    />
                    This snapshot contains {selectedRemoved} item
                    {selectedRemoved === 1 ? "" : "s"} you have since removed. The
                    lines are still here; refresh the affected sections when you
                    want them rebuilt.
                  </p>
                ) : null}

                {restoreError ? (
                  <p
                    role="alert"
                    className="rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-2.5 text-xs leading-relaxed text-text"
                  >
                    {restoreError}
                  </p>
                ) : null}

                {versions.isLoading ? (
                  <div className="flex flex-col gap-2" role="status" aria-busy="true">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : versions.isError ? (
                  <ErrorState
                    title="Versions could not load"
                    description="The saved snapshot is unchanged. Retry to read its history."
                    onRetry={() => void versions.refetch()}
                    retrying={versions.isFetching}
                  />
                ) : (versions.data?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted">No versions were recorded.</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {versions.data?.map((version) => (
                      <li
                        key={version.id}
                        className="rounded-sm border border-white/[0.06] p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-text">
                              {REASON_LABEL[version.reason]}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted">
                              {formatDate(version.createdAt)} · workspace v
                              {version.workspaceVersion}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted">
                              {version.sections.length} sections ·{" "}
                              {version.editedSections.length} hand-edited
                              {version.aiUsed ? " · AI rewording" : ""}
                            </p>
                            {version.stale || version.removedEvidenceIds.length > 0 ? (
                              <p
                                className="mt-1 flex items-start gap-1 text-[11px] text-evidence-missing"
                                data-testid={`version-warning-${version.id}`}
                              >
                                <AlertTriangle
                                  className="mt-0.5 size-3 shrink-0"
                                  aria-hidden="true"
                                />
                                {version.stale ? "Older workspace version" : null}
                                {version.stale && version.removedEvidenceIds.length > 0
                                  ? " · "
                                  : null}
                                {version.removedEvidenceIds.length > 0
                                  ? `${version.removedEvidenceIds.length} cited item${
                                      version.removedEvidenceIds.length === 1 ? "" : "s"
                                    } removed`
                                  : null}
                              </p>
                            ) : null}
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="shrink-0"
                            onClick={() =>
                              restore.mutate(version.id, {
                                onSuccess: () => {
                                  toast({
                                    tone: "success",
                                    title: "Version restored",
                                    description:
                                      "The old snapshot was copied forward as a new version. The earlier history is still intact.",
                                  });
                                },
                              })
                            }
                            disabled={restore.isPending}
                            data-testid={`restore-version-${version.id}`}
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            {restore.isPending ? "Restoring…" : "Restore"}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                <p className="flex items-start gap-1.5 border-t border-white/[0.08] pt-2 text-[11px] leading-relaxed text-muted">
                  <RefreshCw className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  Restore is non-destructive: it copies an old snapshot forward
                  and adds a new version. It never deletes the versions in between.
                </p>
                <p className="rounded-sm border border-white/[0.06] p-2 text-[11px] leading-relaxed text-muted">
                  Deleting a snapshot or purging removed information is coming in
                  F6. The API already supports it; these controls are deliberately
                  not rendered until that screen ships, so nothing here is a dead
                  button. Snapshots stay insert-only until then.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted">
                Select a saved resume to see its versions.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
