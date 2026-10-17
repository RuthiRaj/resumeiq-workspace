import { describe, expect, it } from "vitest";
import type { WorkspaceItem, WorkspaceSection } from "@/lib/schemas";
import {
  activeItems,
  addItem,
  deriveStandardResume,
  loadWorkspace,
  personaOf,
  reorderItems,
  restoreItem,
  setPersona,
  softDeleteItem,
  updateItem,
  type Clock,
  type KeyValueStorage,
} from "./workspace-store";

/**
 * F3 store rules (PRD §6.1 WS-4/WS-5/WS-6, §8.4). The store takes an
 * injectable storage + clock so versioning and change-log behaviour are
 * deterministic here — the same behaviour the B1 backend must reproduce.
 */

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const FIXED_TIME = "2026-10-17T10:00:00.000Z";
const fixedClock: Clock = () => FIXED_TIME;

const USER = "user-1";

function draft(
  section: WorkspaceSection,
  title: string,
  extra: Partial<Omit<WorkspaceItem, "id">> = {},
): Omit<WorkspaceItem, "id"> {
  return {
    section,
    title,
    bullets: [],
    tags: [],
    links: [],
    attachments: [],
    evidence: "attested",
    order: 0,
    ...extra,
  };
}

describe("mock workspace store: versioning + change log", () => {
  it("starts a brand-new workspace empty at version 1", () => {
    const ws = loadWorkspace(memoryStorage(), USER);
    expect(ws.version).toBe(1);
    expect(ws.items).toEqual([]);
    expect(ws.changelog).toEqual([]);
  });

  it("bumps the version exactly once per change and appends one log row", () => {
    const storage = memoryStorage();
    const created = addItem(storage, USER, draft("project", "First project"), fixedClock);
    expect(created.version).toBe(2);
    expect(created.changelog).toHaveLength(1);
    expect(created.changelog[0]).toMatchObject({
      op: "add",
      workspaceVersion: 2,
      label: "First project",
      at: FIXED_TIME,
    });

    const updated = updateItem(
      storage,
      USER,
      created.items[0].id,
      { title: "Renamed project" },
      fixedClock,
    );
    expect(updated.version).toBe(3);
    expect(updated.changelog).toHaveLength(2);
    expect(updated.changelog[1]).toMatchObject({ op: "edit", label: "Renamed project" });

    // A reorder that touches several ids is still a single version bump.
    const reordered = reorderItems(
      storage,
      USER,
      { section: "project", orderedIds: [created.items[0].id] },
      fixedClock,
    );
    expect(reordered.version).toBe(4);
    expect(reordered.changelog.at(-1)).toMatchObject({
      op: "reorder",
      workspaceVersion: 4,
    });
  });

  it("keeps change-log sequence numbers monotonic", () => {
    const storage = memoryStorage();
    addItem(storage, USER, draft("skill", "TypeScript"), fixedClock);
    addItem(storage, USER, draft("skill", "React"), fixedClock);
    const ws = loadWorkspace(storage, USER);
    const seqs = ws.changelog.map((entry) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(ws.changelog.map((entry) => entry.workspaceVersion)).toEqual([2, 3]);
  });
});

describe("mock workspace store: soft delete + undo", () => {
  it("hides a deleted item from the active list but keeps it in storage", () => {
    const storage = memoryStorage();
    addItem(storage, USER, draft("project", "Keep me"), fixedClock);
    const ws = addItem(storage, USER, draft("project", "Delete me"), fixedClock);
    const [keep, doomed] = ws.items;

    const afterDelete = softDeleteItem(storage, USER, doomed.id, fixedClock);
    expect(activeItems(afterDelete).map((item) => item.id)).toEqual([keep.id]);
    // Soft delete: the row is still stored, just flagged.
    expect(afterDelete.items.find((item) => item.id === doomed.id)?.deletedAt).toBe(FIXED_TIME);
    expect(afterDelete.changelog.at(-1)).toMatchObject({ op: "delete", itemId: doomed.id });
  });

  it("restores a deleted item (undo) and logs it as a restore, not an edit", () => {
    const storage = memoryStorage();
    const created = addItem(storage, USER, draft("skill", "Docker"), fixedClock);
    const id = created.items[0].id;
    softDeleteItem(storage, USER, id, fixedClock);
    const restored = restoreItem(storage, USER, id, fixedClock);

    expect(activeItems(restored).map((item) => item.id)).toEqual([id]);
    expect(restored.items.find((item) => item.id === id)?.deletedAt).toBeUndefined();
    // An undo is its own operation, so the history can distinguish it from an edit.
    expect(restored.changelog.at(-1)).toMatchObject({ op: "restore", itemId: id, label: "Docker" });
  });
});

describe("mock workspace store: ordering", () => {
  it("appends new items after existing ones in the same section", () => {
    const storage = memoryStorage();
    addItem(storage, USER, draft("skill", "One"), fixedClock);
    addItem(storage, USER, draft("skill", "Two"), fixedClock);
    const ws = addItem(storage, USER, draft("skill", "Three"), fixedClock);
    const skill = activeItems(ws).filter((item) => item.section === "skill");
    expect(skill.map((item) => item.title)).toEqual(["One", "Two", "Three"]);
    expect(skill.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it("renumbers a section to the requested id order", () => {
    const storage = memoryStorage();
    const first = addItem(storage, USER, draft("experience", "A"), fixedClock).items[0].id;
    const second = addItem(storage, USER, draft("experience", "B"), fixedClock).items[1].id;
    const third = addItem(storage, USER, draft("experience", "C"), fixedClock).items[2].id;

    const reordered = reorderItems(
      storage,
      USER,
      { section: "experience", orderedIds: [third, first, second] },
      fixedClock,
    );
    const titles = activeItems(reordered)
      .filter((item) => item.section === "experience")
      .map((item) => item.title);
    expect(titles).toEqual(["C", "A", "B"]);
  });

  it("never reorders a soft-deleted item back into the list", () => {
    const storage = memoryStorage();
    const a = addItem(storage, USER, draft("course", "A"), fixedClock).items[0].id;
    const b = addItem(storage, USER, draft("course", "B"), fixedClock).items[1].id;
    softDeleteItem(storage, USER, a, fixedClock);
    const reordered = reorderItems(
      storage,
      USER,
      { section: "course", orderedIds: [a, b] },
      fixedClock,
    );
    expect(activeItems(reordered).map((item) => item.id)).toEqual([b]);
  });
});

describe("mock workspace store: derived standard resume", () => {
  it("reports the current workspace version and never includes deleted items", () => {
    const storage = memoryStorage();
    addItem(
      storage,
      USER,
      draft("project", "Shipped app", {
        evidence: "verified",
        links: ["https://example.com/app"],
      }),
      fixedClock,
    );
    const gone = addItem(storage, USER, draft("project", "Discarded idea"), fixedClock).items[1].id;

    const afterDelete = softDeleteItem(storage, USER, gone, fixedClock);
    const resume = deriveStandardResume(afterDelete);

    expect(resume.workspaceVersion).toBe(afterDelete.version);
    expect(resume.stale).toBe(false);
    const texts = resume.sections.flatMap((section) => section.claims.map((claim) => claim.text));
    expect(texts.some((text) => text.includes("Shipped app"))).toBe(true);
    expect(texts.some((text) => text.includes("Discarded idea"))).toBe(false);
  });

  it("confirms verified/attested claims and flags related/missing as unconfirmed", () => {
    const storage = memoryStorage();
    addItem(storage, USER, draft("skill", "TypeScript", { evidence: "attested" }), fixedClock);
    addItem(storage, USER, draft("skill", "Kubernetes", { evidence: "related" }), fixedClock);
    const ws = loadWorkspace(storage, USER);
    const claims = deriveStandardResume(ws).sections.flatMap((section) => section.claims);

    expect(claims.find((claim) => claim.text === "TypeScript")?.confirmed).toBe(true);
    expect(claims.find((claim) => claim.text === "Kubernetes")?.confirmed).toBe(false);
  });
});

describe("mock workspace store: dev fixtures", () => {
  it("defaults to an empty persona and swaps to a fixture on request", () => {
    const storage = memoryStorage();
    expect(personaOf(storage, USER)).toBe("empty");

    const fresher = setPersona(storage, USER, "fresher");
    expect(personaOf(storage, USER)).toBe("fresher");
    expect(activeItems(fresher).length).toBeGreaterThan(0);

    const emptied = setPersona(storage, USER, "empty");
    expect(emptied.items).toEqual([]);
    expect(emptied.version).toBe(1);
  });
});
