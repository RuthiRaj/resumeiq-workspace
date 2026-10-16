"use client";

import { useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { FAQ_ITEMS } from "@/components/marketing/faq-data";
import { cn } from "@/lib/utils";

/**
 * FAQ accordion island (client): expand/collapse behaviour only. All copy
 * comes from `faq-data` and SSRs as static HTML from the server section.
 */
export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-8 flex flex-col gap-3">
      {FAQ_ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="glass overflow-hidden rounded-sm">
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
              <m.div
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
              </m.div>
            )}
          </div>
        );
      })}
    </div>
  );
}
