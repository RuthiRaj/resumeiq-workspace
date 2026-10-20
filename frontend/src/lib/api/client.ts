import { z } from "zod";
import { apiBaseUrl, isLiveMode } from "@/lib/config/mode";
import {
  AnalysisReportSchema,
  AnalysisRunResponseSchema,
  ImportConfirmResponseSchema,
  ImportReviewItemSchema,
  ImportSessionSchema,
  ImportSummarySchema,
  JobTargetSchema,
  ResumeSchema,
  WorkspaceChangeLogEntrySchema,
  WorkspaceItemSchema,
  WorkspaceSchema,
  reviewItemToWorkspaceInputs,
  type AnalysisReport,
  type AnalysisRunResponse,
  type ImportItemStatus,
  type ImportItemValues,
  type ImportReviewItem,
  type ImportSession,
  type ImportSummary,
  type ImportSupport,
  type JobTarget,
  type Resume,
  type TargetCreateValues,
  type Workspace,
  type WorkspaceChangeLogEntry,
  type WorkspaceItem,
  type WorkspaceReorderInput,
} from "@/lib/schemas";
import type { Consent } from "@/lib/privacy/consent";
import { accessToken } from "./token";

/**
 * Typed API client (PRD §8.3). Every network call goes through here, so the
 * transport can switch between MSW (`mock`, the default) and the FastAPI
 * backend (`live`, I1) without a screen changing. Every response is parsed
 * with the same Zod schema the mock handlers satisfy.
 *
 * Development-only endpoints (fixture switcher, failure simulation) live in
 * `./dev` so that a production build cannot contain them — see ADR-027.
 *
 * Privacy: nothing here logs a token, a request body or response body. Errors
 * carry the server's own message and an error code only.
 */
const MOCK_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    /** Backend envelope `detail.code` (e.g. `consent_required`), when present. */
    public readonly code?: string,
    /** `Retry-After` in milliseconds, when the server sent one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Copy used only when the backend sends a code without a message. Backend
 * messages are already user-facing, so they always win.
 */
const CODE_FALLBACKS: Record<string, string> = {
  rate_limited: "Too many requests. Wait a moment and try again.",
  payload_too_large: "That file is too large. Files must be 5 MB or smaller.",
  consent_required:
    "Grant AI-processing consent before running an analysis.",
  ai_consent_required:
    "Grant AI-processing consent before running an analysis.",
  analysis_not_found: "That analysis no longer exists.",
  report_not_ready: "The report isn't ready yet. Try again in a moment.",
  analysis_failed: "That analysis failed. Start a new run.",
  target_not_found: "That job target no longer exists.",
  import_not_found: "That import session no longer exists.",
  import_item_not_found: "That review item no longer exists.",
  unreadable_document:
    "We couldn't read that document. Try another PDF or DOCX.",
  not_available_in_live_mode:
    "That feature isn't connected to the live backend yet.",
};

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Auth provider seam: a 401 means the Bearer token is no longer valid. The
 * handler clears the browser session and sends the user to sign-in.
 */
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | null,
): void {
  unauthorizedHandler = handler;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code && CODE_FALLBACKS[error.code] && !error.message) {
      return CODE_FALLBACKS[error.code];
    }
    return error.message || fallback;
  }
  return fallback;
}

interface ErrorEnvelope {
  error?: unknown;
  detail?: unknown;
}

/** Pulls `{detail:{code,message}}` (FastAPI), `{detail:"…"}` or `{error}` apart. */
export function errorFromBody(
  body: unknown,
  status: number,
  path: string,
  retryAfterMs?: number,
): ApiError {
  let message = "";
  let code: string | undefined;
  if (body && typeof body === "object") {
    const record = body as ErrorEnvelope & Record<string, unknown>;
    if (typeof record.error === "string") message = record.error;
    if (typeof record.detail === "string") message = record.detail;
    if (record.detail && typeof record.detail === "object") {
      const detail = record.detail as Record<string, unknown>;
      if (typeof detail.message === "string") message = detail.message;
      if (typeof detail.code === "string") code = detail.code;
    }
  }
  const fallback = code ? CODE_FALLBACKS[code] : undefined;
  return new ApiError(
    message || fallback || `Request failed: ${status}`,
    status,
    path,
    code,
    retryAfterMs,
  );
}

