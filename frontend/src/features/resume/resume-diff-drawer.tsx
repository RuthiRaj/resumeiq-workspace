"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FileDiff,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/features/ui/toast-store";
import { apiErrorMessage, ApiError } from "@/lib/api";
import type { Resume, ResumeDiff } from "@/lib/schemas";
import { sectionLabel } from "./resume-preferences";
import { useRefreshResume, useResumeDiff } from "./use-resume";

function DiffList({
  title,
  entries,
  icon: Icon,
  tone,
}: {
  title: string;
  entries: ResumeDiff["added"];
  icon: typeof ArrowUpRight;
  tone: "verified" | "missing" | "related";
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden="true" />
        <p className="text-xs font-medium text-text">
          {title} <span className="text-muted">({entries.length})</span>
        </p>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.itemId} className="flex items-start gap-2 text-xs text-muted">
            <Badge variant={tone} className="shrink-0">
              {sectionLabel(entry.section)}
            </Badge>
            <span className="min-w-0 break-words text-text">{entry.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Stale-diff drawer (B5 §6.6). It distinguishes new, removed and edited source
 * items and offers a per-section refresh. A hand-edited section is never
 * overwritten by one click: choosing it opens an explicit confirmation.
 */
export function ResumeDiffDrawer({
  resume,
  open,
  onOpenChange,
}: {
  resume: Resume;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const diff = useResumeDiff(resume.id, open || resume.stale);
  const refresh = useRefreshResume(resume.id);
  const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    refreshed: string[];
    skipped: string[];
  } | null>(null);

  function runRefresh(sections: string[], overwrite: string[]) {
    refresh.mutate(
      { sections, overwriteEditedSections: overwrite, rewordWithAi: false },
      {
        onSuccess: (result) => {
          setPendingOverwrite(null);
          setLastResult({
            refreshed: result.refreshedSections,
            skipped: result.skippedSections.map((entry) => entry.section),
          });
          const skipped = result.skippedSections;
          toast({
            tone: "success",
            title:
              result.refreshedSections.length === 0
                ? "Nothing was replaced"
                : `Refreshed ${result.refreshedSections.length} section${
                    result.refreshedSections.length === 1 ? "" : "s"
                  }`,
            description:
              skipped.length > 0
                ? `Skipped ${skipped
                    .map((entry) => sectionLabel(entry.section))
                    .join(", ")} because ${
                    skipped.length === 1 ? "it is" : "they are"
                  } hand-edited. Their removed lines stay visible.`
                : "The snapshot now matches the current workspace version.",
          });
        },
      },
    );
  }

  function chooseSection(section: string) {
    if (resume.editedSections.includes(section)) {
      setPendingOverwrite(section);
      return;
    }
    runRefresh([section], []);
  }

  const data = diff.data;
  const errorText =
    refresh.error || diff.error
      ? apiErrorMessage(
          refresh.error ?? diff.error,
          "The diff or refresh could not load. Retry in a moment.",
        )
      : null;
  const errorCode =
    (refresh.error instanceof ApiError && refresh.error.code) ||
    (diff.error instanceof ApiError && diff.error.code) ||
    undefined;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          className="sm:w-[30rem]"
          data-testid="resume-diff-drawer"
          aria-describedby={undefined}
        >
          <SheetHeader>
            <SheetTitle>Changes since this snapshot</SheetTitle>
            <SheetDescription>
              A snapshot does not change by itself. Refresh the sections you want
              to rebuild from workspace version{" "}
              {data?.currentWorkspaceVersion ?? "…"}.
            </SheetDescription>
          </SheetHeader>

          {diff.isLoading ? (
            <div className="mt-5 flex flex-col gap-2" role="status" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : diff.isError ? (
            <div className="mt-5 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-3">
              <p className="text-sm text-text">The diff could not load</p>
              <p className="mt-1 text-xs text-muted">{errorText}</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => void diff.refetch()}
                disabled={diff.isFetching}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Retry
              </Button>
            </div>
          ) : data ? (
            <div className="mt-5 flex flex-col gap-4">
              {errorText ? (
                <div
                  role="alert"
                  className="rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-3 text-xs leading-relaxed text-text"
                >
                  <p>{errorText}</p>
                  {errorCode ? (
                    <p className="mt-1 font-mono text-[11px] text-muted">{errorCode}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Added", data.added.length, "text-evidence-verified"],
                    ["Removed", data.removed.length, "text-evidence-missing"],
                    ["Edited", data.edited.length, "text-evidence-related"],
                  ] as const
                ).map(([label, count, tone]) => (
                  <div
                    key={label}
                    className="rounded-sm border border-white/[0.08] bg-elevated/40 p-2 text-center"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
                    <p className={`mt-0.5 text-lg tabular-nums ${tone}`}>{count}</p>
                  </div>
                ))}
              </div>

              {data.changedSections.length === 0 ? (
                <div className="rounded-sm border border-white/[0.08] p-3">
                  <p className="flex items-center gap-1.5 text-sm text-text">
                    <FileDiff className="size-4 text-evidence-verified" aria-hidden="true" />
                    No source changes
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    The workspace matches this snapshot. A refresh would not change
                    any cited item.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <DiffList
                    title="New workspace items"
                    entries={data.added}
                    icon={ArrowUpRight}
                    tone="verified"
                  />
                  <DiffList
                    title="Removed source items"
                    entries={data.removed}
                    icon={ArrowDownRight}
                    tone="missing"
                  />
                  <DiffList
                    title="Edited source items"
                    entries={data.edited}
                    icon={Pencil}
                    tone="related"
                  />
                </div>
              )}

              {data.changedSections.length > 0 ? (
                <section aria-labelledby="diff-refresh-heading">
                  <h3
                    id="diff-refresh-heading"
                    className="text-sm font-medium text-text"
                  >
                    Refresh per section
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Hand-edited sections are skipped. Choosing one opens a
                    confirmation before its text is replaced.
                  </p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {data.changedSections.map((section) => {
                      const edited = resume.editedSections.includes(section);
                      return (
                        <li
                          key={section}
                          className="flex items-center justify-between gap-2 rounded-sm border border-white/[0.06] p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-text">
                              {sectionLabel(section)}
                            </p>
                            {edited ? (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-evidence-related">
                                <Pencil className="size-3" aria-hidden="true" />
                                Hand-edited: refresh will skip it by default
                              </p>
                            ) : (
                              <p className="mt-0.5 text-[11px] text-muted">
                                No hand edits in this section
                              </p>
                            )}
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => chooseSection(section)}
                            disabled={refresh.isPending}
                            data-testid={`refresh-section-${section}`}
                          >
                            {refresh.isPending ? "Refreshing…" : edited ? "Overwrite…" : "Refresh"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => runRefresh([], [])}
                    disabled={refresh.isPending}
                    data-testid="refresh-all"
                  >
                    <RefreshCw
                      className={refresh.isPending ? "size-3.5 animate-spin" : "size-3.5"}
                      aria-hidden="true"
                    />
                    {refresh.isPending ? "Refreshing…" : "Refresh all unedited sections"}
                  </Button>
                </section>
              ) : null}

              {lastResult ? (
                <div
                  className="rounded-sm border border-white/[0.08] bg-elevated/40 p-3 text-xs leading-relaxed text-muted"
                  role="status"
                  data-testid="refresh-result"
                >
                  <p className="text-text">
                    {lastResult.refreshed.length > 0
                      ? `Refreshed: ${lastResult.refreshed
                          .map(sectionLabel)
                          .join(", ")}.`
                      : "No section was replaced."}
                  </p>
                  {lastResult.skipped.length > 0 ? (
                    <p className="mt-1 flex items-start gap-1.5">
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0 text-evidence-related"
                        aria-hidden="true"
                      />
                      Skipped {lastResult.skipped.map(sectionLabel).join(", ")}. Any
                      removed lines in those sections remain visible and marked.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(pendingOverwrite)}
        onOpenChange={(next) => {
          if (!next) setPendingOverwrite(null);
        }}
      >
        <DialogContent data-testid="overwrite-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              Overwrite the hand-edited {pendingOverwrite ? sectionLabel(pendingOverwrite) : ""}{" "}
              section?
            </DialogTitle>
            <DialogDescription>
              Refreshing rebuilds this section from the current workspace and
              replaces your edits. A new immutable version records the change, so
              you can restore the earlier version from History.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setPendingOverwrite(null)}
              disabled={refresh.isPending}
            >
              Keep my edits
            </Button>
            <Button
              onClick={() =>
                pendingOverwrite && runRefresh([pendingOverwrite], [pendingOverwrite])
              }
              disabled={refresh.isPending}
              data-testid="confirm-overwrite"
            >
              {refresh.isPending ? "Refreshing…" : "Overwrite section"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
