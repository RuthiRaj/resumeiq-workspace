"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Printer,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { SyncIndicator } from "@/components/domain/sync-indicator";
import { TEMPLATE_OPTIONS, TARGET_LENGTHS } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useStandardResume, useSyncStatus } from "@/features/workspace/use-workspace";
import {
  moveSectionKey,
  orderedSectionKeys,
  sectionLabel,
} from "./resume-preferences";
import { ResumePaper } from "./resume-paper";
import { useResumePreferences } from "./use-resume-preferences";

/** `/resume`: the live standard resume and its presentation controls. */
export function StandardResumePage() {
  const resume = useStandardResume();
  const sync = useSyncStatus();
  const {
    preferences,
    update,
    reset: resetPreferences,
  } = useResumePreferences();

  const keys = useMemo(
    () => (resume.data ? orderedSectionKeys(resume.data, preferences.order) : []),
    [preferences.order, resume.data],
  );

  if (resume.isLoading) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-80" />
        <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-[36rem] w-full" />
        </div>
      </div>
    );
  }

  if (resume.isError) {
    return (
      <ErrorState
        title="The standard resume could not load"
        description="It is derived from your workspace, so nothing was deleted. Retry to rebuild the preview."
        onRetry={() => void resume.refetch()}
        retrying={resume.isFetching}
      />
    );
  }

  const data = resume.data;
  if (!data) {
    return (
      <ErrorState
        title="The standard resume is unavailable"
        description="Retry to rebuild it from your workspace."
        onRetry={() => void resume.refetch()}
        retrying={resume.isFetching}
      />
    );
  }

  const empty = data.sections.every((section) => section.claims.length === 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">
              Live document
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              Standard resume
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              Generated from your current workspace on every read. Presentation
              choices here are local; the wording lives in your workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SyncIndicator syncing={sync.syncing} syncedAt={sync.syncedAt} />
            <Button
              variant="secondary"
              size="sm"
              className="no-print"
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" />
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </header>

      <div className="no-print glass flex flex-col gap-3 rounded-md p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-elevated">
            <FileText className="size-4 text-accent-cyan" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium text-text">
              Wording edits happen in the workspace
            </p>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted">
              This preview never invents or rewrites content. Edit an item, delete
              it or reorder it in the workspace, and this page updates on the next
              read. Tailored wording is edited in a target&apos;s resume studio.
            </p>
          </div>
        </div>
        <Link
          href="/workspace"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
        >
          Open workspace
        </Link>
      </div>

      {empty ? (
        <EmptyState
          icon={FileText}
          title="Your standard resume is empty"
          description="Add at least a personal-details item. Every line in the resume points back to an item you wrote, so there is nothing to preview yet."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/workspace/personal"
              className="inline-flex h-10 items-center justify-center rounded-sm bg-action px-4 text-sm font-medium text-white hover:brightness-110 focus-visible:outline-accent-cyan"
            >
              Add personal details
            </Link>
            <Link
              href="/workspace/import"
              className="glass inline-flex h-10 items-center justify-center rounded-sm px-4 text-sm font-medium text-text hover:bg-white/[0.09] focus-visible:outline-accent-cyan"
            >
              Import a document
            </Link>
          </div>
        </EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside
            className="no-print flex flex-col gap-4"
            aria-label="Resume presentation controls"
          >
            <section className="glass rounded-md p-4">
              <h2 className="text-sm font-medium text-text">Template</h2>
              <p className="mt-1 text-xs text-muted">
                Presentation only. The words and every fact stay the same.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-1" role="group" aria-label="Template">
                {TEMPLATE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={preferences.template === option.value}
                    onClick={() => update({ template: option.value })}
                    className={cn(
                      "rounded-sm border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-accent-cyan",
                      preferences.template === option.value
                        ? "border-accent-cyan/50 bg-accent-cyan/10 text-text"
                        : "border-white/[0.08] text-muted hover:bg-white/[0.06] hover:text-text",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="glass rounded-md p-4">
              <h2 className="text-sm font-medium text-text">Length</h2>
              <p className="mt-1 text-xs text-muted">
                Hidden lines are counted below the preview, never silently
                dropped.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-1" role="group" aria-label="Length">
                {TARGET_LENGTHS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={preferences.length === value}
                    onClick={() => update({ length: value })}
                    className={cn(
                      "rounded-sm border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-accent-cyan",
                      preferences.length === value
                        ? "border-accent-cyan/50 bg-accent-cyan/10 text-text"
                        : "border-white/[0.08] text-muted hover:bg-white/[0.06] hover:text-text",
                    )}
                  >
                    {value === "one_page" ? "One page" : "Two pages"}
                  </button>
                ))}
              </div>
            </section>

            <section className="glass rounded-md p-4">
              <h2 className="text-sm font-medium text-text">Section order</h2>
              <p className="mt-1 text-xs text-muted">
                Move sections or hide them from this preview. Unchecking a
                section does not delete its workspace items.
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {keys.map((key, index) => {
                  const visible = !preferences.hidden.includes(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-2 rounded-sm border border-white/[0.06] px-2 py-1.5"
                    >
                      <Checkbox
                        id={`resume-visible-${key}`}
                        checked={visible}
                        onCheckedChange={(checked) =>
                          update({
                            hidden: checked
                              ? preferences.hidden.filter((value) => value !== key)
                              : [...preferences.hidden, key],
                          })
                        }
                      />
                      <Label
                        htmlFor={`resume-visible-${key}`}
                        className="min-w-0 flex-1 truncate text-xs font-normal"
                      >
                        {sectionLabel(key)}
                      </Label>
                      <div className="flex shrink-0 gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 px-0"
                          aria-label={`Move ${sectionLabel(key)} up`}
                          disabled={index === 0}
                          onClick={() =>
                            update({
                              order: moveSectionKey(preferences.order, key, -1),
                            })
                          }
                        >
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 px-0"
                          aria-label={`Move ${sectionLabel(key)} down`}
                          disabled={index === keys.length - 1}
                          onClick={() =>
                            update({
                              order: moveSectionKey(preferences.order, key, 1),
                            })
                          }
                        >
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-violet" aria-hidden="true" />
              PDF export uses the browser print dialog and this page&apos;s print
              stylesheet. App chrome is hidden automatically.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => {
                resetPreferences();
                void resume.refetch();
              }}
              disabled={resume.isFetching}
            >
              <RefreshCw
                className={cn("size-4", resume.isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Reset presentation
            </Button>
          </aside>

          <div className="min-w-0">
            <ResumePaper
              resume={data}
              template={preferences.template}
              length={preferences.length}
              order={preferences.order}
              hidden={preferences.hidden}
            />
          </div>
        </div>
      )}

      {resume.isFetching && !resume.isLoading ? (
        <p className="no-print text-xs text-muted" role="status">
          Rebuilding the preview from the latest workspace…
        </p>
      ) : null}
    </div>
  );
}
