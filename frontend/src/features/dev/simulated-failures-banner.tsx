"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceKeys } from "@/features/workspace/use-workspace";

/**
 * Global, unmissable warning while the dev failure simulation is on
 * (PRD §7.7: no silent failures; §8.4 error states). The state is in-memory
 * (`src/mocks/dev-state.ts`), so a reload always starts clean — this banner is
 * the visible "way back" for the session where it *is* on.
 *
 * Dev only, and excluded from the production bundle rather than merely hidden:
 * `next build` compiles `process.env.NODE_ENV` to `"production"` and this
 * component renders nothing, and the dev-only API is loaded through a dynamic
 * import so no production page chunk contains it
 * (`npm run check:dev-excluded`, ADR-026).
 */
export function SimulatedFailuresBanner() {
  if (process.env.NODE_ENV !== "development") return null;
  return <BannerInner />;
}

const DEV_KEY = ["dev", "workspace"] as const;

/** The dev-only client lives outside the shared chunk; load it on demand. */
async function devClient() {
  return (await import("@/lib/api/dev")).devApi;
}

function BannerInner() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: DEV_KEY,
    queryFn: async () => (await devClient()).getDevState(),
    staleTime: Infinity,
  });

  if (!data?.failures) return null;

  async function turnOff() {
    const devApi = await devClient();
    await devApi.setMockFailures(false);
    await queryClient.invalidateQueries({ queryKey: workspaceKeys.root });
    await queryClient.invalidateQueries({ queryKey: workspaceKeys.standardResume() });
    await queryClient.invalidateQueries({ queryKey: DEV_KEY });
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[45] flex justify-center px-4">
      <div
        role="alert"
        data-testid="simulated-failures-banner"
        className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-evidence-missing/60 bg-[#2a121a]/95 px-3 py-2 shadow-2xl backdrop-blur-xl"
      >
        <WifiOff className="size-4 shrink-0 text-evidence-missing" aria-hidden="true" />
        <p className="text-xs text-text sm:text-sm">
          <span className="font-medium">Simulated failures are ON.</span>{" "}
          <span className="text-muted">
            The mock API is returning errors (dev only) — this affects nothing real.
          </span>
        </p>
        <Button size="sm" variant="danger" onClick={() => void turnOff()} className="shrink-0">
          <X className="size-3.5" aria-hidden="true" />
          Turn off
        </Button>
      </div>
    </div>
  );
}
