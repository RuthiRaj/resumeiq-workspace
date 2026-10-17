"use client";

import {
  BookOpen,
  Check,
  CircleAlert,
  FileText,
  GitCompareArrows,
  Gauge,
  ScanText,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * StageProgress (PRD §7.6) — the analysis theatre's honest progress list.
 *
 * Each stage carries its own micro-animation so the wait shows *what* is
 * happening; when the user prefers reduced motion the animation is replaced by
 * a static state marker and a text status instead of being merely sped up.
 */

export interface StageProgressItem {
  key: string;
  label: string;
  detail?: string;
}

const ICONS: Record<string, LucideIcon> = {
  reading: BookOpen,
  extracting: ScanText,
  searching: Search,
  matching: GitCompareArrows,
  scoring: Gauge,
  writing: FileText,
};

/** One micro-animation per stage (motion mode only). */
const MOTION: Record<string, string> = {
  reading: "motion-safe:animate-pulse",
  extracting: "motion-safe:animate-spin",
  searching: "motion-safe:animate-pulse",
  matching: "motion-safe:animate-ping",
  scoring: "motion-safe:animate-bounce",
  writing: "motion-safe:animate-pulse",
};

export function StageProgress({
  stages,
  activeIndex,
  progress,
  failedIndex,
  reduceMotion,
  label = "Progress",
  className,
}: {
  stages: readonly StageProgressItem[];
  /** Index of the stage currently running (or the failing one). */
  activeIndex: number;
  /** 0–100 overall progress. */
  progress: number;
  /** Index of the stage that failed, when the run failed. */
  failedIndex?: number;
  /** Override the OS preference (tests + the reduced-motion e2e case). */
  reduceMotion?: boolean;
  label?: string;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();
  const reduce = reduceMotion ?? Boolean(prefersReduced);
  const active = stages[activeIndex];
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-testid="stage-progress"
      // Exposed so the reduced-motion e2e case can assert the static rendering
      // is actually chosen, not just animated more slowly.
      data-motion={reduce ? "reduced" : "full"}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-text" data-testid="stage-active-label">
            {failedIndex !== undefined ? "Analysis stopped" : (active?.label ?? "Working…")}
          </p>
          <span className="font-mono text-xs tabular-nums text-muted">{clamped}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped}
          className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        >
          <div
            className={cn(
              "h-full rounded-full bg-accent-cyan transition-[width] duration-500",
              failedIndex !== undefined && "bg-evidence-missing",
            )}
            style={{ width: `${clamped}%` }}
          />
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {failedIndex !== undefined
            ? `Analysis stopped at ${stages[failedIndex]?.label ?? "a stage"}.`
            : `Stage ${activeIndex + 1} of ${stages.length}: ${active?.label ?? ""}`}
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {stages.map((stage, index) => {
          const failed = failedIndex === index;
          const done = failedIndex === undefined && index < activeIndex;
          const running = failedIndex === undefined && index === activeIndex;
          const Icon = ICONS[stage.key] ?? FileText;
          const state = failed ? "failed" : done ? "done" : running ? "active" : "pending";
          return (
            <li
              key={stage.key}
              data-stage={stage.key}
              data-state={state}
              className={cn(
                "flex items-start gap-3 rounded-sm px-2 py-1.5 text-sm",
                running && "bg-white/[0.04]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                  done && "border-evidence-verified/50 text-evidence-verified",
                  running && !reduce && "border-accent-cyan/60 text-accent-cyan",
                  running && reduce && "border-accent-cyan/60 text-accent-cyan",
                  failed && "border-evidence-missing/60 text-evidence-missing",
                  state === "pending" && "border-white/[0.12] text-muted",
                )}
              >
                {failed ? (
                  <CircleAlert className="size-3" />
                ) : done ? (
                  <Check className="size-3" />
                ) : (
                  <Icon
                    className={cn(
                      "size-3",
                      running && !reduce && MOTION[stage.key],
                    )}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    "truncate",
                    running ? "text-text" : done ? "text-text/80" : "text-muted",
                  )}
                >
                  {stage.label}
                </span>
                {stage.detail ? (
                  <span className="text-xs text-muted">{stage.detail}</span>
                ) : null}
              </span>
              <span className="ml-auto shrink-0 pl-2 text-xs text-muted">
                {failed ? "Failed" : done ? "Done" : running ? "Running" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
