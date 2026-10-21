import { describe, expect, it } from "vitest";
import type {
  Resume,
  ResumeEvidence,
  ResumeSection,
  WorkspaceItem,
} from "@/lib/schemas";
import { buildResumeDiff } from "./diff";
import { aiRewordAvailability } from "./ai";
import { evidenceFromItem } from "./evidence";
import { mergeRefresh } from "./refresh";

function item(
  id: string,
  overrides: Partial<WorkspaceItem> = {},
): WorkspaceItem {
  return {
    id,
    section: "experience",
    title: "Software Engineer",
    organization: "Northwind Labs",
    startDate: "2023-02",
    endDate: "2023-04",
    location: "Remote",
    bullets: ["Owned the billing service's read path."],
    tags: ["typescript"],
    links: [],
    attachments: [],
    evidence: "verified",
    order: 0,
    deletedAt: null,
    ...overrides,
  };
}

function claim(text: string, evidenceIds: string[]) {
  return {
    text,
    evidenceIds,
    confirmed: true,
    aiRewritten: false,
    removed: false,
  };
}

function section(key: string, claims: ResumeSection["claims"]): ResumeSection {
  return { key, claims };
}

const resume: Pick<Resume, "id" | "targetId" | "workspaceVersion" | "stale"> = {
  id: "resume-1",
  targetId: "target-1",
  workspaceVersion: 2,
  stale: false,
};

describe("buildResumeDiff", () => {
  it("separates added, removed and edited source items without counting reorders", () => {
    const original = item("exp-1");
    const snapshot: ResumeEvidence[] = [
      evidenceFromItem(original),
      evidenceFromItem(
        item("project-1", {
          section: "project",
          title: "PDF exporter",
          organization: null,
        }),
      ),
    ];
    const reordered = item("exp-1", { order: 9, title: "Software Engineer II" });
    const added = item("exp-2", {
      title: "Platform Engineer",
      order: 1,
    });
    const removed = item("project-1", {
      section: "project",
      title: "PDF exporter",
      deletedAt: "2026-10-21T10:00:00.000Z",
    });

    const diff = buildResumeDiff(resume, snapshot, [reordered, added, removed], 3);

    expect(diff.stale).toBe(true);
    expect(diff.added.map((entry) => entry.itemId)).toEqual(["exp-2"]);
    expect(diff.removed.map((entry) => entry.itemId)).toEqual(["project-1"]);
    expect(diff.edited.map((entry) => entry.itemId)).toEqual(["exp-1"]);
    expect(diff.changedSections).toEqual(["experience", "project"]);
    expect(diff.removedEvidenceIds).toEqual(["project-1"]);
  });

  it("does not mark a pure workspace reorder as an edit", () => {
    const original = item("exp-1");
    const moved = item("exp-1", { order: 12 });

    const diff = buildResumeDiff(
      { ...resume, workspaceVersion: 2, stale: false },
      [evidenceFromItem(original)],
      [moved],
      2,
    );

    expect(diff.edited).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.stale).toBe(false);
  });
});

describe("aiRewordAvailability", () => {
  it("stays disabled and explains the missing consent gate", () => {
    const availability = aiRewordAvailability(null);

    expect(availability.enabled).toBe(false);
    expect(availability.consentGranted).toBe(false);
    expect(availability.providerConfigured).toBe(true);
    expect(availability.reason).toContain("recorded AI-processing consent");
  });

  it("enables rewording only after consent is recorded", () => {
    const availability = aiRewordAvailability({
      aiProcessing: true,
      provider: "test-provider",
      recordedAt: "2026-10-21T09:00:00.000Z",
      version: 1,
    });

    expect(availability.enabled).toBe(true);
    expect(availability.reason).toContain("Only bullet lines are sent");
  });
});

describe("mergeRefresh", () => {
  const existing = [
    section("experience", [claim("Hand-written experience line", ["exp-1"])]),
    section("project", [claim("Removed project line", ["project-1"])]),
    section("summary", [claim("Old summary", ["summary-1"])]),
  ];
  const fresh = [
    section("experience", [claim("Fresh experience line", ["exp-1"])]),
    section("project", [claim("Fresh project line", ["project-2"])]),
    section("summary", [claim("Fresh summary", ["summary-1"])]),
  ];

  it("skips hand-edited sections and keeps their removed claims visible", () => {
    const result = mergeRefresh({
      existingSections: existing,
      freshSections: fresh,
      editedSections: ["experience"],
      requestedSections: [],
      overwriteEditedSections: [],
    });

    expect(result.skippedSections).toEqual([
      { section: "experience", reason: "edited" },
    ]);
    expect(result.refreshedSections).toEqual(["project", "summary"]);
    expect(result.sections.find((entry) => entry.key === "experience")).toBe(
      existing[0],
    );
    expect(
      result.sections
        .find((entry) => entry.key === "experience")
        ?.claims[0]?.text,
    ).toBe("Hand-written experience line");
    expect(result.editedSections).toEqual(["experience"]);
  });

  it("overwrites an edited section only when it is explicitly named", () => {
    const result = mergeRefresh({
      existingSections: existing,
      freshSections: fresh,
      editedSections: ["experience"],
      requestedSections: ["experience"],
      overwriteEditedSections: ["experience"],
    });

    expect(result.skippedSections).toEqual([]);
    expect(result.refreshedSections).toEqual(["experience"]);
    expect(result.editedSections).toEqual([]);
    expect(
      result.sections.find((entry) => entry.key === "experience")?.claims[0]
        ?.text,
    ).toBe("Fresh experience line");
  });

  it("refreshes only requested sections and leaves the rest untouched", () => {
    const result = mergeRefresh({
      existingSections: existing,
      freshSections: fresh,
      editedSections: [],
      requestedSections: ["summary"],
      overwriteEditedSections: [],
    });

    expect(result.refreshedSections).toEqual(["summary"]);
    expect(result.sections.map((entry) => entry.key)).toEqual([
      "experience",
      "project",
      "summary",
    ]);
    expect(
      result.sections.find((entry) => entry.key === "project")?.claims[0]?.text,
    ).toBe("Removed project line");
  });

  it("keeps a section out entirely when the requested refresh has no fresh content", () => {
    const result = mergeRefresh({
      existingSections: existing,
      freshSections: fresh.filter((entry) => entry.key !== "project"),
      editedSections: [],
      requestedSections: ["project"],
      overwriteEditedSections: [],
    });

    // Only the requested section is refreshed. Sections that were not requested
    // stay untouched, and the requested section has no fresh source left.
    expect(result.sections.map((entry) => entry.key)).toEqual([
      "experience",
      "summary",
    ]);
    expect(result.refreshedSections).toEqual(["project"]);
  });
});
