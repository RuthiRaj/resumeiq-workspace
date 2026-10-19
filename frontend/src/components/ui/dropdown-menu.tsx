"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSeparator = DropdownMenuPrimitive.Separator;

/**
 * Every menu in the app opens on the same axis: below its trigger, aligned to
 * the trigger's end edge, with an 8px side offset. `collisionPadding` keeps an
 * 8px gutter to the viewport edge, and `overflow-y-auto` + the Radix
 * available-height variable keep a long menu (the workspace quick-add has 12
 * entries) fully reachable on short viewports instead of clipping off-screen.
 *
 * z-index 70 is the app's overlay layer: above the sticky chrome (40), the film
 * grain (60) and dialog/sheet surfaces (65/66), below tooltips (75).
 */
export function DropdownMenuContent({
  className,
  side = "bottom",
  align = "end",
  alignOffset = 0,
  sideOffset = 8,
  collisionPadding = 8,
  avoidCollisions = true,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        side={side}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions={avoidCollisions}
        className={cn(
          "glass z-[70] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-52",
          "overflow-x-hidden overflow-y-auto rounded-sm p-1.5 text-text shadow-2xl",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-sm outline-none",
        "focus:bg-white/[0.08] focus:text-text data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2.5 py-1.5 text-xs text-muted", className)}
      {...props}
    />
  );
}