/**
 * `Retry-After` is either delay-seconds or an HTTP date. The backend sends
 * seconds. Cap it at a day so a bad header cannot park the poller forever.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.min(at - Date.now(), 24 * 60 * 60 * 1000));
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  schema?: z.ZodType<T>,
): Promise<T> {
  const live = isLiveMode();
  const base = live ? `${apiBaseUrl()}${MOCK_BASE}` : MOCK_BASE;
  const headers = new Headers(init?.headers);
  const body = init?.body;
  if (body !== undefined && !isFormData(body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (live) {
    const token = await accessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      "We couldn't reach the server. Check your connection and try again.",
      0,
      path,
      "network",
    );
  }

  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const errorBody = await res.json().catch(() => null);
    throw errorFromBody(
      errorBody,
      res.status,
      path,
      parseRetryAfter(res.headers.get("Retry-After")),
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    throw new ApiError(
      "The server returned an unreadable response. Try again.",
      502,
      path,
      "invalid_response",
    );
  }
  if (!schema) return parsedBody as T;
  const parsed = schema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new ApiError(
      "The server returned a response this app doesn't understand. Refresh and try again.",
      502,
      path,
      "invalid_response",
    );
  }
  return parsed.data;
}

/** Shared by the dev-only client in `./dev`; not part of the public API surface. */
export { request as apiRequest };

function unavailable(path: string): never {
  throw new ApiError(
    "That feature isn't connected to the live backend yet. It stays available in mock mode.",
    501,
    path,
    "not_available_in_live_mode",
  );
}

