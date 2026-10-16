import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "outline" | "verified" | "attested" | "related" | "missing";

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-white/[0.08] text-text",
  outline: "border border-white/[0.12] text-muted",
  verified: "bg-evidence-verified/15 text-evidence-verified",
  attested: "bg-evidence-attested/15 text-evidence-attested",
  related: "bg-evidence-related/15 text-evidence-related",
  missing: "bg-evidence-missing/15 text-evidence-missing",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
