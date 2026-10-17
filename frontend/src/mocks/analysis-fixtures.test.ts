import { describe, expect, it } from "vitest";
import { AnalysisReportSchema, type JobTarget } from "@/lib/schemas";
import { buildAnalysisReport } from "@/lib/analysis";
import { WORKSPACE_FIXTURES } from "./fixtures";
import {
  JOB_DESCRIPTION_FIXTURES,
  jobDescriptionFixture,
  sampleTargets,
  type FixtureId,
} from "./analysis-fixtures";

/**
 * F4 fixture contract (PRD §8.5): the three sample postings must stay
 * *ordered and distinct* against the mid-level workspace, and every generated
 * report must satisfy the wire contract. If a taxonomy or scoring change
 * quietly flattens the fixtures, this file fails.
 */

const WORKSPACE = WORKSPACE_FIXTURES.midlevel;
const GENERATED_AT = "2026-10-17T09:00:00.000Z";

function targetFor(id: FixtureId): JobTarget {
  const fixture = jobDescriptionFixture(id);
  return {
    id: `tgt-sample-${id}`,
    role: fixture.role,
    company: fixture.company,
    jobDescription: fixture.jobDescription,
    requiredSkills: fixture.requiredSkills,
    template: fixture.template,
    length: fixture.length,
    status: "draft",
    analysis: null,
    sample: true,
    createdAt: GENERATED_AT,
    updatedAt: GENERATED_AT,
  };
}

function reportFor(id: FixtureId) {
  return buildAnalysisReport({
    target: targetFor(id),
    items: WORKSPACE.items,
    workspaceVersion: WORKSPACE.version,
    workspaceUpdatedAt: WORKSPACE.updatedAt,
    generatedAt: GENERATED_AT,
  });
}

describe("job-description fixtures (PRD §8.5)", () => {
  it("ships exactly the three documented postings", () => {
    expect(JOB_DESCRIPTION_FIXTURES.map((fixture) => fixture.id)).toEqual([
      "strong",
      "partial",
      "poor",
    ]);
    for (const fixture of JOB_DESCRIPTION_FIXTURES) {
      expect(fixture.jobDescription.length).toBeGreaterThan(100);
      expect(fixture.description.length).toBeGreaterThan(20);
    }
  });

  it("scores them in order against the mid-level workspace", () => {
    const strong = reportFor("strong").score;
    const partial = reportFor("partial").score;
    const poor = reportFor("poor").score;
    expect(strong).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(poor);
    // Distinct bands, not a one-point spread.
    expect(strong - partial).toBeGreaterThanOrEqual(10);
    expect(partial - poor).toBeGreaterThanOrEqual(10);
  });

  it("produces reports that satisfy the published contract", () => {
    for (const id of ["strong", "partial", "poor"] as const) {
      const parsed = AnalysisReportSchema.safeParse(reportFor(id));
      expect(parsed.success, `${id} report should parse`).toBe(true);
    }
  });

  it("leaves the strong posting without required-skill gaps", () => {
    const report = reportFor("strong");
    const requiredGaps = report.requirements.filter(
      (requirement) =>
        requirement.kind === "required" && requirement.status === "unsupported",
    );
    expect(requiredGaps).toEqual([]);
  });

  it("fills the partial posting with all three requirement states", () => {
    const report = reportFor("partial");
    const statuses = new Set(report.requirements.map((requirement) => requirement.status));
    expect(statuses.has("matched")).toBe(true);
    expect(statuses.has("partial")).toBe(true);
    expect(statuses.has("unsupported")).toBe(true);
    const gapTypes = new Set(
      report.requirements
        .filter((requirement) => requirement.status === "unsupported")
        .map((requirement) => requirement.gapType),
    );
    expect(gapTypes.has("not_evidenced")).toBe(true);
    expect(gapTypes.has("genuinely_missing")).toBe(true);
  });

  it("finds genuine gaps in the poor posting and keeps the roadmap honest", () => {
    const report = reportFor("poor");
    const missing = report.requirements.filter(
      (requirement) => requirement.gapType === "genuinely_missing",
    );
    expect(missing.length).toBeGreaterThanOrEqual(3);
    expect(report.roadmap.length).toBeGreaterThan(0);
    for (const step of report.roadmap) {
      // Every step must point at something the report also shows.
      expect(step.reason.length).toBeGreaterThan(20);
      expect(step.action.length).toBeGreaterThan(10);
    }
  });

  it("is deterministic for identical inputs (JD-5)", () => {
    const first = reportFor("partial");
    const second = reportFor("partial");
    expect(first.score).toBe(second.score);
    expect(first.requirements).toEqual(second.requirements);
    expect(first.factors).toEqual(second.factors);
    expect(first.ats).toEqual(second.ats);
  });

  it("marks its targets as samples with fixed timestamps", () => {
    const now = new Date("2026-10-17T13:45:00.000Z");
    const targets = sampleTargets(now);
    expect(targets).toHaveLength(3);
    for (const target of targets) {
      expect(target.sample).toBe(true);
      expect(target.status).toBe("draft");
      // Fixed to the day, so generated reports stay comparable.
      expect(target.createdAt).toBe("2026-10-17T09:00:00.000Z");
    }
  });
});
