import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { GlassCard } from "@/components/domain/glass-card";
import { EvidenceBadge } from "@/components/domain/evidence-badge";
import { EvidenceChip } from "@/components/domain/evidence-chip";
import { ScoreRing } from "@/components/domain/score-ring";
import { FactorBar } from "@/components/domain/factor-bar";
import { SyncIndicator, StaleBadge } from "@/components/domain/sync-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { EvidenceState } from "@/lib/schemas";

const SWATCHES: { name: string; token: string; value: string }[] = [
  { name: "bg", token: "bg-bg", value: "#07080C" },
  { name: "surface", token: "bg-surface", value: "#0F1117" },
  { name: "elevated", token: "bg-elevated", value: "#161924" },
  { name: "text", token: "bg-text", value: "#E8EAF0" },
  { name: "muted", token: "bg-muted", value: "#8A90A2" },
  { name: "accent-violet", token: "bg-accent-violet", value: "#7C5CFF" },
  { name: "action (AA-safe violet)", token: "bg-action", value: "#5F48D8" },
  { name: "accent-cyan", token: "bg-accent-cyan", value: "#22D3EE" },
  { name: "evidence-verified", token: "bg-evidence-verified", value: "#34D399" },
  { name: "evidence-attested", token: "bg-evidence-attested", value: "#60A5FA" },
  { name: "evidence-related", token: "bg-evidence-related", value: "#FBBF24" },
  { name: "evidence-missing", token: "bg-evidence-missing", value: "#FB7185" },
];

const EVIDENCE_STATES: EvidenceState[] = ["verified", "attested", "related", "missing"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted">
          ResumeIQ · Milestone F0
        </p>
        <h1 className="font-display text-5xl tracking-tight">Design system</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          Every token from PRD §7.2 and every base component from §7.6 built so
          far, rendered live. Scores shown here are illustrative only — never a
          hiring probability.
        </p>
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.name} className="glass flex items-center gap-3 rounded-sm p-3">
              <span aria-hidden="true" className={`${s.token} size-10 shrink-0 rounded-sm border border-white/10`} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className="block font-mono text-xs text-muted">{s.value}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="glass flex flex-col gap-3 rounded-md p-6">
          <p className="text-2xl tracking-tight">
            Geist Sans — UI text. The quick brown fox tracks the job.
          </p>
          <p className="font-display text-3xl">Instrument Serif — display headlines.</p>
          <p className="font-mono text-sm text-muted tabular-nums">
            Geist Mono — 0123456789 · scores · data · 87/100
          </p>
        </div>
      </Section>

      <Section title="Surfaces: glass · glow · grain">
        <div className="relative grid gap-3 sm:grid-cols-2">
          <GlassCard className="relative overflow-hidden p-6">
            <div aria-hidden="true" className="glow-violet absolute -right-16 -top-16 size-48" />
            <p className="text-sm font-medium">GlassCard + violet glow</p>
            <p className="mt-1 text-xs text-muted">6% white fill · blur-xl · hairline border</p>
          </GlassCard>
          <Card>
            <CardHeader>
              <CardTitle>Base card</CardTitle>
              <CardDescription>Solid surface for dense content.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">Film grain overlays the whole page at 3.5% opacity.</p>
            </CardContent>
            <CardFooter>
              <p className="font-mono text-xs text-muted">radius sm 12 · md 16 · lg 20</p>
            </CardFooter>
          </Card>
        </div>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex max-w-md flex-col gap-2">
          <Input placeholder="Type without losing focus…" aria-label="Sample input" />
          <div className="flex gap-2">
            <Badge>default</Badge>
            <Badge variant="outline">outline</Badge>
          </div>
        </div>
      </Section>

      <Section title="Evidence states">
        <div className="flex flex-wrap gap-2">
          {EVIDENCE_STATES.map((s) => (
            <EvidenceBadge key={s} state={s} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {EVIDENCE_STATES.map((s) => (
            <EvidenceChip key={s} state={s} label={`src: workspace item`} />
          ))}
        </div>
      </Section>

      <Section title="Scores (methodology always shown)">
        <div className="glass flex flex-wrap items-center gap-8 rounded-md p-6">
          <ScoreRing value={87} label="Match" />
          <div className="flex min-w-60 flex-1 flex-col gap-4">
            <FactorBar name="Required skills" weight={0.4} value={92} />
            <FactorBar name="Preferred skills" weight={0.15} value={70} />
            <FactorBar name="Experience" weight={0.2} value={85} />
            <FactorBar name="Education" weight={0.1} value={100} />
            <FactorBar name="Projects & achievements" weight={0.15} value={80} />
            <p className="text-xs text-muted">
              Weighted 40/15/20/10/15. This is not a probability of being hired.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Sync & staleness">
        <div className="flex flex-wrap items-center gap-4">
          <SyncIndicator syncedAt="2026-10-16T09:00:00.000Z" />
          <SyncIndicator syncing />
          <StaleBadge />
        </div>
      </Section>

      <Section title="Loading state">
        <div className="flex max-w-md flex-col gap-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Section>

      <Section title="AppShell skeleton">
        <div className="overflow-hidden rounded-md border border-white/[0.08]">
          <AppShell>
            <p className="py-8 text-center text-sm text-muted">
              AppShell preview: sidebar · topbar · ⌘K palette · toasts
            </p>
          </AppShell>
        </div>
        <p className="text-sm text-muted">
          <Link href="/workspace" className="text-accent-cyan underline underline-offset-4">
            Open the live shell
          </Link>{" "}
          — every sidebar route renders a milestone placeholder, no dead ends.
        </p>
      </Section>
    </div>
  );
}
