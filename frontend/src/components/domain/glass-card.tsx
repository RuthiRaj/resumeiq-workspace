import * as React from "react";
import { cn } from "@/lib/utils";

/** Frosted glass panel — the base surface for cards across the app (PRD §7.2). */
export function GlassCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-md text-text", className)} {...props} />;
}
