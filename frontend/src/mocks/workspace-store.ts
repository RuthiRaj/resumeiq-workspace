import {
  WORKSPACE_SECTION_ORDER,
  type Resume,
  type ResumeSection,
  type WorkspaceChangeLogEntry,
  type WorkspaceItem,
  type WorkspacePersona,
  type WorkspaceReorderInput,
  type WorkspaceSection,
} from "@/lib/schemas";
import {
  DEFAULT_PERSONA,
  WORKSPACE_FIXTURES,
  type WorkspaceSeed,
} from "./fixtures";

/**
 * Persistent mock workspace (PRD §6.1 WS-4/WS-5, §8.4). Everything lives in
 * `localStorage`, so it survives reloads; the real Supabase-backed store
 * replaces this at backend integration (B7) without changing the wire shapes.
 *
 * Rules enforced here (and re-enforced by the B1 backend later):
 *  - every mutation bumps `version` exactly once and appends change-log rows;
 *  - deletes are soft (`deletedAt`), so undo is a restore;
 *  - deleted items never appear in the workspace listing or the standard
 *    resume, and are never resurrected by a resume regeneration;
 *  - the derived standard resume always reports the current workspace version.
 */

export const WORKSPACE_KEY_PREFIX = "riq.workspace.";
export const PERSONA_KEY_PREFIX = "riq.workspace-persona.";
export const MOCK_FAILURES_KEY = "riq.mock-failures";

/** New workspaces start empty: a brand-new workspace has no invented data. */
const GENESIS_TIME = "2026-10-16T09:00:00.000Z";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredWorkspace {
  version: number;
  /** Includes soft-deleted items; use `activeItems()` to filter. */
  items: WorkspaceItem[];
  changelog: WorkspaceChangeLogEntry[];
  updatedAt: string;
}

export type Clock = () => string;

const isoClock: Clock = () => new Date().toISOString();

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyWorkspace(): StoredWorkspace {
  return { version: 1, items: [], changelog: [], updatedAt: GENESIS_TIME };
}

function seedFromFixture(persona: WorkspacePersona): StoredWorkspace {
  const seed: WorkspaceSeed = WORKSPACE_FIXTURES[persona];
  return {
    version: seed.version,
    items: deepClone(seed.items),
    changelog: deepClone(seed.changelog),
    updatedAt: seed.updatedAt,
  };
}

export function workspaceKey(userId: string): string {
  return `${WORKSPACE_KEY_PREFIX}${userId}`;
}

export function personaKey(userId: string): string {
  return `${PERSONA_KEY_PREFIX}${userId}`;
}

export function personaOf(storage: KeyValueStorage, userId: string): WorkspacePersona {
  const raw = storage.getItem(personaKey(userId));
  if (raw === "fresher" || raw === "midlevel" || raw === "empty") return raw;
  return DEFAULT_PERSONA;
}