export const api = {
  // --- Workspace (B1 contract) ---
  getWorkspace: () => request("/workspace", undefined, WorkspaceSchema),
  getChangeLog: () =>
    request("/workspace/changelog", undefined, WorkspaceChangeLogEntrySchema.array()),
  createItem: (item: Omit<WorkspaceItem, "id">) =>
    request("/workspace/items", {
      method: "POST",
      body: JSON.stringify(item),
    }, WorkspaceItemSchema),
  updateItem: (id: string, patch: Partial<WorkspaceItem>) =>
    request(`/workspace/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }, WorkspaceItemSchema),
  /** Soft delete (PRD §6.1 WS-5). Undo = `restoreItem`. */
  deleteItem: (id: string) =>
    request<void>(`/workspace/items/${id}`, { method: "DELETE" }),
  restoreItem: (id: string) =>
    request(`/workspace/items/${id}/restore`, { method: "POST" }, WorkspaceItemSchema),
  reorderItems: (input: WorkspaceReorderInput) =>
    request("/workspace/reorder", {
      method: "POST",
      body: JSON.stringify(input),
    }, WorkspaceSchema),

  // --- Standard resume (B1 contract) ---
  getStandardResume: () => request("/resume/standard", undefined, ResumeSchema),

  // --- Job targets + analysis (B4 contract) ---
  listTargets: () => request("/targets", undefined, JobTargetSchema.array()),
  getTarget: (targetId: string) =>
    request(`/targets/${targetId}`, undefined, JobTargetSchema),
  createTarget: (input: TargetCreateValues) =>
    request("/targets", { method: "POST", body: JSON.stringify(input) }, JobTargetSchema),
  /** Starts (or restarts) an analysis run and returns the first run frame. */
  startAnalysis: (targetId: string) =>
    request(`/targets/${targetId}/analysis`, { method: "POST" }, AnalysisRunResponseSchema),
  /** Polls the run; the mock advances it from elapsed time. */
  getAnalysisRun: (targetId: string) =>
    request(`/targets/${targetId}/analysis/run`, undefined, AnalysisRunResponseSchema),
  getAnalysis: (targetId: string) =>
    request(`/targets/${targetId}/analysis`, undefined, AnalysisReportSchema),

  // --- Imports + extraction review (B2 contract) ---
  /** Multipart upload; the live backend parses the document, the mock does not. */
  uploadImport: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request("/imports", {
      method: "POST",
      body: form,
      headers: {},
    }, z.object({ import: ImportSessionSchema }));
  },
  listImports: () => request("/imports", undefined, ImportSummarySchema.array()),
  getImport: (importId: string) =>
    request(`/imports/${importId}`, undefined, ImportSessionSchema),
  updateImportItem: (
    importId: string,
    itemId: string,
    patch: {
      values?: ImportItemValues;
      status?: ImportItemStatus;
      support?: ImportSupport | null;
    },
  ) =>
    request(`/imports/${importId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }, ImportReviewItemSchema),

  /**
   * Confirm a reviewed card.
   *
   * Live, a normal card is confirmed atomically by the backend. A skills card
   * is one card holding many chips, which the backend confirm route (one
   * workspace item per review item) cannot express, so that case creates one
   * workspace item per chip and then marks the card confirmed — the same shape
   * the mock uses (ADR-033).
   */
  confirmImportItem: async (
    importId: string,
    item: ImportReviewItem,
  ): Promise<{ items: WorkspaceItem[]; review: ImportReviewItem }> => {
    const isSkillsCard = item.extraction.section === "skill";
    if (!isLiveMode() || isSkillsCard) {
      const inputs = reviewItemToWorkspaceInputs(item);
      const items: WorkspaceItem[] = [];
      for (const input of inputs) {
        items.push(
          await request("/workspace/items", {
            method: "POST",
            body: JSON.stringify(input),
          }, WorkspaceItemSchema),
        );
      }
      const review = await request(`/imports/${importId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "confirmed",
          values: item.values,
          support: item.support,
        }),
      }, ImportReviewItemSchema);
      return { items, review };
    }
    const result = await request(
      `/imports/${importId}/items/${item.id}/confirm`,
      { method: "POST" },
      ImportConfirmResponseSchema,
    );
    return { items: [result.item], review: result.review };
  },

  // --- Tailored resumes + history (not in the live backend yet) ---
  getTailoredResume: async (targetId: string): Promise<Resume> => {
    if (isLiveMode()) unavailable(`/targets/${targetId}/resume`);
    return request(`/targets/${targetId}/resume`, undefined, ResumeSchema);
  },
  listVersions: async (): Promise<Resume[]> => {
    if (isLiveMode()) unavailable("/resumes");
    return request("/resumes", undefined, ResumeSchema.array());
  },

  // --- Privacy (not in the live backend yet) ---
  exportData: async (): Promise<unknown> => {
    if (isLiveMode()) unavailable("/privacy/export");
    return request<unknown>("/privacy/export");
  },
  deleteAccount: async (): Promise<void> => {
    if (isLiveMode()) unavailable("/privacy/account");
    return request<void>("/privacy/account", { method: "DELETE" });
  },

  // --- AI-processing consent (PRD EX-3) ---
  /**
   * Live consent lives in `consent_records` (the table the backend checks).
   * The backend has no consent route yet, so the browser writes it through the
   * Supabase Data API with the user's own JWT and RLS applies (ADR-033).
   */
  getConsent: async (): Promise<{ consent: Consent | null }> => {
    if (isLiveMode()) {
      const { getLiveConsent } = await import("@/lib/privacy/live-consent");
      return { consent: await getLiveConsent() };
    }
    return request<{ consent: Consent | null }>("/privacy/consent");
  },
  recordConsent: async (input: {
    aiProcessing: boolean;
  }): Promise<{ consent: Consent }> => {
    if (isLiveMode()) {
      const { recordLiveConsent } = await import("@/lib/privacy/live-consent");
      return { consent: await recordLiveConsent(input.aiProcessing) };
    }
    return request<{ consent: Consent }>("/privacy/consent", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  // --- Dev-only fixture controls live in `./dev` (see ADR-027) ---
  /** Writes the three demo job targets (PRD §8.5). Development only. */
  createSampleTargets: async (): Promise<{ targets: JobTarget[] }> => {
    if (isLiveMode()) unavailable("/dev/sample-targets");
    return request<{ targets: JobTarget[] }>("/dev/sample-targets", {
      method: "POST",
    });
  },
};

export type {
  AnalysisReport,
  AnalysisRunResponse,
  ImportReviewItem,
  ImportSession,
  ImportSummary,
  JobTarget,
  Resume,
  Workspace,
  WorkspaceChangeLogEntry,
  WorkspaceItem,
};
