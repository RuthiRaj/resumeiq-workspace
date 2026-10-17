"use client";

import { useMemo } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import type { WorkspaceChangeLogEntry } from "@/lib/schemas";
import { describeChange, formatRelativeTime } from "./workspace-utils";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const OP_COLOR: Record<WorkspaceChangeLogEntry["op"], string> = {
  add: "bg-evidence-verified",
  edit: "bg-evidence-attested",
  delete: "bg-evidence-missing",
  reorder: "bg-evidence-related",
  restore: "bg-evidence-verified",
};

/** Recent workspace changes, newest first (PRD §6.1 WS-4, §7.5). */
export function RecentChanges({
  entries,
  isLoading,
  isError,
  onRetry,
}: {
  entries: WorkspaceChangeLogEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const now = useMemo(() => new Date().toISOString(), []);

  return (
    <section aria-labelledby="recent-changes" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="recent-changes" className="text-base font-medium text-text">
          Recent changes
        </h2>
        <Link href="/history" className="text-xs text-muted hover:text-text">
          View history
        </Link>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading recent changes">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Couldn’t load recent changes"
          description="The change log didn’t load. Your workspace itself is unaffected."
          onRetry={onRetry}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="No changes yet"
          description="As you add, edit, reorder or delete workspace items, every change appears here with its version."
        />
      ) : (
        <ol className="glass flex flex-col gap-1 rounded-md p-2" data-testid="recent-changes-list">
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.seq} className="flex items-center gap-3 rounded-sm px-2 py-1.5">
              <span
                aria-hidden="true"
                className={cn("size-2 shrink-0 rounded-full", OP_COLOR[entry.op])}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-text">
                {describeChange(entry)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted">
                v{entry.workspaceVersion}
              </span>
              <time dateTime={entry.at} className="shrink-0 text-[11px] text-muted">
                {formatRelativeTime(entry.at, now)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
