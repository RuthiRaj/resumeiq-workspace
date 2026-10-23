import { HttpResponse } from "msw";
import { loadSession } from "@/lib/auth/store";
import { shouldFail, type FailureScope } from "./dev-state";
import { activeItems, loadWorkspace } from "./workspace-store";

/**
 * Shared helpers for the mock handlers (PRD §8.4). Handlers run in the browser
 * worker, so `window.localStorage` is always available and state survives
 * reloads exactly like the real backend will.
 */

export function storage(): Storage {
  return window.localStorage;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default request latency: long enough that loading states are real. */
export async function latency(ms = 350): Promise<void> {
  await sleep(ms);
}

/** "Slow AI" latency for upload + extraction (PRD §8.4: 3–8s AI work). */
export async function providerLatency(ms = 1_700): Promise<void> {
  await sleep(ms);
}

/** Identity of the caller for the mock store (mock auth session). */
export function currentUserId(): string {
  return loadSession(storage())?.user.id ?? "guest";
}

/** Dev-only failure simulation (PRD §7.7 error states, §8.4). */
export function failIfEnabled(scope: FailureScope = "all") {
  if (shouldFail(scope)) {
    return HttpResponse.json(
      {
        error:
          "Simulated offline failure (dev toggle). Turn it off in the workspace dev bar.",
      },
      { status: 503 },
    );
  }
  return null;
}

/** Wire shape of `GET /workspace` (deleted items are never returned). */
export function workspaceBody(userId: string) {
  const ws = loadWorkspace(storage(), userId);
  return { version: ws.version, items: activeItems(ws), updatedAt: ws.updatedAt };
}
