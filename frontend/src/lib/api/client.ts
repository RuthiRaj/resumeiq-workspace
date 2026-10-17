import type {
  AnalysisReport,
  JobTarget,
  Resume,
  Workspace,
  WorkspaceChangeLogEntry,
  WorkspaceItem,
  WorkspacePersona,
  WorkspaceReorderInput,
} from "@/lib/schemas";
import type { Consent } from "@/lib/privacy/consent";

/**
 * Typed API client (PRD §8.3). Every network call goes through here so the
 * mock layer (MSW, `src/mocks/`) can later be swapped for the real FastAPI
 * backend without a UI rewrite. F0: endpoint shapes + types only.
 */
const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Best-effort extraction of a server error message ({error} or FastAPI {detail}). */
function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    const detail = record.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      const message = (detail as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      errorMessage(body, `Request failed: ${res.status} ${res.statusText}`),
      res.status,
      path,
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  // --- Workspace (B1 contract) ---
  getWorkspace: () => request<Workspace>("/workspace"),
  getChangeLog: () => request<WorkspaceChangeLogEntry[]>("/workspace/changelog"),
  createItem: (item: Omit<WorkspaceItem, "id">) =>
    request<WorkspaceItem>("/workspace/items", {
      method: "POST",
      body: JSON.stringify(item),
    }),
  updateItem: (id: string, patch: Partial<WorkspaceItem>) =>
    request<WorkspaceItem>(`/workspace/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  /** Soft delete (PRD §6.1 WS-5). Undo = `restoreItem`. */
  deleteItem: (id: string) =>
    request<void>(`/workspace/items/${id}`, { method: "DELETE" }),
  restoreItem: (id: string) =>
    request<WorkspaceItem>(`/workspace/items/${id}/restore`, { method: "POST" }),
  reorderItems: (input: WorkspaceReorderInput) =>
    request<Workspace>("/workspace/reorder", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // --- Standard resume (B1 contract) ---
  getStandardResume: () => request<Resume>("/resume/standard"),

  // --- Job targets + analysis (B4 contract) ---
  listTargets: () => request<JobTarget[]>("/targets"),
  createTarget: (input: Omit<JobTarget, "id" | "status" | "createdAt" | "updatedAt">) =>
    request<JobTarget>("/targets", { method: "POST", body: JSON.stringify(input) }),
  getAnalysis: (targetId: string) =>
    request<AnalysisReport>(`/targets/${targetId}/analysis`),

  // --- Tailored resumes + history (B5 contract) ---
  getTailoredResume: (targetId: string) =>
    request<Resume>(`/targets/${targetId}/resume`),
  listVersions: () => request<Resume[]>("/resumes"),

  // --- Privacy (B6 contract) ---
  exportData: () => request<unknown>("/privacy/export"),
  deleteAccount: () => request<void>("/privacy/account", { method: "DELETE" }),

  // --- AI-processing consent (PRD EX-3; F2 mock) ---
  getConsent: () => request<{ consent: Consent | null }>("/privacy/consent"),
  recordConsent: (input: { aiProcessing: boolean }) =>
    request<{ consent: Consent }>("/privacy/consent", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // --- Dev-only fixture controls (no-op outside `next dev`) ---
  getDevState: () =>
    request<{ persona: WorkspacePersona; failures: boolean }>("/dev/workspace-persona"),
  setWorkspacePersona: (persona: WorkspacePersona) =>
    request<{ ok: true }>("/dev/workspace-persona", {
      method: "POST",
      body: JSON.stringify({ persona }),
    }),
  setMockFailures: (enabled: boolean) =>
    request<{ enabled: boolean }>("/dev/failures", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
};
