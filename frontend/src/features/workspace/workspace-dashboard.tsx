"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  FileUp,
  LayoutDashboard,
  Plus,
} from "lucide-react";
import type { WorkspaceItem, WorkspaceSection } from "@/lib/schemas";
import {
  WORKSPACE_SECTIONS,
} from "./sections";
import { EVIDENCE_META, EVIDENCE_ORDER } from "./evidence";
import {
  computeCompleteness,
  evidenceCounts,
} from "./workspace-utils";
import { useChangeLog, useSyncStatus, useWorkspace } from "./use-workspace";
import { CompletenessCard } from "./completeness-card";
import { RecentChanges } from "./recent-changes";
import { ItemEditorSheet } from "./item-editor-sheet";
import { WorkspaceDevBar } from "./dev-bar";
import { SectionCard } from "@/components/domain/section-card";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { SyncIndicator } from "@/components/domain/sync-indicator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading workspace">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * `/workspace` dashboard (PRD §6.1, §7.5, §7.4.3): completeness ring, section
 * cards with evidence-state glows, quick-add actions, a live "Synced"
 * indicator and the recent change list — with designed loading, error and
 * brand-new-workspace empty states.
 */
export function WorkspaceDashboard() {
  const workspace = useWorkspace();
  const changelog = useChangeLog();
  const sync = useSyncStatus();
  const [quickSection, setQuickSection] = useState<WorkspaceSection | null>(null);

  const items: WorkspaceItem[] = workspace.data?.items ?? [];
  const completeness = computeCompleteness(items);
  const evidence = evidenceCounts(items);

  function openQuickAdd(section: WorkspaceSection) {
    setQuickSection(section);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Your workspace</h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted">
            Everything you can truthfully claim, in one private place. Your standard resume stays in
            sync as you change it.
          </p>
          <div className="mt-2">
            <SyncIndicator syncing={sync.syncing} syncedAt={sync.syncedAt} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-haspopup="menu">
                <Plus className="size-4" aria-hidden="true" /> Quick add
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Add to a section</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {WORKSPACE_SECTIONS.map((meta) => (
                <DropdownMenuItem key={meta.key} onSelect={() => openQuickAdd(meta.key)}>
                  <span className="flex items-center gap-2">
                    <meta.icon className="size-4 text-muted" aria-hidden="true" />
                    Add to {meta.label}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href="/workspace/import">
            <Button variant="secondary">
              <FileUp className="size-4" aria-hidden="true" /> Import documents
            </Button>
          </Link>
        </div>
      </div>

      <WorkspaceDevBar />

      {workspace.isLoading ? (
        <DashboardSkeleton />
      ) : workspace.isError ? (
        <ErrorState
          title="Couldn’t load your workspace"
          description="The workspace didn’t respond. Nothing was lost — try again, or check the mock failure toggle in the dev bar."
          onRetry={() => void workspace.refetch()}
          retrying={workspace.isFetching}
        />
      ) : (
        <>
          {items.length === 0 ? (
            <EmptyState
              icon={LayoutDashboard}
              title="Your workspace is empty — let’s start it right"
              description="Add your first item, or import a document and review what’s found. Nothing is invented: every item carries an evidence state, and you confirm each one."
            >
              <Button onClick={() => openQuickAdd("education")}>
                <Plus className="size-4" aria-hidden="true" /> Add education
              </Button>
              <Button variant="secondary" onClick={() => openQuickAdd("experience")}>
                Add experience
              </Button>
              <Button variant="secondary" onClick={() => openQuickAdd("project")}>
                Add project
              </Button>
              <Link href="/workspace/import">
                <Button variant="ghost">
                  <FileUp className="size-4" aria-hidden="true" /> Import a document
                </Button>
              </Link>
            </EmptyState>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <CompletenessCard breakdown={completeness} />
                <div className="glass grid grid-cols-2 gap-4 rounded-md p-5">
                  <div>
                    <p className="font-mono text-2xl text-text">{items.length}</p>
                    <p className="text-xs text-muted">items</p>
                  </div>
                  <div>
                    <p className="font-mono text-2xl text-text">v{workspace.data?.version ?? 0}</p>
                    <p className="text-xs text-muted">workspace version</p>
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-1">
                    {EVIDENCE_ORDER.map((state) => (
                      <span key={state} className="flex items-center gap-1.5 text-xs text-muted">
                        <span
                          aria-hidden="true"
                          className={`size-2 rounded-full ${EVIDENCE_META[state].dot}`}
                        />
                        <span className={EVIDENCE_META[state].text}>{evidence[state]}</span>
                        <span>{EVIDENCE_META[state].label.toLowerCase()}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          <section aria-labelledby="all-sections" className="flex flex-col gap-3">
            <h2 id="all-sections" className="text-base font-medium text-text">
              All sections
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {WORKSPACE_SECTIONS.map((meta) => (
                <SectionCard
                  key={meta.key}
                  meta={meta}
                  items={items.filter((item) => !item.deletedAt && item.section === meta.key)}
                />
              ))}
            </div>
          </section>

          <RecentChanges
            entries={changelog.data ?? []}
            isLoading={changelog.isLoading}
            isError={changelog.isError}
            onRetry={() => void changelog.refetch()}
          />
        </>
      )}

      <ItemEditorSheet
        section={quickSection ?? "education"}
        item={null}
        open={quickSection !== null}
        onOpenChange={(next) => {
          if (!next) setQuickSection(null);
        }}
      />
    </div>
  );
}
