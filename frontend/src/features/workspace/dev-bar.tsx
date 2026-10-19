"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, WifiOff } from "lucide-react";
import type { WorkspacePersona } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { toast } from "@/features/ui/toast-store";
import { workspaceKeys } from "./use-workspace";

const PERSONAS: { value: WorkspacePersona; label: string }[] = [
  { value: "empty", label: "Empty (new)" },
  { value: "fresher", label: "Fresher" },
  { value: "midlevel", label: "Mid-level dev" },
];

/**
 * The dev-only client lives in its own module and is loaded on demand, so a
 * production page chunk never contains it (`npm run check:dev-excluded`).
 */
async function devClient() {
  return (await import("@/lib/api/dev")).devApi;
}

/**
 * Dev-only fixture switcher + failure simulation (PRD §8.5, §7.7). Rendered
 * only under `next dev`; the API endpoints 404 anywhere else, so no real user
 * can reach it and no fixture data can leak into a production workspace.
 */
export function WorkspaceDevBar() {
  if (process.env.NODE_ENV !== "development") return null;
  return <DevBarInner />;
}

function DevBarInner() {
  const queryClient = useQueryClient();
  const devKey = ["dev", "workspace"] as const;
  const { data } = useQuery({
    queryKey: devKey,
    queryFn: async () => (await devClient()).getDevState(),
    staleTime: Infinity,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.root });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.standardResume() });
    void queryClient.invalidateQueries({ queryKey: devKey });
  }

  async function switchPersona(persona: WorkspacePersona) {
    try {
      const devApi = await devClient();
      await devApi.setWorkspacePersona(persona);
      refresh();
      toast({ tone: "info", title: "Fixture loaded", description: `Sample workspace: ${persona}.` });
    } catch {
      toast({ tone: "error", title: "Couldn’t load fixture" });
    }
  }

  async function toggleFailures() {
    const next = !data?.failures;
    try {
      const devApi = await devClient();
      await devApi.setMockFailures(next);
      refresh();
      toast({
        tone: next ? "error" : "success",
        title: next ? "Failure simulation on" : "Failure simulation off",
        description: next
          ? "Workspace requests will now fail so you can test error states."
          : "Workspace requests work again.",
      });
    } catch {
      toast({ tone: "error", title: "Couldn’t change the dev toggle" });
    }
  }

  return (
    <section
      aria-label="Development controls"
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-white/[0.16] bg-white/[0.03] p-3"
    >
      <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted">
        <FlaskConical className="size-3.5" aria-hidden="true" /> Dev only
      </span>
      <span className="text-xs text-muted">Sample workspace:</span>
      <div className="flex flex-wrap gap-1.5">
        {PERSONAS.map((persona) => {
          const active = data?.persona === persona.value;
          return (
            <Button
              key={persona.value}
              type="button"
              size="sm"
              variant={active ? "primary" : "secondary"}
              aria-pressed={active}
              onClick={() => void switchPersona(persona.value)}
            >
              {persona.label}
            </Button>
          );
        })}
      </div>
      <span className="ml-auto" />
      <Button
        type="button"
        size="sm"
        variant={data?.failures ? "danger" : "secondary"}
        aria-pressed={Boolean(data?.failures)}
        onClick={() => void toggleFailures()}
      >
        <WifiOff className="size-4" aria-hidden="true" />
        {data?.failures ? "Failures on" : "Simulate failure"}
      </Button>
    </section>
  );
}
