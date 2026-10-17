import { describe, expect, it } from "vitest";
import {
  EVIDENCE_QUALITY,
  buildAnalysisReport,
  buildEvidenceIndex,
  computeAtsReport,
  computeFactors,
  extractRequirements,
  matchRequirements,
  monthLabel,
  weightedScore,
} from "@/lib/analysis";
import {
  ANALYSIS_TOTAL_MS,
  SCORE_WEIGHTS,
  progressAt,
  stageIndexAt,
  type JobTarget,
  type WorkspaceItem,
} from "@/lib/schemas";

/**
 * Unit tests for the F4 analysis engine (PRD §6.4–6.7).
 *
 * These pin the deterministic parts: requirement classification, the weighted
 * score, the staged timings and the ATS checks. The three fixture postings are
 * covered end-to-end in `mocks/analysis-fixtures.test.ts`.
 */

const UPDATED = "2026-10-16T09:12:00.000Z";

function item(
  overrides: Partial<WorkspaceItem> & Pick<WorkspaceItem, "id" | "section" | "title">,
): WorkspaceItem {
  return {
    bullets: [],
    tags: [],
    links: [],
    attachments: [],
    evidence: "attested",
    order: 0,
    ...overrides,
  };
}

function indexOf(items: WorkspaceItem[]) {
  return buildEvidenceIndex(items, UPDATED);
}

function classify(
  jobDescription: string,
  items: WorkspaceItem[],
  requiredSkills: string[] = [],
) {
  const index = indexOf(items);
  const drafts = extractRequirements({ jobDescription, requiredSkills });
  return matchRequirements(drafts, index);
}

function target(jobDescription: string, requiredSkills: string[] = []): JobTarget {
  return {
    id: "tgt-test-1",
    role: "Test Role",
    company: null,
    jobDescription,
    requiredSkills,
    template: "precision",
    length: "one_page",
    status: "draft",
    analysis: null,
    sample: false,
    createdAt: UPDATED,
    updatedAt: UPDATED,
  };
}

