"use client";

import Link from "next/link";
import { ArrowLeft, Clock3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Panel } from "@/components/domain/panel";
import {
  AtsPanel,
  ContentPanel,
  GapsPanel,
  RequirementsPanel,
  RoadmapPanel,
  ScorePanel,
  SkillsPanel,
} from "./report-panels";
import type { AnalysisReport, JobTarget, WorkspaceItem } from "@/lib/schemas";

/**
 * The full AI report (PRD §6.4–6.7): score, requirements, gaps, skills, content
 * decisions, roadmap and the ATS panel — in that order, each with its method
 * visible next to its numbers.
 */
export function ReportView({
  target,
  report,
  items,
  onRerun,
  rerunning,
  stale,
}: {
  target: JobTarget;
  report: AnalysisReport;
  items: WorkspaceItem[];
  onRerun: () => void;
  rerunning: boolean;
  stale: boolean;
}) {
  const generated = new Date(report.generatedAt);
  const generatedLabel = Number.isNaN(generated.getTime())
    ? report.generatedAt
    : generated.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      });

  return (
    <div className="flex flex-col gap-5" data-testid="report-view">
      <header className="flex flex-col gap-3">
        <Link
          href="/targets"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-text hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All job targets
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-display text-3xl tracking-tight">{target.role}</h1>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {target.company ? <span>{target.company}</span> : null}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3" aria-hidden="true" />
                Analysed {generatedLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span>Workspace version {report.workspaceVersion}</span>
              {target.sample ? <Badge variant="outline">Sample posting</Badge> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/resume" variant="secondary" size="sm">
              Standard resume
            </LinkButton>
          </div>
        </div>
      </header>

      {stale ? (
        <Panel
          id="report-stale"
          title="Your workspace changed since this report"
          description="The score below was calculated from an older version, so treat it as out of date until you re-run it."
          className="border-l-2 border-evidence-related"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={onRerun}
              disabled={rerunning}
              aria-busy={rerunning}
              data-testid="report-stale-rerun"
            >
              <RefreshCw
                className={rerunning ? "size-3.5 animate-spin" : "size-3.5"}
                aria-hidden="true"
              />
              {rerunning ? "Re-running…" : "Re-run analysis"}
            </Button>
          }
        >
          <p className="text-xs text-muted">
            Reports never silently re-score themselves — you decide when to spend
            the run.
          </p>
        </Panel>
      ) : null}

      <ScorePanel report={report} onRerun={onRerun} rerunning={rerunning} />
      <RequirementsPanel report={report} items={items} />
      <GapsPanel report={report} />
      <SkillsPanel report={report} />
      <ContentPanel report={report} items={items} />
      <RoadmapPanel report={report} />
      <AtsPanel report={report} />
    </div>
  );
}
