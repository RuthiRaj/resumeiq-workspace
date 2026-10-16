import { FileCheck2, ListX, Scale } from "lucide-react";
import { GlassCard } from "@/components/domain/glass-card";

const POINTS = [
  {
    icon: FileCheck2,
    title: "Evidence-linked claims",
    copy: "Every bullet in a tailored resume opens its source workspace item. If it can't be traced, it doesn't ship.",
  },
  {
    icon: ListX,
    title: "Missing skills shown as missing",
    copy: "Unsupported requirements are labelled not-evidenced or genuinely missing — with a roadmap to close the gap, not a cover-up.",
  },
  {
    icon: Scale,
    title: "Scores explained, never promised",
    copy: "Match and ATS scores always show their methodology. They are never a hiring probability or an ATS guarantee.",
  },
];

/** Trust section + free-forever note (F1). No pricing language anywhere. */
export function Trust() {
  return (
    <section aria-labelledby="trust-heading" className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          Our guarantee
        </p>
        <h2 id="trust-heading" className="mt-3 max-w-2xl font-display text-4xl tracking-tight sm:text-5xl">
          We never invent your experience.
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, copy }) => (
            <GlassCard key={title} className="p-6">
              <Icon className="size-6 text-accent-cyan" aria-hidden="true" />
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{copy}</p>
            </GlassCard>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <p className="font-display text-2xl tracking-tight sm:text-3xl">
            Free, forever.
          </p>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            ResumeIQ is a personal project, free for every applicant. No
            subscriptions, no credits, no paywalls — your career data stays
            yours.
          </p>
        </div>
      </div>
    </section>
  );
}