describe("requirement classification (PRD §6.5, JD-3/JD-4)", () => {
  it("matches a requirement against a skill item with supporting evidence", () => {
    const { requirements } = classify(
      "Requirements\n• Strong TypeScript skills.",
      [item({ id: "s1", section: "skill", title: "TypeScript" })],
    );
    const typescript = requirements.find((r) => r.text.toLowerCase().includes("typescript"));
    expect(typescript?.status).toBe("matched");
    expect(typescript?.evidenceIds).toEqual(["s1"]);
  });

  it("only partially matches when the evidence state is related, not equivalent", () => {
    const { requirements } = classify(
      "Requirements\n• Strong Docker skills.",
      [item({ id: "s1", section: "skill", title: "Kubernetes", evidence: "related" })],
    );
    const docker = requirements.find((r) => r.text.toLowerCase().includes("docker"));
    expect(docker?.status).toBe("unsupported");
    expect(docker?.gapType).toBe("not_evidenced");
    expect(docker?.explanation).toContain("Kubernetes");
  });

  it("treats a weak item as a partial match for the skill it names", () => {
    const { requirements } = classify(
      "Requirements\n• Kubernetes experience.",
      [item({ id: "s1", section: "skill", title: "Kubernetes", evidence: "related" })],
    );
    const k8s = requirements.find((r) => r.text.toLowerCase().includes("kubernetes"));
    expect(k8s?.status).toBe("partial");
  });

  it("splits unsupported requirements into not-evidenced vs genuinely missing", () => {
    const { requirements } = classify(
      "Requirements\n• Node.js services.\n• Python services.",
      [item({ id: "e1", section: "experience", title: "Developer", tags: ["javascript"] })],
    );
    const node = requirements.find((r) => r.text.toLowerCase().includes("node"));
    const python = requirements.find((r) => r.text.toLowerCase().includes("python"));
    // Node sits next to the JavaScript the workspace has; Python sits next to nothing.
    expect(node?.gapType).toBe("not_evidenced");
    expect(python?.gapType).toBe("genuinely_missing");
  });

  it("marks nice-to-have lines as preferred rather than required", () => {
    const { requirements } = classify(
      "Requirements\n• TypeScript.\nNice to have: Kafka.",
      [item({ id: "s1", section: "skill", title: "TypeScript" })],
    );
    const kafka = requirements.find((r) => r.text.toLowerCase().includes("kafka"));
    expect(kafka?.kind).toBe("preferred");
  });

  it("partially matches experience when the months fall short", () => {
    const { requirements } = classify(
      "Requirements\n• 10+ years of software engineering experience.",
      [
        item({
          id: "e1",
          section: "experience",
          title: "Developer",
          startDate: "2023-02",
        }),
      ],
    );
    expect(requirements[0]?.status).toBe("partial");
    expect(requirements[0]?.explanation).toContain("less than");
  });

  it("counts a concrete implementation of a general skill as that skill", () => {
    const { requirements } = classify(
      "Requirements\n• Comfortable with PostgreSQL and SQL.",
      [
        item({
          id: "s1",
          section: "skill",
          title: "PostgreSQL",
          evidence: "attested",
        }),
      ],
    );
    const sql = requirements.find((requirement) => requirement.text === "SQL");
    expect(sql?.status).toBe("matched");
    expect(sql?.explanation).toContain("PostgreSQL");
    expect(sql?.explanation).toContain("implementation");
    // The evidence points at the PostgreSQL item that carried the claim.
    expect(sql?.evidenceIds).toEqual(["s1"]);
  });

  it("never lets a general skill stand in for a specific engine", () => {
    const { requirements } = classify(
      "Requirements\n• MySQL experience.",
      [
        item({
          id: "s1",
          section: "skill",
          title: "SQL",
          evidence: "verified",
        }),
      ],
    );
    const mysql = requirements.find(
      (requirement) => requirement.text === "MySQL",
    );
    expect(mysql?.status).not.toBe("matched");
    expect(mysql?.gapType).toBe("not_evidenced");
    expect(mysql?.explanation).toContain("SQL");
  });

  it("finds the experience requirement among the skill requirements", () => {
    const { requirements } = classify(
      "Requirements\n• 4+ years building machine learning systems in Python.",
      [
        item({
          id: "e1",
          section: "experience",
          title: "Web Developer",
          startDate: "2019-01",
          tags: ["javascript"],
        }),
      ],
    );
    const experience = requirements.find(
      (requirement) => requirement.pattern === "experience",
    );
    expect(experience?.status).toBe("partial");
    expect(experience?.explanation).toContain("other areas");
  });

  it("partially matches a higher degree requirement than the one held", () => {
    const { requirements } = classify(
      "Requirements\n• Master's degree in Computer Science.",
      [item({ id: "ed1", section: "education", title: "B.Sc. Computer Science" })],
    );
    expect(requirements[0]?.status).toBe("partial");
    expect(requirements[0]?.explanation).toContain("master's");
  });

  it("matches an equivalent-or-higher qualification", () => {
    const { requirements } = classify(
      "Requirements\n• Bachelor's degree in Computer Science.",
      [item({ id: "ed1", section: "education", title: "M.Sc. Computer Science" })],
    );
    expect(requirements[0]?.status).toBe("matched");
  });
});

