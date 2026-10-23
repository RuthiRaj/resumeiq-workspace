import { describe, expect, it } from "vitest";
import {
  AnalysisReportSchema,
  CapabilitiesSchema,
  EvidenceStateSchema,
  RequirementSchema,
  ResumeSchema,
  ResumeSummarySchema,
  ResumeVersionSchema,
  WorkspaceChangeLogEntrySchema,
  WorkspaceItemFormSchema,
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
      targetId: "t-1",
      workspaceVersion: 9,
      generatedAt: new Date().toISOString(),
      score: 87,
      factors: [
        { name: "Required skills", weight: 0.47, value: 92, detail: "6 matched of 7." },
      ],
      methodology: {
        note: "Weighted average of the factors below.",
        scoreDisclaimer: "Not a probability of being hired.",
        atsDisclaimer: "Not a guarantee of passing an ATS.",
        atsNote: "Deterministic checks only.",
      },
      requirements: [],
      skills: { documented: [], demonstrated: [], notEvidenced: [], toDevelop: [] },
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

  it("accepts the B1 wire shape, where optional item fields are null", () => {
    // Regression: `WorkspaceItemResponse` sends `null`, not `undefined`, for an
    // unset field. Parsing it must not fail at backend integration (B7).
    const wireItem = {
      id: "ws-2",
      section: "experience",
      title: "Backend Engineer",
      organization: null,
      startDate: null,
      endDate: null,
      location: null,
      bullets: [],
      tags: [],
      links: [],
      attachments: [],
      evidence: "attested",
      order: 0,
      deletedAt: null,
    };
    const parsed = WorkspaceItemSchema.safeParse(wireItem);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.organization).toBeNull();
      expect(parsed.data.deletedAt).toBeNull();
    }
  });

  it("models a restore as its own change-log operation", () => {
    const base = {
      seq: 9,
      workspaceVersion: 4,
      itemId: "ws-2",
      at: new Date().toISOString(),
    };
    expect(
      WorkspaceChangeLogEntrySchema.safeParse({ ...base, op: "restore", label: null }).success,
    ).toBe(true);
    // An unknown op is still rejected.
    expect(
      WorkspaceChangeLogEntrySchema.safeParse({ ...base, op: "undelete" }).success,
    ).toBe(false);
  });

  it("enforces month precision on editor dates (ADR-017)", () => {
    const form = {
      title: "Backend Engineer",
      organization: "",
      startDate: "2024-06",
      endDate: "2025-01",
      location: "",
      bullets: [],
      tags: [],
      links: [],
      attachments: [],
      evidence: "attested" as const,
    };
    expect(WorkspaceItemFormSchema.safeParse(form).success).toBe(true);
    // Day precision and a narrow month are both rejected.
    expect(
      WorkspaceItemFormSchema.safeParse({ ...form, startDate: "2024-06-15" }).success,
    ).toBe(false);
    expect(
      WorkspaceItemFormSchema.safeParse({ ...form, startDate: "2024-13" }).success,
    ).toBe(false);
    // A completely empty date is "not set" and stays valid.
    expect(
      WorkspaceItemFormSchema.safeParse({ ...form, startDate: "", endDate: "" }).success,
    ).toBe(true);
  });

  it("parses the B6 capabilities envelope and defaults the missing flags", () => {
    const parsed = CapabilitiesSchema.safeParse({
      ai: { configured: true, analysisEnrichment: false, resumeRewording: true },
      accountDeletion: { dataDeletion: true, authUserDeletion: false },
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.pdfExport).toBe(true);
    expect(
      CapabilitiesSchema.safeParse({ ai: { configured: true } }).success,
    ).toBe(false);
  });

  it("accepts B6 summary/version fields and the purged reason", () => {
    const summary = ResumeSummarySchema.safeParse({
      id: "r-1",
      kind: "tailored",
      workspaceVersion: 2,
      removedEvidenceIds: ["ws-1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(summary.success && summary.data.removedEvidenceIds).toEqual(["ws-1"]);

    const version = ResumeVersionSchema.safeParse({
      id: "r-1-v2",
      resumeId: "r-1",
      workspaceVersion: 1,
      reason: "purged",
      stale: true,
      removedEvidenceIds: ["ws-1"],
      createdAt: new Date().toISOString(),
    });
    expect(version.success).toBe(true);
    expect(version.success && version.data.reason).toBe("purged");
  });
});
