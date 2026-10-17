"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  FileUp,
  History,
  Home,
  Lock,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { useUiStore } from "@/features/ui/ui-store";
import { useAuthOptional } from "@/lib/auth/context";
import { toast } from "@/features/ui/toast-store";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

interface Entry {
  id: string;
  group: "Pages" | "Actions";
  label: string;
  hint?: string;
  keywords?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

/** Global command palette (Ctrl/Cmd+K): pages + quick actions, fully keyboard operable. */
export function CommandPalette() {
  const router = useRouter();
  const auth = useAuthOptional();
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState("");

  function handleOpenChange(next: boolean) {
    if (!next) setQuery("");
    setOpen(next);
  }

  const entries: Entry[] = useMemo(
    () => [
      { id: "ws", group: "Pages", label: "Go to Workspace", hint: "/workspace", icon: Home, run: () => router.push("/workspace") },
      { id: "resume", group: "Pages", label: "Go to Standard resume", hint: "/resume", icon: FileText, run: () => router.push("/resume") },
      { id: "targets", group: "Pages", label: "Go to Job targets", hint: "/targets", icon: Target, run: () => router.push("/targets") },
      { id: "new-target", group: "Pages", label: "Go to New job target", hint: "/targets/new", icon: Sparkles, run: () => router.push("/targets/new") },
      { id: "import", group: "Pages", label: "Go to Document import", hint: "/workspace/import", icon: FileUp, run: () => router.push("/workspace/import") },
      { id: "history", group: "Pages", label: "Go to History", hint: "/history", icon: History, run: () => router.push("/history") },
      { id: "privacy", group: "Pages", label: "Go to Privacy", hint: "/privacy", icon: Lock, run: () => router.push("/privacy") },
      { id: "settings", group: "Pages", label: "Go to Settings", hint: "/settings", icon: Settings, run: () => router.push("/settings") },
      {
        id: "act-target",
        group: "Actions",
        label: "New job target",
        keywords: "create add target job",
        icon: Plus,
        run: () => {
          toast({ tone: "info", title: "New job target", description: "Describe the role you're applying for." });
          router.push("/targets/new");
        },
      },
      {
        id: "act-item",
        group: "Actions",
        label: "Add workspace item",
        keywords: "create add workspace experience project skill",
        icon: Plus,
        run: () => {
          toast({ tone: "info", title: "Add a workspace item", description: "Pick the section to add to." });
          router.push("/workspace");
        },
      },
      ...(auth?.user
        ? [{
            id: "act-signout",
            group: "Actions" as const,
            label: "Sign out",
            keywords: "logout sign out",
            icon: LogOut,
            run: () => {
              void auth.signOut().then(() => {
                toast({ tone: "info", title: "Signed out" });
                router.replace("/signin");
              });
            },
          }]
        : []),
    ],
    [router, auth],
  );

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange} label="Command palette">
      <Command label="Command palette" shouldFilter filter={(value, search) => {
        if (!search.trim()) return 1;
        return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
      }}>
        <CommandInput
          placeholder="Search pages and actions…"
          aria-label="Search pages and actions"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList aria-label="Results">
          <CommandEmpty>
            No matches for “{query}”. Try “workspace”, “target” or “privacy”.
          </CommandEmpty>
          {(["Pages", "Actions"] as const).map((group) => (
            <CommandGroup key={group} heading={group}>
              {entries
                .filter((e) => e.group === group)
                .map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`${e.label} ${e.hint ?? ""} ${e.keywords ?? ""}`}
                    onSelect={() => {
                      setOpen(false);
                      e.run();
                    }}
                  >
                    <e.icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                    <span>{e.label}</span>
                    {e.hint ? <CommandShortcut>{e.hint}</CommandShortcut> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
