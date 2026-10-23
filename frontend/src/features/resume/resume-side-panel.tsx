"use client";

import { useMemo } from "react";
import { FileSearch, ListChecks, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/domain/score-ring";
import {
  ATS_CHECK_NOTE,
  ATS_DISCLAIMER,
  groupRequirements,
  type AnalysisReport,
  type Resume,
  type WorkspaceItem,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { EvidenceChip } from "./evidence-sheet";

/**
 * Studio side panel: ATS checks, requirement coverage, and every source item
 * the resume cites. Numbers always sit next to their method, and missing
 * evidence is shown as missing rather than implied by a green score.
 */
export function ResumeSidePanel({
  resume,
  report,
  items,
  onOpenEvidence,
}: {
  resume: Resume;
  report?: AnalysisReport;
  items: WorkspaceItem[];
  onOpenEvidence: (itemId: string) => void;
}) {
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const evidenceIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const section of resume.sections) {
      for (const claim of section.claims) {
        for (const id of claim.evidenceIds) {
          if (seen.has(id)) continue;
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }, [resume.sections]);

  const groups = report ? groupRequirements(report.requirements) : null;
  const total = report?.requirements.length ?? 0;
  const matched = groups?.matched.length ?? 0;
  const coverage = total > 0 ? Math.round((matched / total) * 100) : 0;
  const changed = resume.editedSections.length;

  return (
    <aside className="flex flex-col gap-3" aria-label="Resume analysis">
      <section className="glass rounded-md p-4" aria-labelledby="studio-ats-heading">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-accent-cyan" aria-hidden="true" />
          <h2 id="studio-ats-heading" className="text-sm font-medium text-text">
            ATS checks
          </h2>
        </div>
        {resume.ats ? (
          <div className="mt-3 flex items-center gap-4">
            <ScoreRing value={resume.ats.score} label="ATS score" size={112} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-xs text-muted">
                Keyword coverage{" "}
                <span className="font-mono tabular-nums text-text">
                  {Math.round(resume.ats.keywordCoverage)}%
                </span>
              </p>
              <p className="text-[11px] leading-relaxed text-muted">
                {resume.ats.issues.length === 0
                  ? "No deterministic issues were found."
                  : `${resume.ats.issues.length} issue${resume.ats.issues.length === 1 ? "" : "s"} found in this resume.`}
              </p>
              {resume.ats.issues.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {resume.ats.issues.slice(0, 3).map((issue) => (
                    <li key={issue.id} className="text-[11px] leading-relaxed text-text">
                      <span className="text-muted">{issue.severity}:</span>{" "}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            No ATS result is attached to this resume. Generate a new version from
            a finished report to run the deterministic checks.
          </p>
        )}
        <p className="mt-3 border-t border-white/[0.08] pt-2 text-[11px] leading-relaxed text-muted">
          {ATS_DISCLAIMER} {ATS_CHECK_NOTE}
        </p>
      </section>

      <section
        className="glass rounded-md p-4"
        aria-labelledby="studio-coverage-heading"
      >
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-accent-cyan" aria-hidden="true" />
          <h2 id="studio-coverage-heading" className="text-sm font-medium text-text">
            Requirement coverage
          </h2>
        </div>
        {report && groups ? (
          <>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-3xl tabular-nums text-text">
                {matched}
              </span>
              <span className="text-sm text-muted">of {total} matched</span>
            </div>
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
              role="img"
              aria-label={`${coverage}% of requirements matched`}
            >
              <div
                className="h-full rounded-full bg-accent-cyan"
                style={{ width: `${coverage}%` }}
              />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-sm border border-white/[0.06] p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted">Matched</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-evidence-verified">
                  {groups.matched.length}
                </dd>
              </div>
              <div className="rounded-sm border border-white/[0.06] p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted">Partial</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-evidence-related">
                  {groups.partial.length}
                </dd>
              </div>
              <div className="rounded-sm border border-white/[0.06] p-2">
                <dt className="text-[10px] uppercase tracking-wide text-muted">Gaps</dt>
                <dd className="mt-0.5 text-sm tabular-nums text-evidence-missing">
                  {groups.unsupported.length}
                </dd>
              </div>
            </dl>
            {groups.unsupported.length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                  Not covered yet
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {groups.unsupported.slice(0, 4).map((requirement) => (
                    <li
                      key={requirement.id}
                      className="text-[11px] leading-relaxed text-muted"
                    >
                      {requirement.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            The report for this target is unavailable. Re-run the analysis to see
            requirement coverage next to the resume.
          </p>
        )}
      </section>

      <section className="glass rounded-md p-4" aria-labelledby="studio-evidence-heading">
        <div className="flex items-center gap-2">
          <FileSearch className="size-4 text-accent-cyan" aria-hidden="true" />
          <h2 id="studio-evidence-heading" className="text-sm font-medium text-text">
            Evidence used
          </h2>
          <Badge variant="outline">{evidenceIds.length}</Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Open a source item to see exactly what supports a line. Chips marked
          removed cite items you have since deleted.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {evidenceIds.length === 0 ? (
            <span className="text-xs text-muted">No evidence is cited yet.</span>
          ) : (
            evidenceIds.map((id) => {
              const item = itemsById.get(id);
              return (
                <EvidenceChip
                  key={id}
                  label={item?.title ?? "Removed source"}
                  state={item?.evidence}
                  removed={!item || Boolean(item.deletedAt)}
                  onClick={() => onOpenEvidence(id)}
                />
              );
            })
          )}
        </div>
      </section>

      <section className="glass rounded-md p-4 text-xs leading-relaxed text-muted">
        <div className="flex items-center gap-2 text-text">
          <Sparkles className="size-4 text-accent-violet" aria-hidden="true" />
          <h2 className="text-sm font-medium">How this snapshot works</h2>
        </div>
        <p className="mt-2">
          Generated from workspace version{" "}
          <span className="font-mono tabular-nums text-text">
            {resume.workspaceVersion}
          </span>
          . Saving an edit adds an immutable version; it never rewrites history.
        </p>
        <p className="mt-1.5">
          {changed === 0
            ? "No section has been hand-edited, so a refresh may replace any section."
            : `${changed} section${changed === 1 ? "" : "s"} hand-edited. Refresh skips ${
                changed === 1 ? "it" : "them"
              } unless you explicitly confirm an overwrite.`}
        </p>
        {resume.aiUsed ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-text">
            <Badge variant="outline">AI rewording used</Badge>
            Only presentation was reworded; every fact still resolves to cited evidence.
          </p>
        ) : null}
        <p className={cn("mt-1.5", resume.stale && "text-evidence-related")}>
          {resume.stale
            ? "This snapshot is stale. Review the diff and refresh the sections you want."
            : "This snapshot is current with the workspace version above."}
        </p>
      </section>
    </aside>
  );
}
