import {
  DEFAULT_METHODOLOGY,
  type AnalysisReport,
  type ContentDecision,
  type JobTarget,
  type Requirement,
  type RoadmapStep,
  type SkillAnalysis,
  type SkillFinding,
  type ContentReport,
  type WorkspaceItem,
  type WorkspaceSection,
} from "@/lib/schemas";
import { computeAtsReport } from "./ats";
import {
  buildEvidenceIndex,
  extractRequirements,
  matchRequirements,
  type EvidenceIndex,
} from "./matching";
import { computeFactors, weightedScore } from "./scoring";
import { isSupportingEvidence } from "./weights";
import { SKILL_TAXONOMY } from "./taxonomy";

/**
 * Assembles the full AI report (PRD §6.6) from the target and the workspace.
 *
 * Everything is derived, never invented: the text of a requirement comes from
 * the posting you pasted, the label of a skill comes from the taxonomy, and
 * every claim of a match points at a workspace item. Given the same target,
 * workspace version and timestamp this function is pure, so reports are
 * byte-identical run to run (PRD §6.4 JD-5).
 */

export interface BuildReportInput {
  target: JobTarget;
  /** Every workspace item, including soft-deleted ones (they are filtered here). */
  items: WorkspaceItem[];
  workspaceVersion: number;
  /** Workspace `updatedAt`; also the reference date for experience maths. */
  workspaceUpdatedAt: string;
  generatedAt: string;
}

/** Sections a skill gap would most likely be closed in. */
const GAP_SECTION: Record<string, WorkspaceSection> = {
  experience: "experience",
  seniority: "experience",
  education: "education",
};

const SECTION_PRIORITY: WorkspaceSection[] = [
  "experience",
  "education",
  "project",
  "internship",
  "skill",
  "certificate",
  "course",
  "achievement",
  "publication",
  "training",
  "personal",
  "extracurricular",
];

const MAX_ROADMAP_STEPS = 6;
const MAX_SECTION_FIXES = 4;

function groupedSkills(
  index: EvidenceIndex,
  sections: WorkspaceSection[],
): SkillFinding[] {
  const byName = new Map<string, string[]>();
  for (const item of index.items) {
    if (!sections.includes(item.section)) continue;
    const key = item.title.trim();
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), item.id]);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, itemIds]) => ({ name, itemIds }));
}

