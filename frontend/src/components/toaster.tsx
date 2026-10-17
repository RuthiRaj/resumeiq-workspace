"use client";

import { useToastStore } from "@/features/ui/toast-store";
import { cn } from "@/lib/utils";

const toneRing: Record<string, string> = {
  info: "border-accent-cyan/40",
  success: "border-evidence-verified/40",
  error: "border-evidence-missing/40",
};

const toneDot: Record<string, string> = {
  info: "bg-accent-cyan",
  success: "bg-evidence-verified",
  error: "bg-evidence-missing",
};

/** Bottom-right toast stack (custom minimal; Radix Toast lands in F2). */
export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,360px)] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "glass pointer-events-auto flex items-start gap-3 rounded-sm p-3 shadow-xl",
            toneRing[t.tone],
          )}
        >
          <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", toneDot[t.tone])} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">{t.title}</p>
            {t.description ? (
              <p className="mt-0.5 text-xs text-muted">{t.description}</p>
            ) : null}
            {t.action ? (
              <button
                type="button"
                className="mt-1.5 rounded-sm border border-white/[0.16] px-2 py-0.5 text-xs font-medium text-text hover:bg-white/[0.08]"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onAction();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 rounded p-1 text-muted hover:text-text"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
