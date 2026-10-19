"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/**
 * Same placement contract as `DropdownMenuContent`: below the trigger, aligned
 * to its end edge, 8px side offset, an 8px collision gutter to the viewport and
 * an internal scroll area when the content is taller than the room below.
 */
export function PopoverContent({
  className,
  side = "bottom",
  align = "end",
  alignOffset = 0,
  sideOffset = 8,
  collisionPadding = 8,
  avoidCollisions = true,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions={avoidCollisions}
        className={cn(
          "glass z-[70] max-h-[var(--radix-popover-content-available-height)] w-64",
          "overflow-x-hidden overflow-y-auto rounded-sm p-1.5 text-text shadow-2xl",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