describe("score computation (PRD §6.5)", () => {
  const index = indexOf([
    item({ id: "s1", section: "skill", title: "TypeScript", evidence: "verified" }),
    item({
      id: "e1",
      section: "experience",
      title: "Engineer",
      startDate: "2022-01",
      endDate: "2026-01",
      evidence: "verified",
    }),
    item({ id: "ed1", section: "education", title: "B.Sc. Computing", evidence: "attested" }),
    item({ id: "p1", section: "project", title: "Side project", evidence: "verified" }),
  ]);

  function factorsFor(jobDescription: string) {
    const drafts = extractRequirements({ jobDescription, requiredSkills: [] });
    const { requirements } = matchRequirements(drafts, index);
    return { requirements, factors: computeFactors(requirements, index) };
  }

  it("renormalises the weights of the factors that apply and drops the rest", () => {
    const { factors } = factorsFor("Requirements\n• Strong TypeScript skills.");
    // No preferred skills were asked for, so that factor is absent…
    expect(factors.map((factor) => factor.name)).not.toContain("Preferred skills");
    // …and the remaining weights still sum to 1 (that is what the UI prints).
    const total = factors.reduce((sum, factor) => sum + factor.weight, 0);
    expect(Math.round(total * 1000) / 1000).toBe(1);
  });

  it("keeps the fixed weights when every factor applies", () => {
    const { factors } = factorsFor(
      "Requirements\n• TypeScript.\nNice to have: Kubernetes.\n• 2+ years of experience.\n• Bachelor's degree.",
    );
    for (const factor of factors) {
      const base = SCORE_WEIGHTS.find((weight) => weight.name === factor.name);
      expect(base).toBeDefined();
      expect(factor.weight).toBeCloseTo(base?.weight ?? 0, 3);
    }
  });

  it("scores proportionally and clamps to 0–100", () => {
    expect(weightedScore([{ name: "A", weight: 1, value: 60, detail: "" }])).toBe(60);
    expect(
      weightedScore([
        { name: "A", weight: 0.5, value: 100, detail: "" },
        { name: "B", weight: 0.5, value: 0, detail: "" },
      ]),
    ).toBe(50);
    expect(weightedScore([])).toBe(0);
  });

  it("gives the same score for the same inputs (JD-5)", () => {
    const first = factorsFor("Requirements\n• Strong TypeScript skills.");
    const second = factorsFor("Requirements\n• Strong TypeScript skills.");
    expect(first.factors).toEqual(second.factors);
    expect(weightedScore(first.factors)).toBe(weightedScore(second.factors));
  });

  it("uses the shared evidence-quality table for depth factors", () => {
    const verified = item({ id: "p1", section: "project", title: "A", evidence: "verified" });
    const related = item({ id: "p2", section: "project", title: "B", evidence: "related" });
    const strong = computeFactors([], indexOf([verified, verified, verified]));
    const weak = computeFactors([], indexOf([related, related, related]));
    const strongProjects = strong.find((factor) => factor.name.startsWith("Projects"));
    const weakProjects = weak.find((factor) => factor.name.startsWith("Projects"));
    expect(strongProjects?.value).toBe(Math.round(EVIDENCE_QUALITY.verified * 100));
    expect(weakProjects?.value).toBe(Math.round(EVIDENCE_QUALITY.related * 100));
  });
});

describe("analysis theatre timing (PRD §7.4.4, §8.4)", () => {
  it("keeps the whole run inside the 3–8s budget", () => {
    expect(ANALYSIS_TOTAL_MS).toBeGreaterThanOrEqual(3_000);
    expect(ANALYSIS_TOTAL_MS).toBeLessThanOrEqual(8_000);
  });

  it("maps elapsed time onto stages", () => {
    expect(stageIndexAt(0)).toBe(0);
    expect(stageIndexAt(ANALYSIS_TOTAL_MS - 1)).toBe(5);
    expect(stageIndexAt(ANALYSIS_TOTAL_MS)).toBe(5);
    // Never negative, never past the last stage.
    expect(stageIndexAt(-100)).toBe(0);
    expect(stageIndexAt(999_999)).toBe(5);
  });

  it("reports monotone progress from 0 to 100", () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(ANALYSIS_TOTAL_MS)).toBe(100);
    expect(progressAt(ANALYSIS_TOTAL_MS * 2)).toBe(100);
    expect(progressAt(ANALYSIS_TOTAL_MS / 2)).toBeGreaterThan(0);
    expect(progressAt(ANALYSIS_TOTAL_MS / 2)).toBeLessThan(100);
  });
});

