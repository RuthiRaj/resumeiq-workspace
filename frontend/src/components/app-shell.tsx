"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FileUp,
  History,
  Home,
  Lock,
  LogOut,
  Menu,
  Plus,
  Settings,
  Target,
} from "lucide-react";
import { useUiStore } from "@/features/ui/ui-store";
import { useAuthOptional } from "@/lib/auth/context";
import { toast } from "@/features/ui/toast-store";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/command-palette";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { IconTooltip, TooltipProvider } from "@/components/ui/tooltip";

const NAV = [
  { href: "/workspace", label: "Workspace", icon: Home },
  { href: "/resume", label: "Standard resume", icon: FileText },
  { href: "/targets", label: "Job targets", icon: Target },
  { href: "/history", label: "History", icon: History },
  { href: "/privacy", label: "Privacy", icon: Lock },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Mobile bottom bar shows the four daily destinations; the rest live in More. */
const MOBILE_NAV = NAV.slice(0, 4);

const CRUMBS: Record<string, string> = {
  workspace: "Workspace",
  resume: "Standard resume",
  targets: "Job targets",
  new: "New",
  import: "Import",
  history: "History",
  privacy: "Privacy",
  settings: "Settings",
  onboarding: "Onboarding",
  analysis: "Analysis",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean).slice(0, 3);
  if (segments.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs text-muted sm:flex">
      {segments.map((seg, i) => {
        const href = `/${segments.slice(0, i + 1).join("/")}`;
        const last = i === segments.length - 1;
        return (
          <span key={href} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <span aria-hidden="true">/</span> : null}
            {last ? (
              <span aria-current="page" className="truncate text-text">
                {CRUMBS[seg] ?? seg}
              </span>
            ) : (
              <Link href={href} className="shrink-0 transition-colors hover:text-text">
                {CRUMBS[seg] ?? seg}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors duration-200",
        active ? "bg-white/[0.08] text-text" : "text-muted hover:bg-white/[0.04] hover:text-text",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

function UserMenu() {
  const router = useRouter();
  const auth = useAuthOptional();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (!auth?.user) {
    return (
      <Link href="/signin">
        <Button size="sm">Sign in</Button>
      </Link>
    );
  }

  const { user, signOut } = auth;
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      toast({ tone: "info", title: "Signed out", description: "See you soon." });
      setConfirmOpen(false);
      router.replace("/signin");
      router.refresh();
    } catch {
      toast({ tone: "error", title: "Sign out failed", description: "Try again." });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Account menu for ${user.name}`}
          className="flex size-9 items-center justify-center rounded-full border border-white/[0.12] bg-elevated font-mono text-xs text-text transition-colors hover:bg-white/[0.08]"
        >
          <span aria-hidden="true">{initials || "•"}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>
            <span className="block truncate text-sm font-medium text-text">{user.name}</span>
            <span className="block truncate text-xs">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <Settings className="size-4 text-muted" aria-hidden="true" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/privacy")}>
            <Lock className="size-4 text-muted" aria-hidden="true" /> Privacy
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirmOpen(true)}>
            <LogOut className="size-4 text-muted" aria-hidden="true" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-label="Confirm sign out">
          <DialogHeader>
            <DialogTitle>Sign out?</DialogTitle>
            <DialogDescription>
              Your mock session on this browser will end. Your workspace data stays saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={signingOut}>
              Stay signed in
            </Button>
            <Button variant="danger" onClick={doSignOut} disabled={signingOut} aria-busy={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuickCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" aria-label="Create new" aria-haspopup="menu">
          <Plus className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">New</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent role="menu" aria-label="Create new">
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-white/[0.06]"
          onClick={() => {
            setOpen(false);
            toast({ tone: "info", title: "New job target", description: "Describe the role you're applying for." });
            router.push("/targets/new");
          }}
        >
          <Target className="size-4 text-muted" aria-hidden="true" /> New job target
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-white/[0.06]"
          onClick={() => {
            setOpen(false);
            toast({ tone: "info", title: "Add a workspace item", description: "Pick the section to add to." });
            router.push("/workspace");
          }}
        >
          <Plus className="size-4 text-muted" aria-hidden="true" /> Add workspace item
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-white/[0.06]"
          onClick={() => {
            setOpen(false);
            router.push("/workspace/import");
          }}
        >
          <FileUp className="size-4 text-muted" aria-hidden="true" /> Import documents
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Authenticated app shell: collapsible desktop sidebar, mobile bottom nav +
 * sheet, topbar (breadcrumbs, quick-create, palette, user menu).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarCollapsed, toggleSidebar, setCommandPaletteOpen } =
    useUiStore();
  const [moreOpen, setMoreOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandPaletteOpen]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen bg-bg text-text">
        {/* Desktop sidebar */}
        <aside
          data-app-chrome
          aria-label="Primary navigation"
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/[0.08] bg-surface/80 backdrop-blur-xl transition-[width] duration-200 md:flex",
            sidebarCollapsed ? "w-16" : "w-60",
          )}
        >
          <div className="flex h-16 items-center gap-2 px-4">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-sm bg-gradient-to-br from-accent-violet to-accent-cyan font-display text-lg text-white">
              R
            </span>
            {!sidebarCollapsed && (
              <span className="text-sm font-semibold tracking-tight">ResumeIQ</span>
            )}
          </div>
          <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Primary">
            {NAV.map(({ href, label, icon }) => (
              <SidebarLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                collapsed={sidebarCollapsed}
                active={pathname === href || pathname?.startsWith(`${href}/`)}
              />
            ))}
          </nav>
          <div className="p-2">
            <IconTooltip label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!sidebarCollapsed}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-xs text-muted hover:bg-white/[0.04] hover:text-text"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="size-4" aria-hidden="true" />
                ) : (
                  <>
                    <ChevronLeft className="size-4" aria-hidden="true" /> Collapse
                  </>
                )}
              </button>
            </IconTooltip>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
          <header
            data-app-chrome
            className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-white/[0.08] bg-bg/80 px-4 backdrop-blur-xl sm:px-6"
          >
            <Link href="/workspace" className="flex items-center gap-2 md:hidden" aria-label="ResumeIQ workspace">
              <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-sm bg-gradient-to-br from-accent-violet to-accent-cyan font-display text-base text-white">
                R
              </span>
            </Link>
            <Breadcrumbs pathname={pathname ?? "/"} />
            <div className="flex-1" />
            <QuickCreate />
            <IconTooltip label="Open command palette (Ctrl+K)">
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Open command palette"
                className="flex items-center gap-2 rounded-sm border border-white/[0.08] bg-elevated px-3 py-1.5 text-xs text-muted hover:text-text"
              >
                <span aria-hidden="true" className="font-mono">⌘K</span>
                <span className="hidden sm:inline">Command</span>
              </button>
            </IconTooltip>
            <UserMenu />
          </header>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
        </div>

        {/* Mobile bottom navigation */}
        <nav
          data-app-chrome
          aria-label="Mobile navigation"
          className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-white/[0.08] bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
        >
          {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-sm px-1 py-2 text-[11px]",
                  active ? "text-text" : "text-muted",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                <span aria-hidden="true" className="truncate">{label.split(" ")[0]}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Open all navigation"
            aria-haspopup="dialog"
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-sm px-1 py-2 text-[11px] text-muted"
          >
            <Menu className="size-5" aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>

        {/* Mobile "More" sheet with the full destination list */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent aria-label="All destinations">
            <SheetHeader>
              <SheetTitle>All destinations</SheetTitle>
              <SheetDescription>Every section of your workspace, in one place.</SheetDescription>
            </SheetHeader>
            <nav className="mt-4 flex flex-col gap-1" aria-label="All">
              {NAV.map(({ href, label, icon }) => (
                <SidebarLink
                  key={href}
                  href={href}
                  label={label}
                  icon={icon}
                  collapsed={false}
                  active={pathname === href || pathname?.startsWith(`${href}/`)}
                  onNavigate={() => setMoreOpen(false)}
                />
              ))}
            </nav>
            <div className="mt-4 border-t border-white/[0.08] pt-4">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setMoreOpen(false);
                  setCommandPaletteOpen(true);
                }}
              >
                Open command palette
              </Button>
              <Button
                variant="ghost"
                className="mt-2 w-full"
                onClick={() => {
                  setMoreOpen(false);
                  router.push("/onboarding");
                }}
              >
                Revisit onboarding
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <CommandPalette />
      </div>
    </TooltipProvider>
  );
}
