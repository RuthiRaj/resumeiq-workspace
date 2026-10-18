import type {
  ImportSession,
  ImportSummary,
  ImportReviewItem,
  ImportItemValues,
  ImportSupport,
  ImportItemStatus,
} from "@/lib/schemas";
import { buildImportSession } from "./import-fixtures";
import type { KeyValueStorage } from "./workspace-store";

/**
 * Persistent import sessions (PRD §6.2 IM-2). A session is only a *review*:
 * confirming an item is what writes it into the workspace (through the normal
 * `POST /workspace/items` endpoint), so "nothing enters the workspace until
 * confirmed" is enforced by the flow rather than by a flag.
 */

export const IMPORTS_KEY_PREFIX = "riq.imports.";

interface StoredImports {
  sessions: ImportSession[];
}

export type Clock = () => string;

export function importsKey(userId: string): string {
  return `${IMPORTS_KEY_PREFIX}${userId}`;
}

function emptyState(): StoredImports {
  return { sessions: [] };
}

export function loadImports(
  storage: KeyValueStorage,
  userId: string,
): StoredImports {
  try {
    const raw = storage.getItem(importsKey(userId));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as StoredImports;
    if (!parsed || !Array.isArray(parsed.sessions)) return emptyState();
    return { sessions: parsed.sessions };
  } catch {
    return emptyState();
  }
}

function saveImports(
  storage: KeyValueStorage,
  userId: string,
  state: StoredImports,
): void {
  storage.setItem(importsKey(userId), JSON.stringify(state));
}

export function listImportSummaries(
  storage: KeyValueStorage,
  userId: string,
): ImportSummary[] {
  return loadImports(storage, userId)
    .sessions.map((session) => ({
      id: session.id,
      fileName: session.fileName,
      fileType: session.fileType,
      itemCount: session.items.length,
      pendingCount: session.items.filter((item) => item.status === "pending")
        .length,
      confirmedCount: session.items.filter((item) => item.status === "confirmed")
        .length,
      createdAt: session.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getImport(
  storage: KeyValueStorage,
  userId: string,
  importId: string,
): ImportSession | null {
  return (
    loadImports(storage, userId).sessions.find(
      (session) => session.id === importId,
    ) ?? null
  );
}

export function createImport(
  storage: KeyValueStorage,
  userId: string,
  input: { fileName: string; fileType: ImportSession["fileType"]; fileSize: number },
  now: Clock,
): ImportSession {
  const state = loadImports(storage, userId);
  const at = now();
  const session = buildImportSession({
    id: `imp-${state.sessions.length + 1}-${input.fileName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20)}`,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    now: at,
  });
  state.sessions = [...state.sessions, session];
  saveImports(storage, userId, state);
  return session;
}

export interface ImportItemPatch {
  values?: ImportItemValues;
  status?: ImportItemStatus;
  support?: ImportSupport | null;
}

/** Updates one review item (values, decision or attached evidence). */
export function updateImportItem(
  storage: KeyValueStorage,
  userId: string,
  importId: string,
  itemId: string,
  patch: ImportItemPatch,
  now: Clock,
): ImportReviewItem | null {
  const state = loadImports(storage, userId);
  const session = state.sessions.find((candidate) => candidate.id === importId);
  if (!session) return null;
  const index = session.items.findIndex((item) => item.id === itemId);
  if (index === -1) return null;

  const current = session.items[index];
  const decided = patch.status !== undefined && patch.status !== "pending";
  const next: ImportReviewItem = {
    ...current,
    values: patch.values ?? current.values,
    status: patch.status ?? current.status,
    support: patch.support !== undefined ? patch.support : current.support,
    decidedAt: decided ? (current.decidedAt ?? now()) : current.decidedAt ?? null,
  };
  session.items[index] = next;
  session.updatedAt = now();
  saveImports(storage, userId, state);
  return next;
}
