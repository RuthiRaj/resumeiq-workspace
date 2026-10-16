"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  FileText,
  History,
  Home,
  Lock,
  Settings,
  Target,
  Briefcase,
} from "lucide-react";
import { useUiStore } from "@/features/ui/ui-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/workspace", label: "Workspace", icon: Home },
  { href: "/resume", label: "Standard resume", icon: FileText },
  { href: "/targets", label: "Job targets", icon: Target },
  { href: "/history", label: "History", icon: History },
  { href: "/privacy", label: "Privacy", icon: Lock },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Authenticated app shell: sidebar + topbar + command-palette placeholder
 * (PRD §7.6). Full command palette + auth gating land in F2.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, commandPaletteOpen, setCommandPaletteOpen } =
    useUiStore();

  // ⌘K / Ctrl+K toggles the palette placeholder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
      }
      if (e.key === "Escape") setCommandPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandPaletteOpen, commandPaletteOpen]);

  return (
    <div className="flex min-h-screen bg-bg text-text">
      {/* Sidebar */}
      <aside
        data-app-chrome
        aria-label="Primary navigation"
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-white/[0.08] bg-surface/80 backdrop-blur-xl transition-[width] duration-200",
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
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors duration-200",
                  active
                    ? "bg-white/[0.08] text-text"
                    : "text-muted hover:bg-white/[0.04] hover:text-text",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {!sidebarCollapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="m-2 rounded-sm px-3 py-2 text-xs text-muted hover:bg-white/[0.04] hover:text-text"
        >
          {sidebarCollapsed ? "→" : "← Collapse"}
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-app-chrome
          className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-white/[0.08] bg-bg/80 px-4 backdrop-blur-xl sm:px-6"
        >
          <span className="hidden items-center gap-2 text-xs text-muted sm:flex">
            <Briefcase className="size-3.5" aria-hidden="true" />
            Master Workspace
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Open command palette"
            className="flex items-center gap-2 rounded-sm border border-white/[0.08] bg-elevated px-3 py-1.5 text-xs text-muted hover:text-text"
          >
            <span aria-hidden="true">⌘K</span> Command
          </button>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      {/* Command palette placeholder (full palette lands in F2). */}
      {commandPaletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-[65] flex items-start justify-center bg-black/60 p-4 pt-[15vh]"
          onClick={() => setCommandPaletteOpen(false)}
        >
          <div
            className="glass w-full max-w-lg rounded-md p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium">Command palette</p>
            <p className="mt-1 text-xs text-muted">
              Search, navigation and quick actions land here in F2. Press Esc to close.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
