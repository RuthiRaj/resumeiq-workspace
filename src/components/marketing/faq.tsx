"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  {
    q: "What is the workspace?",
    a: "Your private Master Workspace holds everything you can truthfully claim — education, skills, projects, internships, experience, achievements, certificates and more. You maintain it once; every resume is generated from it, so nothing drifts out of sync.",
  },
  {
    q: "How do resumes stay synced?",
    a: "Your standard resume regenerates automatically whenever you add, edit, delete or reorder workspace items, with a visible Synced indicator. Tailored resumes are snapshots: when the workspace changes they are marked Stale with a per-section diff, and your edits are never overwritten without your choice.",
  },
  {
    q: "What does the match score mean?",
    a: "A transparent weighted score (required skills 40%, preferred 15%, experience 20%, education 10%, projects 15%) showing how your evidenced background lines up with a job description. It is not a probability of being hired — the full factor breakdown is always shown.",
  },
  {
    q: "What does the ATS score mean?",
    a: "A deterministic readability check: standard headings, single-column layout, keyword coverage, consistent dates and titles, plus a text-extraction round trip on the exported file. It is based on defined checks, not a guarantee for any employer's ATS.",
  },
  {
    q: "How does AI use my data?",
    a: "AI only reads the text needed for the task — extraction, requirement parsing, section writing — after your explicit consent, and personal contact details are stripped before anything is sent. Scores and ATS checks run deterministically, without any model. Full provider disclosure lives in the privacy centre.",
  },
];

/** Accessible FAQ accordion (F1): native buttons, full keyboard support. */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();

  return (
    <section aria-labelledby="faq-heading" className="relative">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
          Questions
        </p>
        <h2 id="faq-heading" className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">
          Frequently asked
        </h2>
        <div className="mt-8 flex flex-col gap-3">
          {ITEMS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q}
                className="glass overflow-hidden rounded-sm"
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-panel-${i}`}
                    id={`faq-button-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium sm:text-base"
                  >
                    {item.q}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-4 shrink-0 text-muted transition-transform duration-200",
                        isOpen && "rotate-180",
                      )}
                    />
                  </button>
                </h3>
                {isOpen && (
                  <motion.div
                    id={`faq-panel-${i}`}
                    role="region"
                    aria-labelledby={`faq-button-${i}`}
                    initial={{ opacity: 0, height: reduceMotion ? "auto" : 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: "easeOut" }}
                  >
                    <p className="px-5 pb-5 text-sm leading-relaxed text-muted">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
