import {
  SCORE_WEIGHTS,
  type Requirement,
  type ScoreFactor,
  type WorkspaceItem,
} from "@/lib/schemas";
import type { EvidenceIndex } from "./matching";
import { meanEvidenceQuality } from "./weights";

/**
 * Factor computation for the job-match score (PRD §6.5).
 *
 * Each factor maps to a slice of the posting's requirements. Requirement
 * status converts to a factor value with matched = 1, partially matched = 0.5,
 * unsupported = 0. When a posting says nothing about an area (or the reading
 * finds no requirements for it), the factor falls back to how deep the
 * workspace is in that area, and if there is nothing at all to compare the
 * factor is dropped and the remaining weights are renormalised — so the number
 * on screen always stands for something the methodology text can explain.
 */

export type FactorKey =
  | "required_skills"
  | "preferred_skills"
  | "experience"
  | "education"
  | "projects";

/** 0–1 value for a single requirement status. */
export function statusValue(status: Requirement["status"]): number {
  switch (status) {
    case "matched":
      return 1;
    case "partial":
      return 0.5;
    default:
      return 0;
  }
}

interface FactorDraft {
  key: FactorKey;
  applicable: boolean;
  value: number;
  detail: string;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Requirement ids the score used, so the report can link back to them. */
function requirementsFor(
  requirements: Requirement[],
  key: FactorKey,
): Requirement[] {
  switch (key) {
    case "required_skills":
      return requirements.filter((r) => r.kind === "required" && !r.pattern);
    case "preferred_skills":
      return requirements.filter((r) => r.kind === "preferred" && !r.pattern);
    case "experience":
      return requirements.filter(
        (r) => r.pattern === "experience" || r.pattern === "seniority",
      );
    case "education":
      return requirements.filter((r) => r.pattern === "education");
    default:
      return [];
  }
}

function depthValue(
  index: EvidenceIndex,
  sections: WorkspaceItem["section"][],
  scaleByCount: boolean,
): { value: number; count: number; quality: number } {
  const items = index.items.filter((item) => sections.includes(item.section));
  const quality = meanEvidenceQuality(items.map((item) => item.evidence));
  const breadth = scaleByCount ? Math.min(1, items.length / 2) : items.length > 0 ? 1 : 0;
  return { value: Math.round(quality * breadth * 100), count: items.length, quality };
}

const SECTION_LABELS: Record<FactorKey, string> = {
  required_skills: "required skill",
  preferred_skills: "preferred skill",
  experience: "experience",
  education: "education",
  projects: "project & achievement",
};

function buildSkillFactor(
  key: "required_skills" | "preferred_skills",
  requirements: Requirement[],
): { applicable: boolean; value: number; detail: string } {
  const relevant = requirementsFor(requirements, key);
  if (relevant.length === 0) {
    return { applicable: false, value: 0, detail: "" };
  }
  const value = Math.round(mean(relevant.map((r) => statusValue(r.status))) * 100);
  const matched = relevant.filter((r) => r.status === "matched").length;
  const partial = relevant.filter((r) => r.status === "partial").length;
  const unsupported = relevant.length - matched - partial;
  return {
    applicable: true,
    value,
    detail: `${matched} matched, ${partial} partially matched, ${unsupported} unsupported of ${relevant.length} ${SECTION_LABELS[key]} requirement(s).`,
  };
}

function buildMappedFactor(
  key: "experience" | "education",
  requirements: Requirement[],
  fallback: { value: number; detail: string },
): { applicable: boolean; value: number; detail: string } {
  const relevant = requirementsFor(requirements, key);
  if (relevant.length === 0) {
    // Nothing in the posting covers this area: say so, and fall back to depth.
    return { applicable: true, value: fallback.value, detail: fallback.detail };
  }
  const value = Math.round(mean(relevant.map((r) => statusValue(r.status))) * 100);
  const matched = relevant.filter((r) => r.status === "matched").length;
  const partial = relevant.filter((r) => r.status === "partial").length;
  const unsupported = relevant.length - matched - partial;
  return {
    applicable: true,
    value,
    detail: `${matched} matched, ${partial} partially matched, ${unsupported} unsupported of ${relevant.length} ${SECTION_LABELS[key]} requirement(s).`,
  };
}

/**
 * Computes the weighted factor breakdown. Returns only applicable factors,
 * with weights renormalised to sum to 1 (that is what the UI prints).
 */
export function computeFactors(
  requirements: Requirement[],
  index: EvidenceIndex,
): ScoreFactor[] {
  const drafts: FactorDraft[] = [];

  const required = buildSkillFactor("required_skills", requirements);
  drafts.push({ key: "required_skills", ...required });

  const preferred = buildSkillFactor("preferred_skills", requirements);
  drafts.push({ key: "preferred_skills", ...preferred });

  const experienceDepth = depthValue(index, ["experience", "internship"], true);
  const experience = buildMappedFactor("experience", requirements, {
    value: experienceDepth.value,
    detail:
      experienceDepth.count === 0
        ? "This posting doesn't set an experience bar, and your workspace has no experience or internship items yet."
        : `This posting doesn't set an experience bar, so this reflects your workspace: ${experienceDepth.count} experience/internship item(s).`,
  });
  drafts.push({ key: "experience", ...experience });

  const educationDepth = depthValue(index, ["education"], false);
  const education = buildMappedFactor("education", requirements, {
    value: educationDepth.value,
    detail:
      educationDepth.count === 0
        ? "This posting doesn't require a qualification, and your workspace has no education items yet."
        : `This posting doesn't require a qualification, so this reflects your workspace: ${educationDepth.count} education item(s).`,
  });
  drafts.push({ key: "education", ...education });

  const projectDepth = depthValue(index, ["project", "achievement"], true);
  drafts.push({
    key: "projects",
    applicable: projectDepth.count > 0,
    value: projectDepth.value,
    detail:
      projectDepth.count === 0
        ? "No project or achievement items in your workspace yet."
        : `Your workspace has ${projectDepth.count} project/achievement item(s); the value reflects how well they are evidenced.`,
  });

  const applicable = drafts.filter((draft) => draft.applicable);
  const totalWeight = applicable.reduce(
    (total, draft) =>
      total + (SCORE_WEIGHTS.find((w) => w.key === draft.key)?.weight ?? 0),
    0,
  );
  if (totalWeight === 0) return [];

  return applicable.map((draft) => {
    const base = SCORE_WEIGHTS.find((w) => w.key === draft.key);
    return {
      name: base?.name ?? draft.key,
      weight: Number((((base?.weight ?? 0) / totalWeight) || 0).toFixed(4)),
      value: Math.max(0, Math.min(100, draft.value)),
      detail: draft.detail,
    };
  });
}

/** Weighted score 0–100 from a factor breakdown (weights already renormalised). */
export function weightedScore(factors: ScoreFactor[]): number {
  if (factors.length === 0) return 0;
  const totalWeight = factors.reduce((total, factor) => total + factor.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = factors.reduce(
    (total, factor) => total + factor.weight * factor.value,
    0,
  );
  return Math.max(0, Math.min(100, Math.round(weighted / totalWeight)));
}
