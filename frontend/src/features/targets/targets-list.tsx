"use client";

import Link from "next/link";
import { Clock3, FlaskConical, Plus, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { GlassCard } from "@/components/domain/glass-card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/features/ui/toast-store";
import { useSampleTargets, useTargets } from "./use-targets";
import type { JobTarget } from "@/lib/schemas";

/**
 * `/targets` — the saved job targets and their latest match score (PRD §6.4).
 * A stale score is labelled as stale; a target that has never been analysed says
 * so instead of showing a placeholder number.
 */
export function TargetsList() {
  const targetsQuery = useTargets();
  const sampleTargets = useSampleTargets();

  const targets = targetsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
            Job targets
          </p>
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
            Jobs you&apos;re aiming at
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted">
            Each target keeps the job description you pasted and the report we
            built against your workspace. Scores never change on their own — a
            report is only replaced when you re-run it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {process.env.NODE_ENV === "development" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={sampleTargets.isPending}
              aria-busy={sampleTargets.isPending}
              data-testid="load-sample-targets"
              onClick={() =>
                sampleTargets.mutate(undefined, {
                  onSuccess: (data) =>
                    toast({
                      tone: "success",
                      title: "Sample targets ready",
                      description: `${data.targets.length} targets in your list.`,
                    }),
                  onError: (error) =>
                    toast({
                      tone: "error",
                      title: "Couldn't load the samples",
                      description: error.message,
                    }),
                })
              }
            >
              <FlaskConical className="size-3.5" aria-hidden="true" />
              Load sample targets
            </Button>
          ) : null}
          <LinkButton href="/targets/new" size="sm">
            <Plus className="size-3.5" aria-hidden="true" />
            New target
          </LinkButton>
        </div>
      </header>

      {targetsQuery.isLoading ? (
        <div
          role="status"
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label="Loading targets"
        >
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : targetsQuery.isError ? (
        <ErrorState
          title="We couldn't load your job targets"
          description={targetsQuery.error.message}
          onRetry={() => void targetsQuery.refetch()}
          retrying={targetsQuery.isFetching}
        />
      ) : targets.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No job targets yet"
          description="Paste a job description and we'll extract its requirements, match them against your workspace evidence, and show you exactly what's missing."
        >
          <LinkButton href="/targets/new" size="sm">
            Add your first target
          </LinkButton>
          <LinkButton href="/workspace" size="sm" variant="secondary">
            Open your workspace
          </LinkButton>
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="target-list">
          {targets.map((target) => (
            <li key={target.id}>
              <TargetCard target={target} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TargetCard({ target }: { target: JobTarget }) {
  const analysed = target.analysis;
  const analysedLabel =
    analysed && !Number.isNaN(Date.parse(analysed.analysedAt))
      ? new Date(analysed.analysedAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;

  return (
    <GlassCard className="transition-colors hover:bg-white/[0.09]">
      <Link
        href={`/targets/${target.id}`}
        className="flex flex-col gap-3 p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-sm font-medium text-text">{target.role}</p>
            {target.company ? (
              <p className="truncate text-xs text-muted">{target.company}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {target.sample ? <Badge variant="outline">Sample</Badge> : null}
            {analysed ? (
              <>
                <Badge variant="default">Score {analysed.score}</Badge>
                {analysed.stale ? <Badge variant="related">Stale</Badge> : null}
              </>
            ) : (
              <Badge variant="outline">
                {target.status === "analyzing" ? "Analysing…" : "Not analysed"}
              </Badge>
            )}
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3" aria-hidden="true" />
            {analysedLabel ? `Analysed ${analysedLabel}` : "Created recently"}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {target.jobDescription.length.toLocaleString("en-GB")} characters of
            posting
          </span>
          {analysed?.stale ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-evidence-related">
                workspace changed since this score
              </span>
            </>
          ) : null}
        </p>
      </Link>
    </GlassCard>
  );
}
