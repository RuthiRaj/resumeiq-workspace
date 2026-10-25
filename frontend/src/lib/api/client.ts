import { z } from "zod";
import { apiBaseUrl, isLiveMode } from "@/lib/config/mode";
import {
  AnalysisReportSchema,
  AnalysisRunResponseSchema,
  AccountDeletionResultSchema,
  CapabilitiesSchema,
  ImportConfirmResponseSchema,
  ImportReviewItemSchema,
  ImportSessionSchema,
  ImportSummarySchema,
  JobTargetSchema,
  ResumeDiffSchema,
  ResumePurgeResultSchema,
  ResumeRefreshResultSchema,
  ResumeSchema,
  ResumeSummarySchema,
  ResumeVersionPurgeResultSchema,
  ResumeVersionSchema,
  UserDataExportSchema,
  WorkspaceChangeLogEntrySchema,
  WorkspaceItemSchema,
  WorkspaceSchema,
  reviewItemToWorkspaceInputs,
  type AccountDeletionResult,
  type AnalysisReport,
  type AnalysisRunResponse,
  type Capabilities,
  type ImportItemStatus,
  type ImportItemValues,
  type ImportReviewItem,
  type ImportSession,
  type ImportSummary,
  type ImportSupport,
  type JobTarget,
  type Resume,
  type ResumeGenerateRequest,
  type ResumePurgeResult,
  type ResumeRefreshRequest,
  type ResumeSectionEdit,
  type ResumeVersionPurgeResult,
  type TargetCreateValues,
  type UserDataExport,
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
    /** Response headers, kept for binary routes such as the PDF export check. */
    public readonly responseHeaders?: Headers,
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
  analysis_required:
    "Run the analysis for this target before generating a resume.",
  analysis_stale:
    "Your workspace changed after this analysis. Re-run it before generating a resume.",
  report_not_ready: "The report isn't ready yet. Try again in a moment.",
  analysis_failed: "That analysis failed. Start a new run.",
  target_not_found: "That job target no longer exists.",
  resume_not_found: "That resume no longer exists.",
  resume_section_not_found: "That section isn't part of this resume.",
  resume_not_tailored:
    "The standard resume is derived from your workspace and cannot be edited.",
  resume_evidence_not_found:
    "One of the cited workspace items no longer exists. Cite an item that is still in your workspace.",
  resume_claim_ungrounded:
    "This line adds facts that aren't in the cited evidence. Remove or correct the invented detail, or cite stronger evidence.",
  resume_version_not_found: "That resume version no longer exists.",
  ai_not_configured:
    "AI rewording is unavailable until a provider is configured on the server.",
  export_verification_failed:
    "The PDF failed the text-extraction check, so it was not delivered. Your resume is unchanged; try again.",
  data_export_unavailable:
    "Data export is unavailable right now. Nothing was changed; try again.",
  account_deletion_unavailable:
    "Account deletion is unavailable right now. Nothing was deleted; try again.",
  account_confirmation_required:
    "Type “delete my account” exactly to confirm. Nothing was deleted.",
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
  responseHeaders?: Headers,
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
    responseHeaders,
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
      res.headers,
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

  // --- Tailored resumes + history (B5 contract §6) ---
  listResumes: () => request("/resumes", undefined, ResumeSummarySchema.array()),
  getResume: (resumeId: string) =>
    request(`/resumes/${encodeURIComponent(resumeId)}`, undefined, ResumeSchema),
  generateResume: (targetId: string, input: ResumeGenerateRequest) =>
    request(
      `/targets/${encodeURIComponent(targetId)}/resume`,
      { method: "POST", body: JSON.stringify(input) },
      ResumeSchema,
    ),
  editResumeSection: (
    resumeId: string,
    sectionKey: string,
    input: ResumeSectionEdit,
  ) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/sections/${encodeURIComponent(sectionKey)}`,
      { method: "PATCH", body: JSON.stringify(input) },
      ResumeSchema,
    ),
  listResumeVersions: (resumeId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/versions`,
      undefined,
      ResumeVersionSchema.array(),
    ),
  restoreResumeVersion: (resumeId: string, versionId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST" },
      ResumeSchema,
    ),
  markResumeStale: (resumeId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/stale`,
      { method: "POST" },
      ResumeSchema,
    ),
  getResumeDiff: (resumeId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/diff`,
      undefined,
      ResumeDiffSchema,
    ),
  refreshResume: (resumeId: string, input: ResumeRefreshRequest) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/refresh`,
      { method: "POST", body: JSON.stringify(input) },
      ResumeRefreshResultSchema,
    ),

  // --- Resume deletion + purge (B6 contract §9) ---
  /** Permanently delete a tailored resume and every saved version. */
  deleteResume: (resumeId: string) =>
    request<void>(`/resumes/${encodeURIComponent(resumeId)}`, {
      method: "DELETE",
    }),
  /** Permanently delete one saved version. */
  deleteResumeVersion: (resumeId: string, versionId: string) =>
    request<void>(
      `/resumes/${encodeURIComponent(resumeId)}/versions/${encodeURIComponent(versionId)}`,
      { method: "DELETE" },
    ),
  /** Rewrite away claims that cite deleted workspace items (never deletes). */
  purgeResume: (resumeId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/purge`,
      { method: "POST" },
      ResumePurgeResultSchema,
    ),
  purgeResumeVersion: (resumeId: string, versionId: string) =>
    request(
      `/resumes/${encodeURIComponent(resumeId)}/versions/${encodeURIComponent(versionId)}/purge`,
      { method: "POST" },
      ResumeVersionPurgeResultSchema,
    ),

  // --- Capabilities + privacy (B6 contract §9) ---
  getCapabilities: () =>
    request("/capabilities", undefined, CapabilitiesSchema),
  exportData: () =>
    request("/export", undefined, UserDataExportSchema),
  /** `confirmation` must be the exact phrase; a typo deletes nothing. */
  deleteAccount: (confirmation: string) =>
    request(
      "/account",
      { method: "DELETE", body: JSON.stringify({ confirmation }) },
      AccountDeletionResultSchema,
    ),

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
  AccountDeletionResult,
  AnalysisReport,
  AnalysisRunResponse,
  Capabilities,
  ImportReviewItem,
  ImportSession,
  ImportSummary,
  JobTarget,
  Resume,
  ResumePurgeResult,
  ResumeVersionPurgeResult,
  UserDataExport,
  Workspace,
  WorkspaceChangeLogEntry,
  WorkspaceItem,
};
