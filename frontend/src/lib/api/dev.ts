import type { WorkspacePersona } from "@/lib/schemas";
import { apiRequest } from "./client";

/**
 * Development-only endpoints (PRD §8.4 error states, §8.5 fixtures).
 *
 * These live in their own module, imported only by the dev-gated dev bar and
 * failure banner. In a production build `process.env.NODE_ENV !== "development"`
 * makes both of those components dead code, so this module — and the failure
 * toggle with it — never reaches the production bundle. The endpoints also
 * answer 404 outside `next dev` (ADR-024), so no real user can reach them.
 */
export const devApi = {
  getDevState: () =>
    apiRequest<{ persona: WorkspacePersona; failures: boolean }>(
      "/dev/workspace-persona",
    ),
  setWorkspacePersona: (persona: WorkspacePersona) =>
    apiRequest<{ ok: true }>("/dev/workspace-persona", {
      method: "POST",
      body: JSON.stringify({ persona }),
    }),
  setMockFailures: (enabled: boolean) =>
    apiRequest<{ enabled: boolean }>("/dev/failures", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
};
