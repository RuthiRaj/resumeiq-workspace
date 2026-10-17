import type * as React from "react";
import { cn } from "@/lib/utils";

/** Designed empty state (PRD §7.7). Never a blank panel or a dead end. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass relative flex flex-col items-center gap-3 overflow-hidden rounded-md px-6 py-12 text-center",
        className,
      )}
    >
      <div aria-hidden="true" className="glow-violet pointer-events-none absolute -top-24 size-64" />
      {Icon ? (
        <span className="relative flex size-12 items-center justify-center rounded-full border border-white/[0.12] bg-elevated">
          <Icon className="size-5 text-accent-cyan" />
        </span>
      ) : null}
      <h2 className="relative text-base font-medium text-text">{title}</h2>
      <p className="relative max-w-md text-sm leading-relaxed text-muted">{description}</p>
      {children ? <div className="relative mt-2 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
