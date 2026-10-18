"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CircleSlash,
  Compass,
  FileCheck2,
  FileX2,
  HelpCircle,
  ListTree,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/domain/panel";
import { FactorBar } from "@/components/domain/factor-bar";
import { ScoreRing } from "@/components/domain/score-ring";
import { EvidenceBadge } from "@/components/domain/evidence-badge";
import { SkillConstellation } from "@/components/domain/skill-constellation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { sectionMeta } from "@/features/workspace/sections";
import { EVIDENCE_META } from "@/features/workspace/evidence";
import { monthLabel } from "@/lib/analysis/ats";
import {
  ATS_CHECK_NOTE,
  ATS_DISCLAIMER,
  SCORE_DISCLAIMER,
  SCORE_METHODOLOGY_NOTE,
  groupRequirements,
  type AnalysisReport,
  type Requirement,
  type WorkspaceItem,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Report panels (PRD §6.5–6.7).
 *
 * Every panel answers three questions: what the posting asked for, what your
 * workspace actually answers it with, and what to do next. Numbers always sit
 * next to the method that produced them, and nothing is phrased as a
 * probability of being hired or an ATS guarantee.
 */

/* ------------------------------------------------------------------ score */

export function ScorePanel({
  report,
  onRerun,
  rerunning,
}: {
  report: AnalysisReport;
  onRerun: () => void;
  rerunning: boolean;
}) {
  return (
    <Panel
      id="report-score"
      title="Match score and factors"
      description="One number, five fixed factors, every weight visible. Change the inputs and you can predict the change in the number."
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onRerun}
          disabled={rerunning}
          aria-busy={rerunning}
          data-testid="report-rerun"
        >
          {rerunning ? "Re-running…" : "Re-run analysis"}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <ScoreRing value={report.score} label="Match" />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {report.factors.length === 0 ? (
            <p className="text-sm text-muted">
              There was nothing to compare: this posting named no requirements we
              recognise and your workspace has no items in the matching areas.
            </p>
          ) : (
            report.factors.map((factor) => (
              <div key={factor.name} className="flex flex-col gap-1">
                <FactorBar name={factor.name} weight={factor.weight} value={factor.value} />
                {factor.detail ? (
                  <p className="text-xs leading-relaxed text-muted">{factor.detail}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
      <p className="rounded-sm bg-white/[0.04] p-3 text-xs leading-relaxed text-muted">
        <span className="font-medium text-text">How this is calculated. </span>
        {SCORE_METHODOLOGY_NOTE}
      </p>
      <p className="text-xs leading-relaxed text-evidence-related">
        {SCORE_DISCLAIMER}
      </p>
    </Panel>
  );
}

/* ----------------------------------------------------------- requirements */

export function RequirementsPanel({
  report,
  items,
}: {
  report: AnalysisReport;
  items: WorkspaceItem[];
}) {
  const groups = groupRequirements(report.requirements);
  const total = report.requirements.length;

  return (
    <Panel
      id="report-requirements"
      title="Requirements against your evidence"
      description="Every line is taken from the posting's own wording, then placed in one of three states. Click a source to see the workspace item behind it."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="verified">{groups.matched.length} matched</Badge>
          <Badge variant="related">{groups.partial.length} partial</Badge>
          <Badge variant="missing">{groups.unsupported.length} unsupported</Badge>
        </div>
      }
    >
      {total === 0 ? (
        <p className="text-sm text-muted">
          No requirements were recognised in this posting. That usually means the
          text is very short or is formatted as an image.
        </p>
      ) : (
        <>
          <SkillConstellation requirements={report.requirements} />
          <ul className="flex flex-col gap-2" data-testid="requirement-list">
            {report.requirements.map((requirement) => (
              <RequirementRow key={requirement.id} requirement={requirement} items={items} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

const STATUS_META = {
  matched: {
    label: "Matched",
    variant: "verified" as const,
    icon: BadgeCheck,
    tint: "border-evidence-verified/40",
  },
  partial: {
    label: "Partially matched",
    variant: "related" as const,
    icon: TriangleAlert,
    tint: "border-evidence-related/40",
  },
  unsupported: {
    label: "Unsupported",
    variant: "missing" as const,
    icon: CircleSlash,
    tint: "border-evidence-missing/40",
  },
};

function RequirementRow({
  requirement,
  items,
}: {
  requirement: Requirement;
  items: WorkspaceItem[];
}) {
  const meta = STATUS_META[requirement.status];
  const Icon = meta.icon;
  return (
    <li
      className={cn("flex flex-col gap-2 rounded-sm border-l-2 bg-white/[0.02] p-3", meta.tint)}
      data-status={requirement.status}
      data-gap={requirement.gapType ?? undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-text">{requirement.text}</p>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {requirement.kind === "required" ? "Required" : "Preferred"}
          </Badge>
          <Badge variant={meta.variant}>
            <Icon className="size-3" aria-hidden="true" />
            {meta.label}
          </Badge>
        </div>
      </div>
      {requirement.explanation ? (
        <p className="text-xs leading-relaxed text-muted">{requirement.explanation}</p>
      ) : null}
      {requirement.status === "unsupported" && requirement.gapType ? (
        <p className="text-xs text-muted">
          {requirement.gapType === "not_evidenced"
            ? "Gap type: not evidenced yet — you have something adjacent to this."
            : "Gap type: genuinely missing — nothing in your workspace relates to it."}
        </p>
      ) : null}
      {requirement.evidenceIds.length > 0 ? (
        <EvidenceLinks ids={requirement.evidenceIds} items={items} label="Evidence" />
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------ evidence UI */

function EvidenceLinks({
  ids,
  items,
  label,
}: {
  ids: string[];
  items: WorkspaceItem[];
  label: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const resolved = ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is WorkspaceItem => Boolean(item));
  if (resolved.length === 0) return null;
  const open = resolved.find((item) => item.id === openId) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{label}:</span>
      {resolved.map((item) => (
        <Sheet
          key={item.id}
          open={openId === item.id}
          onOpenChange={(next) => setOpenId(next ? item.id : null)}
        >
          <SheetTrigger asChild>
            <button
              type="button"
              className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs text-text underline-offset-4 hover:bg-white/[0.12] hover:underline"
            >
              {item.title}
            </button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{item.title}</SheetTitle>
              <SheetDescription>
                {sectionMeta(item.section).label}
                {item.organization ? ` · ${item.organization}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <EvidenceBadge state={item.evidence} />
                {item.startDate ? (
                  <Badge variant="outline">
                    {monthLabel(item.startDate)}
                    {item.endDate ? ` – ${monthLabel(item.endDate)}` : " – present"}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted">
                {EVIDENCE_META[item.evidence].description}
              </p>
              {item.bullets.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted">
                  {item.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
              {item.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Link
                href={`/workspace/${item.section}`}
                className="text-xs text-accent-cyan underline-offset-4 hover:underline"
              >
                Open {sectionMeta(item.section).label} in your workspace
                <ArrowRight className="ml-1 inline size-3" aria-hidden="true" />
              </Link>
            </div>
          </SheetContent>
        </Sheet>
      ))}
      {open ? <span className="sr-only">Showing details for {open.title}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ gaps */

export function GapsPanel({ report }: { report: AnalysisReport }) {
  const groups = groupRequirements(report.requirements);
  return (
    <Panel
      id="report-gaps"
      title="Gaps, split honestly"
      description="“Not evidenced yet” means something adjacent exists in your workspace — it usually just needs writing down. “Genuinely missing” means nothing does."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <GapList
          title="Not evidenced yet"
          hint="Adjacent evidence exists — record the real thing."
          variant="related"
          icon={HelpCircle}
          requirements={groups.notEvidenced}
          empty="Nothing falls into this bucket."
        />
        <GapList
          title="Genuinely missing"
          hint="No adjacent evidence — this needs learning or building."
          variant="missing"
          icon={FileX2}
          requirements={groups.genuinelyMissing}
          empty="Nothing falls into this bucket."
        />
      </div>
    </Panel>
  );
}

function GapList({
  title,
  hint,
  variant,
  icon: Icon,
  requirements,
  empty,
}: {
  title: string;
  hint: string;
  variant: "related" | "missing";
  icon: typeof HelpCircle;
  requirements: Requirement[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "size-4",
            variant === "related" ? "text-evidence-related" : "text-evidence-missing",
          )}
          aria-hidden="true"
        />
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <Badge variant={variant}>{requirements.length}</Badge>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {requirements.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-col gap-1">
              <p className="text-sm text-text">{requirement.text}</p>
              {requirement.explanation ? (
                <p className="text-xs leading-relaxed text-muted">{requirement.explanation}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- skills */

export function SkillsPanel({ report }: { report: AnalysisReport }) {
  const { documented, demonstrated, notEvidenced, toDevelop } = report.skills;
  return (
    <Panel
      id="report-skills"
      title="Skills analysis"
      description="What you claim, what your evidence demonstrates, and what to develop — kept separate so a listed skill is never mistaken for a proven one."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SkillList
          title="Documented"
          hint="Listed in your skills section."
          icon={ListTree}
          findings={documented}
          empty="No skills listed yet."
        />
        <SkillList
          title="Demonstrated"
          hint="Backed by a project, role, course or certificate."
          icon={BadgeCheck}
          findings={demonstrated}
          empty="No evidence-backed skills found yet."
        />
      </div>
      {notEvidenced.length > 0 || toDevelop.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
          <div className="flex items-center gap-2">
            <Compass className="size-4 text-accent-cyan" aria-hidden="true" />
            <h3 className="text-sm font-medium text-text">Worth developing</h3>
          </div>
          <p className="text-xs text-muted">
            Ordered by how much each one would move this application: a genuine
            miss first, then anything adjacent that isn&apos;t written down yet.
          </p>
          <ul className="flex flex-col gap-2">
            {toDevelop.map((gap) => (
              <li key={gap.name} className="flex flex-col gap-1">
                <p className="text-sm text-text">{gap.name}</p>
                <p className="text-xs leading-relaxed text-muted">{gap.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Every skill this posting names is already evidenced in your workspace.
        </p>
      )}
    </Panel>
  );
}

function SkillList({
  title,
  hint,
  icon: Icon,
  findings,
  empty,
}: {
  title: string;
  hint: string;
  icon: typeof ListTree;
  findings: { name: string; itemIds: string[] }[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-accent-cyan" aria-hidden="true" />
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <Badge variant="outline">{findings.length}</Badge>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {findings.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {findings.map((finding) => (
            <Badge key={finding.name} variant="outline">
              {finding.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- content */

export function ContentPanel({
  report,
  items,
}: {
  report: AnalysisReport;
  items: WorkspaceItem[];
}) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <Panel
      id="report-content"
      title="What goes into the resume, and why"
      description="Resume content decisions, with the reason printed next to every item. Nothing is included without evidence behind it."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <DecisionList
          title="Included"
          hint="Used because it supports a requirement in this posting."
          icon={FileCheck2}
          variant="verified"
          decisions={report.included}
          byId={byId}
          empty="Nothing was used as requirement evidence yet."
        />
        <DecisionList
          title="Excluded"
          hint="Left out deliberately — each row says why."
          icon={FileX2}
          variant="missing"
          decisions={report.excluded}
          byId={byId}
          empty="Everything in your workspace earned its place."
        />
      </div>

      <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
        <h3 className="text-sm font-medium text-text">Sections to work on</h3>
        {report.content.sectionsToImprove.length === 0 ? (
          <p className="text-xs text-muted">
            No section needs attention for this posting.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {report.content.sectionsToImprove.map((entry) => (
              <li key={entry.section} className="flex flex-col gap-1">
                <Link
                  href={`/workspace/${entry.section}`}
                  className="text-sm text-text underline-offset-4 hover:underline"
                >
                  {sectionMeta(entry.section).label}
                </Link>
                <p className="text-xs leading-relaxed text-muted">{entry.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted">
        {report.content.supportedRequirementIds.length} requirement(s) are backed
        by evidence;{" "}
        {report.content.needsEvidenceRequirementIds.length} still need some. The
        exported resume only claims what the first group contains.
      </p>
    </Panel>
  );
}

function DecisionList({
  title,
  hint,
  icon: Icon,
  variant,
  decisions,
  byId,
  empty,
}: {
  title: string;
  hint: string;
  icon: typeof FileCheck2;
  variant: "verified" | "missing";
  decisions: { itemId: string; reason: string }[];
  byId: Map<string, WorkspaceItem>;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "size-4",
            variant === "verified" ? "text-evidence-verified" : "text-muted",
          )}
          aria-hidden="true"
        />
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <Badge variant="outline">{decisions.length}</Badge>
      </div>
      <p className="text-xs text-muted">{hint}</p>
      {decisions.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decisions.map((decision) => {
            const item = byId.get(decision.itemId);
            return (
              <li key={decision.itemId} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-text">
                    {item?.title ?? decision.itemId}
                  </span>
                  {item ? <EvidenceBadge state={item.evidence} /> : null}
                </div>
                <p className="text-xs leading-relaxed text-muted">{decision.reason}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- roadmap */

export function RoadmapPanel({ report }: { report: AnalysisReport }) {
  return (
    <Panel
      id="report-roadmap"
      title="Improvement roadmap"
      description="Prioritised, in the order that would move this application most. Every step names the posting requirement or workspace item it comes from."
    >
      {report.roadmap.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing outstanding: this posting is fully covered by your workspace.
        </p>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="roadmap">
          {report.roadmap.map((step) => (
            <li key={step.priority} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-elevated font-mono text-xs text-accent-cyan"
              >
                {step.priority}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm text-text">{step.action}</p>
                <p className="text-xs leading-relaxed text-muted">{step.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted">
        Steps are suggestions, not instructions: only add what is true about you.
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ ATS */

export function AtsPanel({ report }: { report: AnalysisReport }) {
  const { ats } = report;
  return (
    <Panel
      id="report-ats"
      title="ATS panel"
      description="Deterministic checks on the resume text we build from your workspace. Same input, same result — no model involved."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline">ATS score {ats.score}</Badge>
          <Badge variant="outline">Keyword coverage {ats.keywordCoverage}%</Badge>
        </div>
      }
    >
      <ul className="flex flex-col gap-2" data-testid="ats-checks">
        {ats.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full",
                check.status === "pass"
                  ? "bg-evidence-verified"
                  : check.status === "issue"
                    ? "bg-evidence-missing"
                    : "bg-muted",
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-text">
                {check.label}
                <span className="ml-2 text-xs uppercase tracking-wide text-muted">
                  {check.status === "not_checked" ? "not checked yet" : check.status}
                </span>
              </span>
              <span className="text-xs leading-relaxed text-muted">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-text">Issues and fixes</h3>
        {ats.issues.length === 0 ? (
          <p className="text-xs text-muted">No issues found by these checks.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ats.issues.map((issue) => (
              <li
                key={issue.id}
                className="flex flex-col gap-1 rounded-sm border-l-2 border-evidence-missing/50 bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      issue.severity === "high"
                        ? "missing"
                        : issue.severity === "med"
                          ? "related"
                          : "outline"
                    }
                  >
                    {issue.severity}
                  </Badge>
                  <span className="text-xs text-muted">{issue.check}</span>
                </div>
                <p className="text-sm text-text">{issue.message}</p>
                <p className="text-xs leading-relaxed text-muted">
                  <span className="font-medium text-text">Fix: </span>
                  {issue.fix}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-text">Before and after</h3>
        <p className="text-xs text-muted">{ATS_CHECK_NOTE}</p>
        {ats.examples.length === 0 ? (
          <p className="text-xs text-muted">
            No rewrite examples for this run — the checks that produce them
            passed.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="ats-examples">
            {ats.examples.map((example) => (
              <li
                key={example.id}
                className="grid gap-2 rounded-sm border border-white/[0.08] p-3 sm:grid-cols-2"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-muted">
                    Before
                  </span>
                  <p className="whitespace-pre-wrap font-mono text-xs text-muted">
                    {example.before}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-muted">
                    After
                  </span>
                  <p className="whitespace-pre-wrap font-mono text-xs text-text">
                    {example.after}
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-muted sm:col-span-2">
                  {example.note}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-text">
          <Sparkles className="size-3.5 text-accent-cyan" aria-hidden="true" />
          Keyword coverage
        </h3>
        {ats.keywords.length === 0 ? (
          <p className="text-xs text-muted">
            No keywords were extracted from this posting.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ats.keywords.map((keyword) => (
              <Badge
                key={keyword.keyword}
                variant={keyword.present ? "verified" : "missing"}
              >
                {keyword.keyword}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs leading-relaxed text-evidence-related">
        {ATS_DISCLAIMER}
      </p>
    </Panel>
  );
}
