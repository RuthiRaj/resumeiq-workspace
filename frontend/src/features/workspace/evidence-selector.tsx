"use client";

import type { EvidenceState } from "@/lib/schemas";
import { EVIDENCE_META, EVIDENCE_ORDER } from "./evidence";
import { cn } from "@/lib/utils";

/**
 * Evidence-state selector (PRD §4.2, §6.1 WS-2). Each option explains what the
 * state actually means, so nothing is claimed without the user knowing, and a
 * "Verified" choice without supporting evidence is rejected by the form
 * schema with an explanation.
 */
export function EvidenceSelector({
  value,
  onChange,
  error,
  invalid,
}: {
  value: EvidenceState;
  onChange: (next: EvidenceState) => void;
  error?: string;
  invalid?: boolean;
}) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-invalid={invalid ? true : undefined}
      aria-describedby={error ? "evidence-error" : undefined}
    >
      <legend className="text-sm font-medium text-text">Evidence state</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {EVIDENCE_ORDER.map((state) => {
          const meta = EVIDENCE_META[state];
          const checked = value === state;
          return (
            <label
              key={state}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-sm border p-3 transition-colors duration-200",
                checked
                  ? "border-accent-cyan/50 bg-white/[0.06]"
                  : "border-white/[0.08] hover:bg-white/[0.04]",
              )}
            >
              <input
                type="radio"
                name="evidence-state"
                value={state}
                checked={checked}
                onChange={() => onChange(state)}
                data-field="evidence"
                className="mt-1 size-4 accent-[var(--riq-accent-cyan)]"
              />
              <span className="min-w-0">
                <span className={cn("flex items-center gap-1.5 text-sm font-medium", meta.text)}>
                  <span aria-hidden="true" className={cn("size-2 rounded-full", meta.dot)} />
                  {meta.label}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {meta.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="evidence-error" role="alert" className="text-xs text-evidence-missing">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