function buildSkills(
  index: EvidenceIndex,
  requirements: Requirement[],
): SkillAnalysis {
  const documented = groupedSkills(index, ["skill"]);

  // Skills demonstrated by something other than a bare skill listing.
  const demonstrationSections: WorkspaceSection[] = [
    "project",
    "experience",
    "internship",
    "certificate",
    "course",
    "achievement",
    "publication",
    "training",
  ];
  const demonstrated: SkillFinding[] = [];
  for (const skill of SKILL_TAXONOMY) {
    const ids = (index.itemsForSkill.get(skill.key) ?? []).filter((id) => {
      const item = index.items.find((candidate) => candidate.id === id);
      return (
        item !== undefined &&
        demonstrationSections.includes(item.section) &&
        isSupportingEvidence(item.evidence)
      );
    });
    if (ids.length > 0) {
      demonstrated.push({ name: skill.label, itemIds: ids.slice(0, 6) });
    }
  }
  demonstrated.sort((a, b) => a.name.localeCompare(b.name));

  const notEvidenced = requirements
    .filter(
      (requirement) =>
        requirement.status === "unsupported" &&
        requirement.gapType === "not_evidenced",
    )
    .map((requirement) => ({
      name: requirement.text,
      reason: requirement.explanation,
    }));

  // What to develop: real gaps first (a genuine miss is the most valuable to
  // close), then undocumented-but-adjacent, then requirements only partly
  // backed by evidence.
  const rank = (requirement: Requirement): number => {
    if (requirement.status === "unsupported") {
      if (requirement.gapType === "genuinely_missing") return 0;
      return 1;
    }
    return 2;
  };
  const toDevelop = requirements
    .filter((requirement) => requirement.status !== "matched")
    .map((requirement) => ({ requirement, rank: rank(requirement) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map(({ requirement }) => ({
      name: requirement.text,
      reason: requirement.explanation,
    }));

  return { documented, demonstrated, notEvidenced, toDevelop };
}

function buildContent(
  index: EvidenceIndex,
  requirements: Requirement[],
): {
  included: ContentDecision[];
  excluded: ContentDecision[];
  content: ContentReport;
} {
  const uses = new Map<string, string[]>();
  for (const requirement of requirements) {
    if (requirement.status === "unsupported") continue;
    for (const itemId of requirement.evidenceIds) {
      uses.set(itemId, [...(uses.get(itemId) ?? []), requirement.text]);
    }
  }

  const included: ContentDecision[] = [];
  const excluded: ContentDecision[] = [];
  for (const item of index.items) {
    const usedFor = uses.get(item.id);
    if (usedFor && usedFor.length > 0) {
      const labels = [...new Set(usedFor)].slice(0, 3);
      included.push({
        itemId: item.id,
        reason: `Evidence for ${labels.join(", ")}${usedFor.length > labels.length ? " and more" : ""}.`,
      });
      continue;
    }
    if (item.evidence === "missing") {
      excluded.push({
        itemId: item.id,
        reason:
          "Marked Missing — there's nothing backing it yet, so it can't support a claim in this resume.",
      });
      continue;
    }
    if (item.section === "skill") {
      excluded.push({
        itemId: item.id,
        reason: "No requirement in this posting mentions this skill.",
      });
      continue;
    }
    excluded.push({
      itemId: item.id,
      reason: "Not used as evidence for any requirement in this posting.",
    });
  }

  const sectionsToImprove: ContentReport["sectionsToImprove"] = [];
  const fixes = new Map<WorkspaceSection, string[]>();
  for (const requirement of requirements) {
    if (requirement.status === "matched") continue;
    const section =
      (requirement.pattern && GAP_SECTION[requirement.pattern]) ||
      (requirement.gapType === "not_evidenced" ? "skill" : "project");
    fixes.set(section, [
      ...(fixes.get(section) ?? []),
      `${requirement.text} — ${requirement.status === "partial" ? "evidence still needs verifying" : "not evidenced yet"}.`,
    ]);
  }

  const weakBySection = new Map<WorkspaceSection, number>();
  for (const item of index.items) {
    if (item.evidence === "verified" || item.evidence === "attested") continue;
    weakBySection.set(item.section, (weakBySection.get(item.section) ?? 0) + 1);
  }

  for (const section of SECTION_PRIORITY) {
    if (sectionsToImprove.length >= MAX_SECTION_FIXES) break;
    const gaps = fixes.get(section) ?? [];
    const weak = weakBySection.get(section) ?? 0;
    if (gaps.length === 0 && weak === 0) continue;
    const reasons: string[] = [];
    if (gaps.length > 0) {
      reasons.push(
        `${gaps.length} ${section.replace("_", " ")} requirement(s) from this job aren't backed yet: ${gaps
          .slice(0, 3)
          .map((entry) => entry.split(" — ")[0])
          .join(", ")}.`,
      );
    }
    if (weak > 0) {
      reasons.push(
        `${weak} ${section} item(s) are marked related or missing, so they can't support a claim yet.`,
      );
    }
    sectionsToImprove.push({ section, reason: reasons.join(" ") });
  }

  return {
    included,
    excluded,
    content: {
      supportedRequirementIds: requirements
        .filter((requirement) => requirement.status !== "unsupported")
        .map((requirement) => requirement.id),
      needsEvidenceRequirementIds: requirements
        .filter((requirement) => requirement.status === "unsupported")
        .map((requirement) => requirement.id),
      sectionsToImprove,
    },
  };
}

/**
 * One roadmap step for a requirement that isn't fully covered. The action
 * depends on *what kind* of requirement it is: you can attach a certificate for
 * a skill, but a "Senior" title or a degree is evidenced differently — the
 * roadmap never asks for proof that couldn't exist.
 */
function unfilledStep(requirement: Requirement): { action: string; reason: string } {
  const quoted = `The posting asks: “${requirement.text}”.`;
  if (requirement.status === "unsupported") {
    const adjacent = requirement.gapType === "not_evidenced";
    switch (requirement.pattern) {
      case "experience":
        return {
          action: adjacent
            ? "Add month-precision dates to your roles so the length can be counted"
            : "Add your work history — roles, months and what you owned",
          reason: requirement.explanation,
        };
      case "education":
        return {
          action: adjacent
            ? "Record your courses or training as education entries"
            : "Add your education, courses or training",
          reason: requirement.explanation,
        };
      case "seniority":
        return {
          action: "Show the level you work at through scope and outcomes",
          reason: `${requirement.explanation} ${quoted}`,
        };
      default:
        return {
          action: adjacent
            ? `Document where you used ${requirement.text}`
            : `Learn ${requirement.text} and build a small project that proves it`,
          reason: requirement.explanation,
        };
    }
  }

  switch (requirement.pattern) {
    case "experience":
      return {
        action:
          "Record any earlier roles you haven't added yet, and show how the months you have overlap this one",
        reason: `${requirement.explanation} ${quoted}`,
      };
    case "seniority":
      return {
        action: "Make the level visible in your role titles and the scope you owned",
        reason: `${requirement.explanation} ${quoted}`,
      };
    case "education":
      return {
        action: "Record the qualification you hold, or the one you're studying for",
        reason: `${requirement.explanation} ${quoted}`,
      };
    default:
      return {
        action: `Attach a certificate or link that backs up ${requirement.text}`,
        reason: requirement.explanation,
      };
  }
}

function buildRoadmap(
  index: EvidenceIndex,
  requirements: Requirement[],
  target: JobTarget,
): RoadmapStep[] {
  const role = target.company ? `${target.role} at ${target.company}` : target.role;
  const steps: { action: string; reason: string }[] = [];

  const required = requirements.filter((r) => r.kind === "required");
  const genuinelyMissing = required.filter(
    (r) => r.status === "unsupported" && r.gapType === "genuinely_missing",
  );
  const notEvidenced = required.filter(
    (r) => r.status === "unsupported" && r.gapType === "not_evidenced",
  );
  const partial = required.filter((r) => r.status === "partial");
  const preferredGaps = requirements.filter(
    (r) => r.kind === "preferred" && r.status !== "matched",
  );

  for (const requirement of genuinelyMissing) {
    steps.push(unfilledStep(requirement));
  }
  for (const requirement of notEvidenced) {
    steps.push(unfilledStep(requirement));
  }
  for (const requirement of partial) {
    steps.push(unfilledStep(requirement));
  }

  // Weakly-evidenced items in the sections this job cares about.
  const weakItems = index.items.filter(
    (item) =>
      (item.evidence === "related" || item.evidence === "missing") &&
      (item.section === "experience" ||
        item.section === "project" ||
        item.section === "education"),
  );
  if (weakItems.length > 0) {
    steps.push({
      action: `Verify ${weakItems
        .slice(0, 2)
        .map((item) => item.title)
        .join(" and ")}`,
      reason: `${weakItems.length} item(s) in the sections this posting cares about are marked related or missing, so they weaken the resume for ${role}.`,
    });
  }

  for (const requirement of preferredGaps) {
    steps.push({
      action: `Optional: strengthen ${requirement.text}`,
      reason: `Listed as a nice-to-have for ${role}. ${requirement.explanation}`,
    });
  }

  const noDetail = index.items.find(
    (item) =>
      (item.section === "experience" || item.section === "project") &&
      item.bullets.length === 0,
  );
  if (noDetail) {
    steps.push({
      action: `Add one detail line to ${noDetail.title}`,
      reason:
        "Job-specific reports read better when every role and project says what changed. Use numbers you can defend.",
    });
  }

  return steps
    .slice(0, MAX_ROADMAP_STEPS)
    .map((step, index) => ({ priority: index + 1, ...step }));
}

export function buildAnalysisReport(input: BuildReportInput): AnalysisReport {
  const index = buildEvidenceIndex(input.items, input.workspaceUpdatedAt);
  const drafts = extractRequirements({
    jobDescription: input.target.jobDescription,
    requiredSkills: input.target.requiredSkills,
  });
  const { requirements } = matchRequirements(drafts, index);
  const factors = computeFactors(requirements, index);
  const skills = buildSkills(index, requirements);
  const { included, excluded, content } = buildContent(index, requirements);
  const roadmap = buildRoadmap(index, requirements, input.target);

  const ats = computeAtsReport({
    items: index.items,
    requirements,
  });

  return {
    targetId: input.target.id,
    workspaceVersion: input.workspaceVersion,
    generatedAt: input.generatedAt,
    score: weightedScore(factors),
    factors,
    methodology: DEFAULT_METHODOLOGY,
    requirements,
    skills,
    included,
    excluded,
    content,
    roadmap,
    ats,
  };
}

/** Keywords the report matched against the resume (used by tests/debug UI). */
export function reportKeywords(report: AnalysisReport): string[] {
  return report.ats.keywords
    .filter((keyword) => keyword.present)
    .map((keyword) => keyword.keyword);
}
