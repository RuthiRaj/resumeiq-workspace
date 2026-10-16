"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconTooltip, TooltipProvider } from "@/components/ui/tooltip";

/** Live Radix-primitive demos for the F2 design-system showcase. */
export function OverlaysDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-wrap items-center gap-3">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">Open dialog</Button>
        </DialogTrigger>
        <DialogContent aria-label="Demo dialog">
          <DialogHeader>
            <DialogTitle>Radix dialog</DialogTitle>
            <DialogDescription>Focus-trapped, Esc to close, AA-contrast glass.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" onClick={() => setDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary" size="sm">Open sheet</Button>
        </SheetTrigger>
        <SheetContent aria-label="Demo sheet">
          <SheetHeader>
            <SheetTitle>Bottom sheet / side sheet</SheetTitle>
            <SheetDescription>Bottom on mobile, right-side on desktop.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">Open menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Demo menu</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Settings</DropdownMenuItem>
          <DropdownMenuItem>Privacy</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm">Open popover</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p className="px-2 py-1 text-sm">Quick-create style popover content.</p>
        </PopoverContent>
      </Popover>

      <IconTooltip label="Helpful tooltip">
        <Button variant="ghost" size="sm" aria-label="More info">?</Button>
      </IconTooltip>
    </div>
    </TooltipProvider>
  );
}

export function TabsDemo() {
  return (
    <Tabs defaultValue="import" className="max-w-md">
      <TabsList aria-label="Demo tabs">
        <TabsTrigger value="import">Import</TabsTrigger>
        <TabsTrigger value="manual">Manual</TabsTrigger>
      </TabsList>
      <TabsContent value="import" className="mt-3 text-sm text-muted">
        Review extracted fields side-by-side before anything is saved.
      </TabsContent>
      <TabsContent value="manual" className="mt-3 text-sm text-muted">
        Build your workspace section by section, with evidence states.
      </TabsContent>
    </Tabs>
  );
}
