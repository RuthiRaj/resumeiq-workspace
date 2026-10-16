import { cn } from "@/lib/utils";

/** Weighted score-factor bar with methodology-friendly labels (PRD §6.5). */
export function FactorBar({
  name,
  weight,
  value,
  className,
}: {
  name: string;
  /** Fraction of 1, e.g. 0.40. */
  weight: number;
  /** Factor value 0–100. */
  value: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-text">{name}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {Math.round(clamped)} · wt {Math.round(weight * 100)}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name} factor score`}
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan transition-[width] duration-700 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
