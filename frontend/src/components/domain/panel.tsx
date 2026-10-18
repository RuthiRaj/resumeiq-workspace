import type { ReactNode } from "react";
import { GlassCard } from "./glass-card";
import { cn } from "@/lib/utils";

/**
 * Titled content panel. Used for report sections and form groups so headings
 * are always real headings in document order (PRD §7.7 accessibility), with a
 * stable `id` for `aria-labelledby`.
 */
export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <GlassCard
      className={cn("flex flex-col gap-4 p-4 sm:p-5", className)}
      {...(headingId ? { "aria-labelledby": headingId } : {})}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-sm font-medium text-text">
            {title}
          </h2>
          {description ? (
            <p className="max-w-prose text-xs leading-relaxed text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn("flex flex-col gap-3", bodyClassName)}>{children}</div>
    </GlassCard>
  );
}
