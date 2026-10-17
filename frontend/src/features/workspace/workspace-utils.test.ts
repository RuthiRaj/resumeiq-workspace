import { describe, expect, it } from "vitest";
import type { EvidenceState, WorkspaceItem } from "@/lib/schemas";
import {
  computeCompleteness,
  countBySection,
  describeChange,
  evidenceCounts,
  formatRelativeTime,
  moveWithin,
  normalizeFormValues,
  reorderIds,
  toCreatePayload,
  toItemPatch,
  weakestEvidence,
} from "./workspace-utils";
import { WORKSPACE_SECTION_ORDER } from "@/lib/schemas";
import { EVIDENCE_META } from "./evidence";

function item(
  id: string,
  section: WorkspaceItem["section"],
  evidence: EvidenceState,
  order = 0,
  deletedAt?: string,
): WorkspaceItem {
  return {
    id,
    section,
    title: `Item ${id}`,
    bullets: [],
    tags: [],
    links: [],
    attachments: [],
    evidence,
    order,
    deletedAt,
  };
}

describe("workspace-utils: ordering helpers (PRD §6.1 WS-6)", () => {
  it("moveWithin shifts an item and clamps out-of-range targets", () => {
    expect(moveWithin(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveWithin(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveWithin(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    // Clamps instead of throwing, and never mutates the input.
    const input = ["a", "b", "c"];
    expect(moveWithin(input, 0, 99)).toEqual(["b", "c", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("reorderIds derives the new id order from a drag (active -> over)", () => {
    expect(reorderIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    // Unknown ids are a no-op, not a crash.
    expect(reorderIds(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });
});

describe("workspace-utils: evidence + completeness (PRD §7.7)", () => {
  const items = [
    item("1", "project", "verified"),
    item("2", "project", "related"),
    item("3", "skill", "attested"),
  ];

  it("counts items per section while ignoring soft-deleted rows", () => {
    const withDeleted = [...items, item("4", "project", "attested", 1, "2026-10-17T00:00:00.000Z")];
    expect(countBySection(withDeleted)).toEqual({ project: 2, skill: 1 });
    expect(evidenceCounts(withDeleted)).toEqual({
      verified: 1,
      attested: 1,
      related: 1,
      missing: 0,
    });
  });

  it("surfaces the weakest evidence state present", () => {
    expect(weakestEvidence(items)).toBe("related");
    expect(weakestEvidence([item("1", "skill", "verified")])).toBe("verified");
    expect(weakestEvidence([])).toBeNull();
  });

  it("returns an explainable completeness breakdown that never reaches 100 without coverage", () => {
    const perfect = WORKSPACE_SECTION_ORDER.map((section, index) =>
      item(`s${index}`, section, "verified"),
    );
    const full = computeCompleteness(perfect);
    expect(full.score).toBe(100);
    expect(full.coveredSections).toBe(full.totalSections);

    const partial = computeCompleteness(items);
    // 2/12 sections covered (60%) + 0.633 evidence (40%) => ~49.
    expect(partial.score).toBeLessThan(full.score);
    expect(partial.score).toBeGreaterThan(0);
    expect(partial.evidenceScore).toBeCloseTo(
      (EVIDENCE_META.verified.weight +
        EVIDENCE_META.related.weight +
        EVIDENCE_META.attested.weight) /
        3,
      5,
    );
  });

  it("scores an empty workspace at zero", () => {
    expect(computeCompleteness([])).toMatchObject({ score: 0, coveredSections: 0 });
  });
});

describe("workspace-utils: form mapping (PRD §6.1 WS-3)", () => {
  const values = {
    title: "  Staff Engineer  ",
    organization: "Northwind  ",
    startDate: "2023-02",
    endDate: "",
    location: "  ",
    bullets: ["  Led the team  ", "   ", ""],
    tags: ["typescript", "  "],
    links: ["https://example.com", ""],
    attachments: [],
    evidence: "attested" as const,
  };

  it("normalizeFormValues trims and drops blank rows", () => {
    const normalized = normalizeFormValues(values);
    expect(normalized.title).toBe("Staff Engineer");
    expect(normalized.bullets).toEqual(["Led the team"]);
    expect(normalized.tags).toEqual(["typescript"]);
    expect(normalized.links).toEqual(["https://example.com"]);
    expect(normalized.location).toBe("");
  });

  it("toCreatePayload carries the section and drops empty optional fields", () => {
    expect(toCreatePayload("experience", values)).toMatchObject({
      section: "experience",
      title: "Staff Engineer",
      organization: "Northwind",
      endDate: undefined,
      location: undefined,
      bullets: ["Led the team"],
      order: 0,
    });
  });

  it("toItemPatch never changes the section or order", () => {
    const patch = toItemPatch(values);
    expect(patch).not.toHaveProperty("section");
    expect(patch).not.toHaveProperty("order");
    expect(patch.title).toBe("Staff Engineer");
  });

  it("describes change-log rows readably, with and without a label", () => {
    expect(describeChange({ op: "add", label: "React" })).toBe("Added “React”");
    expect(describeChange({ op: "delete" })).toBe("Deleted an item");
  });
});

describe("workspace-utils: relative time", () => {
  const now = "2026-10-17T12:00:00.000Z";
  it("formats recent timestamps naturally", () => {
    expect(formatRelativeTime("2026-10-17T11:59:30.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-17T11:30:00.000Z", now)).toBe("30m ago");
    expect(formatRelativeTime("2026-10-17T06:00:00.000Z", now)).toBe("6h ago");
    expect(formatRelativeTime("2026-10-15T12:00:00.000Z", now)).toBe("2d ago");
    expect(formatRelativeTime("not-a-date", now)).toBe("");
  });
});