describe("ATS panel (PRD §6.7)", () => {
  it("formats month-precision dates for humans", () => {
    expect(monthLabel("2025-03")).toBe("Mar 2025");
    expect(monthLabel("not a date")).toBe("not a date");
  });

  it("keeps rewrite examples presentational, never new claims", () => {
    const longBullet =
      "Rebuilt the reporting pipeline that the finance team used every month end, replacing a fragile spreadsheet process with a scheduled job, and documented the new runbook so anyone on the team could operate it without me, which reduced the monthly close from three days to one.";
    const ats = computeAtsReport({
      items: [
        item({
          id: "e1",
          section: "experience",
          title: "Engineer",
          organization: "Northwind",
          startDate: "2023-02",
          endDate: "2025-04",
          bullets: [longBullet],
        }),
      ],
      requirements: [],
    });

    const lineExample = ats.examples.find((example) => example.id === "example-long-line");
    expect(lineExample).toBeDefined();
    // Same words, only whitespace added: no invented content.
    const words = (text: string) => text.split(/\s+/).filter(Boolean).sort();
    expect(words(lineExample?.after ?? "")).toEqual(words(lineExample?.before ?? ""));

    const dateExample = ats.examples.find((example) => example.id === "example-dates");
    expect(dateExample?.before).toContain("2023-02");
    expect(dateExample?.after).toContain("Feb 2023");
    expect(dateExample?.note).toContain("No detail was invented");
  });

  it("counts keyword coverage against the resume text", () => {
    const items = [
      item({ id: "s1", section: "skill", title: "TypeScript", tags: ["typescript"] }),
    ];
    const { requirements } = classify(
      "Requirements\n• TypeScript.\n• Kubernetes.",
      items,
      [],
    );
    const ats = computeAtsReport({ items, requirements });
    expect(ats.keywords).toHaveLength(requirements.length);
    expect(ats.keywordCoverage).toBeGreaterThan(0);
    expect(ats.keywordCoverage).toBeLessThan(100);
  });

  it("counts keywords as terms, never whole requirement sentences", () => {
    const items = [
      item({ id: "s1", section: "skill", title: "TypeScript", tags: ["typescript"] }),
    ];
    const { requirements } = classify(
      "Requirements\n• TypeScript.\n• 5+ years of experience.",
      items,
    );
    const ats = computeAtsReport({ items, requirements });
    expect(ats.keywords.map((keyword) => keyword.keyword)).toEqual(["TypeScript"]);
    expect(ats.keywordCoverage).toBe(100);
    const check = ats.checks.find((entry) => entry.id === "keywords");
    expect(check?.status).toBe("pass");
  });

  it("never claims a layout check it cannot run yet", () => {
    const ats = computeAtsReport({ items: [], requirements: [] });
    const layout = ats.checks.find((check) => check.id === "layout");
    expect(layout?.status).toBe("not_checked");
    expect(layout?.detail).toContain("F5");
  });
});

describe("full report assembly (PRD §6.6)", () => {
  const items = [
    item({
      id: "s1",
      section: "skill",
      title: "TypeScript",
      tags: ["typescript"],
    }),
    item({
      id: "p1",
      section: "project",
      title: "Evidence tool",
      tags: ["typescript"],
      bullets: ["Built a small evidence tracker."],
      evidence: "verified",
    }),
    item({
      id: "p2",
      section: "project",
      title: "Unrelated thing",
      evidence: "missing",
    }),
  ];

  const report = buildAnalysisReport({
    target: target("Requirements\n• Strong TypeScript skills."),
    items,
    workspaceVersion: 4,
    workspaceUpdatedAt: UPDATED,
    generatedAt: UPDATED,
  });

  it("records where the report came from", () => {
    expect(report.targetId).toBe("tgt-test-1");
    expect(report.workspaceVersion).toBe(4);
    expect(report.generatedAt).toBe(UPDATED);
    expect(report.methodology.note).toContain("Weighted average");
  });

  it("explains every content decision", () => {
    expect(report.included.map((entry) => entry.itemId)).toContain("p1");
    const excludedMissing = report.excluded.find((entry) => entry.itemId === "p2");
    expect(excludedMissing?.reason).toContain("Missing");
    expect(report.content.supportedRequirementIds.length).toBeGreaterThan(0);
  });

  it("separates documented, demonstrated and missing skills", () => {
    expect(report.skills.documented.map((skill) => skill.name)).toContain("TypeScript");
    expect(report.skills.demonstrated.map((skill) => skill.name)).toContain("TypeScript");
  });

  it("carries the disclaimers into the payload", () => {
    expect(report.methodology.scoreDisclaimer).toContain("not a probability");
    expect(report.methodology.atsDisclaimer).toContain("guarantee");
  });

  it("tailors roadmap steps to what the requirement actually is", () => {
    const items = [
      item({
        id: "e1",
        section: "experience",
        title: "Engineer",
        startDate: "2024-01",
        tags: ["typescript"],
      }),
    ];
    const report = buildAnalysisReport({
      target: target(
        "Requirements\n• 8+ years of experience.\n• Senior Frontend Engineer — Halcyon Systems",
      ),
      items,
      workspaceVersion: 1,
      workspaceUpdatedAt: UPDATED,
      generatedAt: UPDATED,
    });
    const actions = report.roadmap.map((step) => step.action);
    // Months of work can't be certificated, and a level is shown, not attached.
    expect(actions.some((action) => action.startsWith("Attach a certificate"))).toBe(
      false,
    );
    expect(actions.some((action) => action.includes("earlier roles"))).toBe(true);
    for (const step of report.roadmap) {
      expect(step.reason.length).toBeGreaterThan(20);
    }
  });
});
