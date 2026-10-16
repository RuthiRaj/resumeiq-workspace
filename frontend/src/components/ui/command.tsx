"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

/**
 * Command palette building blocks (cmdk) + a Radix Dialog shell so focus
 * trapping, Esc and ARIA come from the platform (PRD §7.7).
 */
export const Command = CommandPrimitive;

export function CommandDialog({
  open,
  onOpenChange,
  children,
  label = "Command palette",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={label}
        className="top-[15vh] max-w-lg translate-y-0 gap-0 overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Visually hidden title keeps Radix accessible without visual noise. */}
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <DialogDescription className="sr-only">
          Type to search pages and actions. Arrow keys move, Enter runs.
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.08] px-4">
      <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <CommandPrimitive.Input
        className={cn(
          "h-12 w-full bg-transparent text-sm text-text outline-none",
          "placeholder:text-muted/70",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn("max-h-80 overflow-y-auto p-2", className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("px-4 py-8 text-center text-sm text-muted", className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.2em] [&_[cmdk-group-heading]]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  // NOTE: cmdk always renders data-disabled ("true" or "false"), so a
  // data-[disabled] selector would match every item. Gate on the aria value
  // instead — cmdk sets aria-disabled="true" only when actually disabled.
  return (
    <CommandPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-text outline-none",
        "aria-selected:bg-white/[0.08] aria-[disabled=true]:pointer-events-none aria-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto font-mono text-[11px] text-muted", className)}
      {...props}
    />
  );
}
