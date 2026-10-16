import { describe, expect, it } from "vitest";
import {
  AnalysisReportSchema,
  EvidenceStateSchema,
  RequirementSchema,
  ResumeSchema,
  WorkspaceItemSchema,
  WorkspaceSchema,
} from "@/lib/schemas";

const item = {
  id: "ws-1",
  section: "project",
  title: "Campus event tracker",
  bullets: ["Built a single-page event tracker."],
  tags: ["typescript"],
  links: [],
  attachments: [],
  evidence: "attested",
  order: 0,
};

describe("contract schemas (PRD §8.3)", () => {
  it("accepts a valid workspace item and rejects an empty title", () => {
    expect(WorkspaceItemSchema.safeParse(item).success).toBe(true);
    expect(
      WorkspaceItemSchema.safeParse({ ...item, title: "" }).success,
    ).toBe(false);
  });

  it("rejects unknown evidence states", () => {
    expect(EvidenceStateSchema.safeParse("unverified").success).toBe(false);
    expect(
      EvidenceStateSchema.safeParse("verified").success,
    ).toBe(true);
  });

  it("accepts a workspace with version + items", () => {
    expect(
      WorkspaceSchema.safeParse({
        version: 1,
        items: [item],
        updatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it("splits unsupported requirements into gap types", () => {
    const parsed = RequirementSchema.safeParse({
      id: "req-1",
      text: "Kubernetes",
      kind: "required",
      status: "unsupported",
      gapType: "genuinely_missing",
      evidenceIds: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("clamps report scores to 0–100", () => {
    const base = {
      score: 87,
      factors: [{ name: "Required skills", weight: 0.4, value: 92 }],
      requirements: [],
      included: [],
      excluded: [],
      roadmap: [],
      ats: { score: 90, keywordCoverage: 80, issues: [] },
    };
    expect(AnalysisReportSchema.safeParse(base).success).toBe(true);
    expect(
      AnalysisReportSchema.safeParse({ ...base, score: 140 }).success,
    ).toBe(false);
  });

  it("tracks resume staleness against the workspace version", () => {
    const parsed = ResumeSchema.safeParse({
      id: "r-1",
      kind: "tailored",
      targetId: "t-1",
      workspaceVersion: 3,
      stale: true,
      sections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
  });
});
