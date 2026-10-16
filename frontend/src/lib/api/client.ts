import type {
  AnalysisReport,
  JobTarget,
  Resume,
  Workspace,
  WorkspaceChangeLogEntry,
  WorkspaceItem,
} from "@/lib/schemas";

/**
 * Typed API client (PRD §8.3). Every network call goes through here so the
 * mock layer (MSW, `src/mocks/`) can later be swapped for the real FastAPI
 * backend without a UI rewrite. F0: endpoint shapes + types only.
 */
const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(`Request failed: ${res.status} ${res.statusText}`, res.status, path);
  }
  return (await res.json()) as T;
}

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
  deleteItem: (id: string) =>
    request<void>(`/workspace/items/${id}`, { method: "DELETE" }),

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
};
