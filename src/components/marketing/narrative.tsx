"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Download } from "lucide-react";
import { GlassCard } from "@/components/domain/glass-card";
import { EvidenceBadge } from "@/components/domain/evidence-badge";
import { EvidenceChip } from "@/components/domain/evidence-chip";
import { ScoreRing } from "@/components/domain/score-ring";
import { FactorBar } from "@/components/domain/factor-bar";
import { Button } from "@/components/ui/button";
import { toast } from "@/features/ui/toast-store";
import type { EvidenceState } from "@/lib/schemas";

/**
 * Scroll narrative (F1): six pinned scenes, each with a mock UI card that
 * animates in. Pinning is CSS sticky (see marketing.css); under
 * prefers-reduced-motion the scenes collapse to a static stacked layout and
 * cards fade in without translation.
 */
function Scene({
  step,
  title,
  copy,
  card,
  flip = false,
}: {
  step: string;
  title: string;
  copy: string;
  card: ReactNode;
  flip?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="mkt-tall">
      <div className="mkt-sticky">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 px-6 lg:grid-cols-2 lg:gap-14">
          <motion.div
            initial={{ opacity: 0, y: reduceMotion ? 0 : 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{ duration: reduceMotion ? 0.2 : 0.7, ease: "easeOut" }}
            className={`min-w-0 ${flip ? "lg:order-2" : ""}`}
          >
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
              {step}
            </p>
            <h3 className="mt-3 font-display text-3xl tracking-tight sm:text-4xl">
              {title}
            </h3>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted sm:text-base">
              {copy}
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: reduceMotion ? 0 : 48 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-20%" }}
            transition={{
              duration: reduceMotion ? 0.2 : 0.8,
              delay: reduceMotion ? 0 : 0.1,
              ease: "easeOut",
            }}
            className={`min-w-0 ${flip ? "lg:order-1" : ""}`}
          >
            {card}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

const WORKSPACE_ROWS: { label: string; detail: string; state: EvidenceState }[] = [
  { label: "Education", detail: "B.Sc. Computer Science · 2022–2026", state: "attested" },
  { label: "Project", detail: "Campus event tracker · TypeScript", state: "related" },
  { label: "Certificate", detail: "SQL fundamentals · file attached", state: "verified" },
  { label: "Experience", detail: "No roles added yet", state: "missing" },
];

function WorkspaceCard() {
  return (
    <GlassCard className="p-5 sm:p-6">
      <p className="text-sm font-semibold">Master Workspace</p>
      <p className="mt-1 font-mono text-xs text-muted">v12 · synced just now</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {WORKSPACE_ROWS.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-sm border border-white/[0.06] bg-white/[0.03] px-3 py-2"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{row.label}</span>
              <span className="block truncate text-xs text-muted">{row.detail}</span>
            </span>
            <EvidenceBadge state={row.state} />
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function EvidenceCard() {
  const states: { state: EvidenceState; meaning: string }[] = [
    { state: "verified", meaning: "Backed by a document or link." },
    { state: "attested", meaning: "Entered by you, awaiting proof." },
    { state: "related", meaning: "Adjacent skill — not equivalent." },
    { state: "missing", meaning: "Shown as missing. Never invented." },
  ];
  return (
    <GlassCard className="p-5 sm:p-6">
      <p className="text-sm font-semibold">Evidence states</p>
      <ul className="mt-4 flex flex-col gap-3">
        {states.map((s) => (
          <li key={s.state} className="flex items-center gap-3">
            <EvidenceBadge state={s.state} />
            <span className="text-xs text-muted">{s.meaning}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-white/[0.06] pt-3 font-mono text-[11px] text-muted">
        JavaScript ≠ TypeScript · React ≠ Angular · Docker ≠ Kubernetes
      </p>
    </GlassCard>
  );
}

function MatchCard() {
  return (
    <GlassCard className="flex flex-col items-center gap-5 p-5 sm:p-6">
      <ScoreRing value={78} label="Match" size={128} />
      <div className="flex w-full flex-col gap-3">
        <FactorBar name="Required skills" weight={0.4} value={84} />
        <FactorBar name="Experience" weight={0.2} value={62} />
        <FactorBar name="Projects" weight={0.15} value={80} />
      </div>
      <p className="text-center text-[11px] text-muted">
        Weighted 40/15/20/10/15. Not a probability of being hired.
      </p>
    </GlassCard>
  );
}

function TailoredCard() {
  return (
    <GlassCard className="p-5 sm:p-6">
      <p className="text-sm font-semibold">Tailored resume · Frontend Intern</p>
      <ul className="mt-4 flex list-none flex-col gap-3 text-sm leading-relaxed">
        <li className="flex flex-wrap items-center gap-2">
          <span>Built a single-page event tracker used by two clubs.</span>
          <EvidenceChip state="related" label="project" />
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span>Coursework in data structures and databases.</span>
          <EvidenceChip state="attested" label="education" />
        </li>
        <li className="flex flex-wrap items-center gap-2 text-muted">
          <span>Kubernetes experience — not evidenced, left out.</span>
          <EvidenceChip state="missing" label="missing" />
        </li>
      </ul>
    </GlassCard>
  );
}

const ATS_ROWS = [
  { ok: true, text: "Standard headings · single column" },
  { ok: true, text: "Keyword coverage 82% for this role" },
  { ok: false, text: "1 fix: add dates to the course project" },
];

function AtsCard() {
  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">ATS readability</p>
        <p className="font-mono text-2xl text-text tabular-nums">
          91<span className="text-sm text-muted">/100</span>
        </p>
      </div>
      <ul className="mt-4 flex flex-col gap-2.5">
        {ATS_ROWS.map((row) => (
          <li
            key={row.text}
            className="flex items-start gap-2.5 text-sm"
          >
            <span
              aria-hidden="true"
              className={
                row.ok
                  ? "mt-0.5 inline-block size-2 shrink-0 rounded-full bg-evidence-verified"
                  : "mt-0.5 inline-block size-2 shrink-0 rounded-full bg-evidence-related"
              }
            />
            <span className={row.ok ? "" : "text-muted"}>{row.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] text-muted">
        Based on defined checks. Not a guarantee for any employer&apos;s ATS.
      </p>
    </GlassCard>
  );
}

function ExportCard() {
  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="rounded-sm border border-white/[0.08] bg-bg/60 p-4">
        <div className="h-2 w-1/3 rounded-full bg-white/20" />
        <div className="mt-2 h-2 w-2/3 rounded-full bg-white/10" />
        <div className="mt-2 h-2 w-1/2 rounded-full bg-white/10" />
        <div className="mt-2 h-2 w-3/5 rounded-full bg-white/10" />
      </div>
      <ul className="mt-4 flex flex-col gap-1.5 font-mono text-[11px] text-muted">
        <li>PDF · selectable text · single column</li>
        <li>No watermark · ATS-safe layout</li>
      </ul>
      <Button
        variant="secondary"
        size="sm"
        className="mt-4"
        onClick={() =>
          toast({
            title: "Preview only",
            description: "PDF export lands with the Resume Studio in F5.",
            tone: "info",
          })
        }
      >
        <Download className="size-4" aria-hidden="true" />
        Export PDF
      </Button>
    </GlassCard>
  );
}

export function Narrative() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="relative">
      <div className="mx-auto max-w-6xl px-6 pb-4 pt-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          How it works
        </p>
        <h2 id="how-heading" className="mt-3 max-w-2xl font-display text-4xl tracking-tight sm:text-5xl">
          From scattered history to a resume you can defend.
        </h2>
      </div>

      <Scene
        step="Step 1 of 6 · Workspace"
        title="One workspace. Everything you can truthfully claim."
        copy="Education, projects, skills, certificates — typed once or imported from documents, each line carrying its evidence."
        card={<WorkspaceCard />}
      />
      <Scene
        step="Step 2 of 6 · Evidence"
        title="Proof attached to every line."
        copy="Verified, attested, related, or missing. Adjacent technologies count as related — never equivalent."
        card={<EvidenceCard />}
        flip
      />
      <Scene
        step="Step 3 of 6 · Job match"
        title="See how you fit — honestly."
        copy="Each requirement is matched, partially matched, or unsupported against your evidence, with the score explained factor by factor."
        card={<MatchCard />}
      />
      <Scene
        step="Step 4 of 6 · Tailored resume"
        title="Rewritten for the role. Never rewritten facts."
        copy="Wording gets sharper; facts stay identical. Unsupported claims are left out or flagged for your confirmation."
        card={<TailoredCard />}
        flip
      />
      <Scene
        step="Step 5 of 6 · ATS check"
        title="Readable by machines, written for humans."
        copy="Deterministic checks — headings, layout, keywords, dates — with concrete fixes, not a black-box verdict."
        card={<AtsCard />}
      />
      <Scene
        step="Step 6 of 6 · Export"
        title="Take it with you."
        copy="A clean PDF with selectable text and an ATS-safe layout. Your history of tailored versions stays saved per application."
        card={<ExportCard />}
        flip
      />
    </section>
  );
}
