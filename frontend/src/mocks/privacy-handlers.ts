import { http, HttpResponse } from "msw";
import type { Capabilities } from "@/lib/schemas";
import { currentUserId, failIfEnabled, latency, storage } from "./context";
import { buildMockDataExport, deleteMockUserData } from "./privacy-store";

/**
 * Mock parity for B6 privacy routes (contract-proposals §9).
 *
 * `GET /capabilities` reports feature switches only. Mock mode has a
 * deterministic stand-in reworder, so it reports AI as configured — the same
 * answer the F5 build-time flag used to fake, now from the real shape.
 * `GET /export` and `DELETE /account` operate on the same localStorage stores
 * the other mock endpoints use.
 */

function detail(status: number, code: string, message: string) {
  return HttpResponse.json({ detail: { code, message } }, { status });
}

export const mockCapabilities: Capabilities = {
  ai: { configured: true, analysisEnrichment: true, resumeRewording: true },
  pdfExport: true,
  dataExport: true,
  accountDeletion: { dataDeletion: true, authUserDeletion: false },
};

export const privacyHandlers = [
  http.get("/api/v1/capabilities", async () => {
    await latency(120);
    // Scoped failure: proves the UI's fail-closed default without breaking
    // every other read on the page.
    return failIfEnabled("capabilities") ?? HttpResponse.json(mockCapabilities);
  }),

  http.get("/api/v1/export", async () => {
    await latency();
    const failed = failIfEnabled();
    if (failed) {
      return detail(
        503,
        "data_export_unavailable",
        "The data export is unavailable right now. Nothing was changed.",
      );
    }
    const at = new Date().toISOString();
    const body = buildMockDataExport(storage(), currentUserId(), at);
    return HttpResponse.json(body, {
      headers: {
        "Content-Disposition": `attachment; filename="resumeiq-data-export-${at.slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }),

  http.delete("/api/v1/account", async ({ request }) => {
    await latency();
    const failed = failIfEnabled();
    if (failed) {
      return detail(
        503,
        "account_deletion_unavailable",
        "Account deletion is unavailable right now. Nothing was deleted.",
      );
    }
    const raw = (await request.json().catch(() => null)) as
      | { confirmation?: unknown }
      | null;
    const phrase =
      typeof raw?.confirmation === "string"
        ? raw.confirmation.trim().toLowerCase()
        : "";
    if (phrase !== "delete my account") {
      return detail(
        400,
        "account_confirmation_required",
        "Type “delete my account” exactly to confirm. Nothing was deleted.",
      );
    }
    return HttpResponse.json(deleteMockUserData(storage(), currentUserId()));
  }),
];