function readWorkspace(storage: KeyValueStorage, userId: string): StoredWorkspace | null {
  try {
    const raw = storage.getItem(workspaceKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWorkspace;
    if (
      !parsed ||
      typeof parsed.version !== "number" ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.changelog)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeWorkspace(
  storage: KeyValueStorage,
  userId: string,
  ws: StoredWorkspace,
): void {
  storage.setItem(workspaceKey(userId), JSON.stringify(ws));
}

/** Loads the workspace, seeding a brand-new (empty) one on first access. */
export function loadWorkspace(
  storage: KeyValueStorage,
  userId: string,
): StoredWorkspace {
  const existing = readWorkspace(storage, userId);
  if (existing) return existing;
  const persona = personaOf(storage, userId);
  const ws = persona === "empty" ? emptyWorkspace() : seedFromFixture(persona);
  writeWorkspace(storage, userId, ws);
  return ws;
}

export function activeItems(ws: StoredWorkspace): WorkspaceItem[] {
  return ws.items
    .filter((item) => !item.deletedAt)
    .sort((a, b) => a.order - b.order);
}

export function itemsInSection(ws: StoredWorkspace, section: WorkspaceSection): WorkspaceItem[] {
  return activeItems(ws).filter((item) => item.section === section);
}

function nextSeq(ws: StoredWorkspace): number {
  return ws.changelog.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
}

/**
 * Applies a mutation to the stored workspace: bumps the version once, appends
 * one change-log row per affected item, and persists. Returns the new state.
 */
function commit(
  storage: KeyValueStorage,
  userId: string,
  mutate: (draft: StoredWorkspace) => void,
  entries: { itemId: string; op: WorkspaceChangeLogEntry["op"]; label?: string }[],
  now: Clock,
): StoredWorkspace {
  const ws = loadWorkspace(storage, userId);
  const at = now();
  ws.version += 1;
  ws.updatedAt = at;
  mutate(ws);
  let seq = nextSeq(ws);
  for (const entry of entries) {
    ws.changelog.push({
      seq: seq++,
      workspaceVersion: ws.version,
      itemId: entry.itemId,
      op: entry.op,
      at,
      label: entry.label,
    });
  }
  writeWorkspace(storage, userId, ws);
  return ws;
}

function itemLabel(item: Pick<WorkspaceItem, "title">): string {
  return item.title.trim() || "Untitled item";
}

/** Next display order within a section (active items only). */
function nextOrder(ws: StoredWorkspace, section: WorkspaceSection): number {
  const orders = itemsInSection(ws, section).map((item) => item.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function addItem(
  storage: KeyValueStorage,
  userId: string,
  input: Omit<WorkspaceItem, "id">,
  now: Clock = isoClock,
): StoredWorkspace {
  const item: WorkspaceItem = {
    ...input,
    id: `ws-item-${input.section}-${loadWorkspace(storage, userId).version + 1}-${input.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "item"}`,
    order: 0,
    deletedAt: undefined,
  };
  return commit(
    storage,
    userId,
    (draft) => {
      item.order = nextOrder(draft, item.section);
      draft.items.push(item);
    },
    [{ itemId: item.id, op: "add", label: itemLabel(item) }],
    now,
  );
}

export function updateItem(
  storage: KeyValueStorage,
  userId: string,
  id: string,
  patch: Partial<WorkspaceItem>,
  now: Clock = isoClock,
): StoredWorkspace {
  const existing = loadWorkspace(storage, userId).items.find((item) => item.id === id);
  const label = existing ? itemLabel({ ...existing, ...patch }) : undefined;
  return commit(
    storage,
    userId,
    (draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown workspace item: ${id}`);
      const next = { ...draft.items[index], ...patch, id, deletedAt: draft.items[index].deletedAt };
      draft.items[index] = next;
    },
    [{ itemId: id, op: "edit", label }],
    now,
  );
}

export function softDeleteItem(
  storage: KeyValueStorage,
  userId: string,
  id: string,
  now: Clock = isoClock,
): StoredWorkspace {
  return commit(
    storage,
    userId,
    (draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown workspace item: ${id}`);
      draft.items[index] = { ...draft.items[index], deletedAt: now() };
    },
    [{ itemId: id, op: "delete" }],
    now,
  );
}

export function restoreItem(
  storage: KeyValueStorage,
  userId: string,
  id: string,
  now: Clock = isoClock,
): StoredWorkspace {
  const existing = loadWorkspace(storage, userId).items.find((item) => item.id === id);
  const label = existing ? itemLabel(existing) : undefined;
  return commit(
    storage,
    userId,
    (draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Unknown workspace item: ${id}`);
      const next = { ...draft.items[index] };
      delete next.deletedAt;
      draft.items[index] = next;
    },
    [{ itemId: id, op: "restore", label }],
    now,
  );
}

export function reorderItems(
  storage: KeyValueStorage,
  userId: string,
  input: WorkspaceReorderInput,
  now: Clock = isoClock,
): StoredWorkspace {
  const labels = new Map(
    loadWorkspace(storage, userId).items.map((item) => [item.id, itemLabel(item)]),
  );
  return commit(
    storage,
    userId,
    (draft) => {
      input.orderedIds.forEach((id, index) => {
        const target = draft.items.find((item) => item.id === id && !item.deletedAt);
        if (target) target.order = index;
      });
    },
    input.orderedIds.map((id) => ({
      itemId: id,
      op: "reorder" as const,
      label: labels.get(id),
    })),
    now,
  );
}

/** Dev-only: swap the workspace for a fixture (or an empty one). */
export function setPersona(
  storage: KeyValueStorage,
  userId: string,
  persona: WorkspacePersona,
): StoredWorkspace {
  storage.setItem(personaKey(userId), persona);
  const ws = persona === "empty" ? emptyWorkspace() : seedFromFixture(persona);
  writeWorkspace(storage, userId, ws);
  return ws;
}

export function failuresEnabled(storage: KeyValueStorage): boolean {
  return storage.getItem(MOCK_FAILURES_KEY) === "on";
}

export function setFailures(storage: KeyValueStorage, enabled: boolean): void {
  storage.setItem(MOCK_FAILURES_KEY, enabled ? "on" : "off");
}

/**
 * Deterministic standard-resume derivation (PRD §6.3 SYN-1/2). No AI: it reads
 * the current non-deleted items only, so deleted information can never appear.
 * Claims are marked `confirmed` only when the source item is verified or
 * user-attested; related/missing items surface as needing confirmation.
 */
export function deriveStandardResume(ws: StoredWorkspace): Resume {
  const active = activeItems(ws);
  const sections: ResumeSection[] = [];
  for (const key of WORKSPACE_SECTION_ORDER) {
    const items = active.filter((item) => item.section === key);
    if (items.length === 0) continue;
    sections.push({
      key,
      claims: items.flatMap((item) => {
        const confirmed = item.evidence === "verified" || item.evidence === "attested";
        const dates = [item.startDate, item.endDate].filter(Boolean).join(" – ");
        const header = [item.title, item.organization, dates]
          .filter((part) => part && part.trim())
          .join(" · ");
        return [
          { text: header, evidenceIds: [item.id], confirmed },
          ...item.bullets
            .filter((bullet) => bullet.trim())
            .map((bullet) => ({ text: bullet, evidenceIds: [item.id], confirmed })),
        ];
      }),
    });
  }
  return {
    id: "resume-standard",
    kind: "standard",
    workspaceVersion: ws.version,
    stale: false,
    sections,
    createdAt: GENESIS_TIME,
    updatedAt: ws.updatedAt,
  };
}
