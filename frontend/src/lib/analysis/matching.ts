import type {
  Requirement,
  RequirementStatus,
  WorkspaceItem,
  WorkspaceSection,
} from "@/lib/schemas";
import { RequirementSchema } from "@/lib/schemas";
import { isSupportingEvidence } from "./weights";
import {
  findSkillByTerm,
  implementerSkills,
  mentionsSkill,
  relatedSkills,
  sameFamilySkills,
  SKILL_TAXONOMY,
  type SkillEntry,
} from "./taxonomy";

/**
 * Requirement extraction and evidence matching (PRD §6.4 JD-2/JD-3/JD-4).
 *
 * This is the *deterministic* half of the analysis: no language model is
 * involved. Every requirement is either mentioned by the job description you
 * pasted or by a taxonomy entry it contains, and every match traces to concrete
 * workspace items. The same inputs therefore always produce the same report
 * (JD-5), which is what `matching.test.ts` and `scoring.test.ts` assert.
 *
 * Classification model (documented in docs/DECISIONS.md ADR-021):
 * 1. matched     — a workspace item mentions the requirement *and* its own
 *                  evidence state is verified or user-attested. A concrete form
 *                  of a general skill (PostgreSQL for SQL) counts as the skill
 *                  itself; the reverse never does.
 * 2. partial     — the requirement is mentioned, but only by items whose
 *                  evidence is related or missing, so it can't be claimed yet.
 * 3. unsupported — no mention at all. Gap type:
 *                  · not_evidenced  — an adjacent skill (PRD §4.3) or another
 *                    skill in a transferable family is present, so this may
 *                    simply be undocumented.
 *                  · genuinely_missing — nothing nearby; a real gap.
 */

/** Families where practitioners routinely pick up the sibling tool. */
const TRANSFERABLE_FAMILIES = new Set([
  "infrastructure",
  "cloud",
  "database",
  "ml",
  "data",
  "tooling",
  "quality",
  "process",
]);

export interface RequirementDraft {
  id: string;
  text: string;
  kind: "required" | "preferred";
  /** Taxonomy key, for skill requirements. */
  skillKey?: string;
  /** Non-skill requirement shapes the mock recognises. */
  pattern?: "experience" | "education" | "seniority";
  /** Years demanded by an `experience` requirement. */
  years?: number;
  /** Term matched by a `seniority` requirement (verbatim from the posting). */
  term?: string;
  /**
   * Skills the *experience* sentence names. Used to check that the dated
   * experience is in the right area instead of counting any months.
   */
  skillKeys?: string[];
}

export interface EvidenceIndex {
  items: WorkspaceItem[];
  /** Searchable text per item id. */
  text: Map<string, string>;
  /** Skills each item mentions. */
  skills: Map<string, Set<string>>;
  /** Item ids mentioning each skill key. */
  itemsForSkill: Map<string, string[]>;
  /** Item ids per section. */
  bySection: Map<WorkspaceSection, string[]>;
  /** Stable "now" for date maths: the newest date the workspace knows about. */
  referenceDate: string;
}

export function activeItems(items: WorkspaceItem[]): WorkspaceItem[] {
  return items.filter((item) => !item.deletedAt);
}

/**
 * Indexes the workspace for matching. Everything is keyed by item id so
 * evidence links in the report can always be resolved back to a workspace item.
 */
export function buildEvidenceIndex(
  items: WorkspaceItem[],
  updatedAt: string,
): EvidenceIndex {
  const active = activeItems(items);
  const text = new Map<string, string>();
  const skills = new Map<string, Set<string>>();
  const itemsForSkill = new Map<string, string[]>();
  const bySection = new Map<WorkspaceSection, string[]>();

  for (const item of active) {
    const haystack = [
      item.title,
      item.organization ?? "",
      item.location ?? "",
      ...item.tags,
      ...item.bullets,
    ]
      .join(" ")
      .toLowerCase();
    text.set(item.id, haystack);
    bySection.set(item.section, [
      ...(bySection.get(item.section) ?? []),
      item.id,
    ]);

    const found = new Set<string>();
    for (const skill of SKILL_TAXONOMY) {
      if (mentionsSkill(haystack, skill)) {
        found.add(skill.key);
        itemsForSkill.set(skill.key, [
          ...(itemsForSkill.get(skill.key) ?? []),
          item.id,
        ]);
      }
    }
    skills.set(item.id, found);
  }

  return { items: active, text, skills, itemsForSkill, bySection, referenceDate: updatedAt };
}

export function itemById(index: EvidenceIndex, id: string): WorkspaceItem | null {
  return index.items.find((item) => item.id === id) ?? null;
}

function evidenceStateOf(index: EvidenceIndex, id: string) {
  return itemById(index, id)?.evidence ?? "missing";
}

/** Item ids mentioning `skillKey` whose own evidence can support a claim. */
function supportingIds(index: EvidenceIndex, skillKey: string): string[] {
  return (index.itemsForSkill.get(skillKey) ?? []).filter((id) =>
    isSupportingEvidence(evidenceStateOf(index, id)),
  );
}

/** Item ids mentioning `skillKey` at all (any evidence state). */
function mentionedIds(index: EvidenceIndex, skillKey: string): string[] {
  return index.itemsForSkill.get(skillKey) ?? [];
}

const MAX_EVIDENCE_LINKS = 6;

/* ------------------------------------------------------------------ */
/* Requirement extraction                                              */
/* ------------------------------------------------------------------ */

const NICE_TO_HAVE =
  /(nice to have|nice-to-have|preferred|preferably|bonus|a plus|would be great|desirable|advantageous|optional|not required|plus if)/i;
const YEARS = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*\d{0,2}\s*years?/i;
const EDUCATION =
  /(bachelor|b\.?\s?sc|bsc|b\.?\s?eng|beng|b\.?\s?tech|btech|master|m\.?\s?sc|msc|m\.?\s?eng|degree|phd|doctorate|diploma)/i;
const SENIORITY =
  /(\bsenior\b|\bstaff\b|\bprincipal\b|\blead\b|\bjunior\b|\bentry[- ]level\b|\bmid[- ]level\b|\bintern\b|\bseniority\b)/i;

function splitLines(jobDescription: string): string[] {
  return jobDescription
    // Split on line breaks, bullets, semicolons and sentence ends. Requiring
    // whitespace after the dot keeps tokens like "Node.js" intact, and avoids
    // regex lookbehind (not available in every browser).
    .split(/\r?\n|[•·]|;|\.\s+/)
    .map((line) => line.replace(/^[\s\-*•·–—>]+/, "").trim())
    .filter((line) => line.length > 1);
}

function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Extracts must-haves, nice-to-haves, seniority, experience and education from
 * the pasted posting (PRD §6.4 JD-2). Requirement ids are derived from the
 * matched skill/pattern, so two identical postings produce identical ids.
 */
export function extractRequirements(input: {
  jobDescription: string;
  requiredSkills?: string[];
}): RequirementDraft[] {
  const lines = splitLines(input.jobDescription);
  const drafts = new Map<string, RequirementDraft>();

  // 1. Explicit required skills the user typed into the intake form (JD-1).
  for (const raw of input.requiredSkills ?? []) {
    const term = raw.trim();
    if (!term) continue;
    const skill = findSkillByTerm(term);
    const key = skill ? skill.key : term.toLowerCase();
    drafts.set(`req-skill-${key}`, {
      id: `req-skill-${key}`,
      text: skill ? skill.label : truncate(term, 60),
      kind: "required",
      skillKey: skill?.key,
    });
  }

  // 2. Taxonomy skills mentioned anywhere in the posting. A skill that only
  //    appears in a "nice to have" sentence is a preference, not a gate.
  for (const line of lines) {
    const kind = NICE_TO_HAVE.test(line) ? "preferred" : "required";
    for (const skill of SKILL_TAXONOMY) {
      if (!mentionsSkill(line, skill)) continue;
      const id = `req-skill-${skill.key}`;
      const existing = drafts.get(id);
      if (existing) {
        // The user's explicit list wins; otherwise a hard mention upgrades a
        // preference.
        if (existing.kind === "preferred" && kind === "required") {
          drafts.set(id, { ...existing, kind: "required" });
        }
        continue;
      }
      drafts.set(id, {
        id,
        text: skill.label,
        kind,
        skillKey: skill.key,
      });
    }
  }

  // 3. Experience, education and seniority are single-slot requirements: the
  //    first line that mentions them is the one quoted back to the user.
  const experienceLine = lines.find((line) => YEARS.test(line));
  if (experienceLine) {
    const years = Number(YEARS.exec(experienceLine)?.[1] ?? 0) || undefined;
    drafts.set("req-experience", {
      id: "req-experience",
      text: truncate(experienceLine),
      kind: "required",
      pattern: "experience",
      years,
      skillKeys: SKILL_TAXONOMY.filter((skill) =>
        mentionsSkill(experienceLine, skill),
      ).map((skill) => skill.key),
    });
  }

  const educationLine = lines.find((line) => EDUCATION.test(line));
  if (educationLine) {
    drafts.set("req-education", {
      id: "req-education",
      text: truncate(educationLine),
      kind: "required",
      pattern: "education",
    });
  }

  const seniorityLine = lines.find((line) => SENIORITY.test(line));
  if (seniorityLine) {
    const term = SENIORITY.exec(seniorityLine)?.[1]?.toLowerCase();
    drafts.set("req-seniority", {
      id: "req-seniority",
      text: truncate(seniorityLine),
      kind: "required",
      pattern: "seniority",
      term,
    });
  }

  // Hard requirements first, then preferences; stable within each group by
  // insertion order so the report reads the same way every time.
  return [...drafts.values()].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "required" ? -1 : 1,
  );
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function monthsBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}-01T00:00:00.000Z`);
  const end = Date.parse(`${endIso}-01T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  const months =
    (new Date(end).getUTCFullYear() - new Date(start).getUTCFullYear()) * 12 +
    (new Date(end).getUTCMonth() - new Date(start).getUTCMonth());
  return months + 1;
}

function totalExperienceMonths(index: EvidenceIndex): number {
  const reference = index.referenceDate.slice(0, 7);
  return index.items
    .filter((item) => item.section === "experience" || item.section === "internship")
    .reduce((total, item) => {
      const start = item.startDate?.slice(0, 7);
      if (!start) return total;
      const end = item.endDate?.slice(0, 7) ?? reference;
      return total + monthsBetween(start, end);
    }, 0);
}

/** Qualification levels, lowest first. */
const DEGREE_LEVELS: { level: number; label: string; pattern: RegExp }[] = [
  { level: 3, label: "doctorate", pattern: /(phd|ph\.\s?d|doctorate|doctoral)/i },
  { level: 2, label: "master's", pattern: /(master|m\.?\s?sc|msc|m\.?\s?eng|meng|mba|m\.?\s?tech|mtech|postgraduate)/i },
  {
    level: 1,
    label: "bachelor's",
    pattern: /(bachelor|b\.?\s?sc|bsc|b\.?\s?eng|beng|b\.?\s?tech|btech|undergraduate)/i,
  },
];

/** Highest qualification level a piece of text names (0 when it names none). */
export function degreeLevel(text: string): number {
  for (const entry of DEGREE_LEVELS) {
    if (entry.pattern.test(text)) return entry.level;
  }
  return 0;
}

function degreeLabel(level: number): string {
  return DEGREE_LEVELS.find((entry) => entry.level === level)?.label ?? "qualification";
}

function itemsIn(index: EvidenceIndex, section: WorkspaceSection): WorkspaceItem[] {
  const ids = index.bySection.get(section) ?? [];
  return index.items.filter((item) => ids.includes(item.id));
}

function classifySkill(
  draft: RequirementDraft,
  index: EvidenceIndex,
): Requirement {
  const skill = draft.skillKey ? skillByKey(draft.skillKey) : null;
  if (!skill) {
    // A required skill the user typed that isn't in the taxonomy: match it as
    // plain text against the workspace.
    const needle = draft.text.toLowerCase();
    const hits = index.items
      .filter((item) => (index.text.get(item.id) ?? "").includes(needle))
      .map((item) => item.id);
    const supporting = hits.filter((id) =>
      isSupportingEvidence(evidenceStateOf(index, id)),
    );
    if (supporting.length > 0) {
      return {
        ...draft,
        status: "matched",
        gapType: null,
        evidenceIds: supporting.slice(0, MAX_EVIDENCE_LINKS),
        explanation: `Your workspace mentions “${draft.text}” with attached evidence.`,
      };
    }
    if (hits.length > 0) {
      return {
        ...draft,
        status: "partial",
        gapType: null,
        evidenceIds: hits.slice(0, MAX_EVIDENCE_LINKS),
        explanation: `“${draft.text}” is mentioned, but only with related or missing evidence.`,
      };
    }
    return {
      ...draft,
      status: "unsupported",
      gapType: "genuinely_missing",
      evidenceIds: [],
      explanation: `Nothing in your workspace mentions “${draft.text}”.`,
    };
  }

  const supporting = supportingIds(index, skill.key);
  const viaImplementers = implementerSkills(skill.key)
    .map((implementer) => ({
      implementer,
      ids: supportingIds(index, implementer.key),
    }))
    .filter((entry) => entry.ids.length > 0);
  const implementedIds = [
    ...new Set(viaImplementers.flatMap((entry) => entry.ids)),
  ].filter((id) => !supporting.includes(id));

  if (supporting.length > 0) {
    return {
      ...draft,
      text: skill.label,
      status: "matched",
      gapType: null,
      evidenceIds: supporting.slice(0, MAX_EVIDENCE_LINKS),
      explanation: `${skill.label} appears with attached evidence in ${supporting.length} workspace ${
        supporting.length === 1 ? "item" : "items"
      }.`,
    };
  }

  // A concrete form of a general skill counts as that skill (PostgreSQL is a
  // SQL engine). This is one-directional — see the taxonomy docblock.
  if (implementedIds.length > 0) {
    const names = viaImplementers
      .map((entry) => entry.implementer.label)
      .join(", ");
    return {
      ...draft,
      text: skill.label,
      status: "matched",
      gapType: null,
      evidenceIds: implementedIds.slice(0, MAX_EVIDENCE_LINKS),
      explanation: `Your ${names} evidence covers ${skill.label}: ${names} ${
        viaImplementers.length === 1 ? "is a" : "are"
      } ${skill.label} implementation.`,
    };
  }

  const mentioned = [
    ...new Set([
      ...mentionedIds(index, skill.key),
      ...viaImplementers.flatMap((entry) =>
        mentionedIds(index, entry.implementer.key),
      ),
    ]),
  ];
  if (mentioned.length > 0) {
    return {
      ...draft,
      text: skill.label,
      status: "partial",
      gapType: null,
      evidenceIds: mentioned.slice(0, MAX_EVIDENCE_LINKS),
      explanation: `${skill.label} is mentioned, but the evidence on those items is related or missing — it can't be claimed until you verify it.`,
    };
  }

  // Adjacent skills are related, never equivalent (PRD §4.3): the requirement
  // stays unsupported, but it is "not evidenced yet" rather than missing.
  for (const related of relatedSkills(skill.key)) {
    const adjacent = mentionedIds(index, related.key);
    if (adjacent.length > 0) {
      return {
        ...draft,
        text: skill.label,
        status: "unsupported",
        gapType: "not_evidenced",
        evidenceIds: adjacent.slice(0, MAX_EVIDENCE_LINKS),
        explanation: `No ${skill.label} found. You evidence ${related.label}, which is adjacent but not equivalent — ${skill.label} may just be undocumented.`,
      };
    }
  }

  if (TRANSFERABLE_FAMILIES.has(skill.family)) {
    for (const sibling of sameFamilySkills(skill.key)) {
      const nearby = mentionedIds(index, sibling.key);
      if (nearby.length > 0) {
        return {
          ...draft,
          text: skill.label,
          status: "unsupported",
          gapType: "not_evidenced",
          evidenceIds: nearby.slice(0, MAX_EVIDENCE_LINKS),
          explanation: `No ${skill.label} found, but you work with other ${skill.family} tooling (${sibling.label}) — this may just be undocumented.`,
        };
      }
    }
  }

  return {
    ...draft,
    text: skill.label,
    status: "unsupported",
    gapType: "genuinely_missing",
    evidenceIds: [],
    explanation: `Nothing in your workspace mentions ${skill.label} or anything adjacent to it.`,
  };
}

function classifyExperience(
  draft: RequirementDraft,
  index: EvidenceIndex,
): Requirement {
  const months = totalExperienceMonths(index);
  const needed = (draft.years ?? 0) * 12;
  const items = [...itemsIn(index, "experience"), ...itemsIn(index, "internship")];
  const ids = items.map((item) => item.id);

  // When the sentence names skills, the months must be in that area — five
  // years of web work does not answer "4 years of machine learning".
  const domain = draft.skillKeys ?? [];
  const inDomain =
    domain.length === 0 ||
    items.some((item) => {
      const owned = index.skills.get(item.id) ?? new Set<string>();
      return domain.some((key) => owned.has(key));
    });

  if (months > 0 && (needed === 0 || months >= needed) && inDomain) {
    return {
      ...draft,
      status: "matched",
      gapType: null,
      evidenceIds: ids.slice(0, MAX_EVIDENCE_LINKS),
      explanation: `Your dated experience totals about ${Math.round(months / 12)} year(s), which covers this.`,
    };
  }
  if (months > 0) {
    const reason = inDomain
      ? `Your dated experience totals about ${Math.round(months / 12)} year(s), less than the ${draft.years ?? "requested"} asked for.`
      : `Your dated experience totals about ${Math.round(months / 12)} year(s), but it is in other areas — this line asks for ${domain
          .map((key) => SKILL_TAXONOMY.find((skill) => skill.key === key)?.label ?? key)
          .join(", ")}.`;
    return {
      ...draft,
      status: "partial",
      gapType: null,
      evidenceIds: ids.slice(0, MAX_EVIDENCE_LINKS),
      explanation: reason,
    };
  }
  return {
    ...draft,
    status: "unsupported",
    gapType: ids.length > 0 ? "not_evidenced" : "genuinely_missing",
    evidenceIds: ids.slice(0, MAX_EVIDENCE_LINKS),
    explanation:
      ids.length > 0
        ? "You have experience items, but none carry a start date, so the length can't be confirmed."
        : "You have no experience or internship items in your workspace yet.",
  };
}

function classifyEducation(
  draft: RequirementDraft,
  index: EvidenceIndex,
): Requirement {
  const education = itemsIn(index, "education");
  const supporting = education.filter((item) =>
    isSupportingEvidence(item.evidence),
  );
  const learning = [...itemsIn(index, "course"), ...itemsIn(index, "training")];
  const demanded = degreeLevel(draft.text);
  const held = education.reduce(
    (best, item) => Math.max(best, degreeLevel(item.title)),
    0,
  );

  if (supporting.length > 0 && (demanded === 0 || held >= demanded)) {
    return {
      ...draft,
      status: "matched",
      gapType: null,
      evidenceIds: supporting.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation: "Your education section covers this with attested or verified entries.",
    };
  }
  if (supporting.length > 0) {
    return {
      ...draft,
      status: "partial",
      gapType: null,
      evidenceIds: supporting.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation: `Your highest recorded qualification is ${
        held > 0 ? `a ${degreeLabel(held)}` : "not listed at a recognisable level"
      }, below the ${degreeLabel(demanded)} this posting asks for.`,
    };
  }
  if (education.length > 0) {
    return {
      ...draft,
      status: "partial",
      gapType: null,
      evidenceIds: education.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation:
        "You have education items, but their evidence is related or missing — attach a certificate to verify them.",
    };
  }
  if (learning.length > 0) {
    return {
      ...draft,
      status: "unsupported",
      gapType: "not_evidenced",
      evidenceIds: learning.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation:
        "No education entry yet. You do have courses or training recorded, so formal education may just be undocumented.",
    };
  }
  return {
    ...draft,
    status: "unsupported",
    gapType: "genuinely_missing",
    evidenceIds: [],
    explanation: "No education, course or training items in your workspace yet.",
  };
}

function classifySeniority(
  draft: RequirementDraft,
  index: EvidenceIndex,
): Requirement {
  const experience = [...itemsIn(index, "experience"), ...itemsIn(index, "internship")];
  const term = draft.term ?? "";
  const matching = term
    ? experience.filter((item) =>
        `${item.title} ${item.tags.join(" ")}`.toLowerCase().includes(term),
      )
    : [];
  if (matching.length > 0) {
    return {
      ...draft,
      status: "matched",
      gapType: null,
      evidenceIds: matching.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation: `One of your roles uses the word “${term}”.`,
    };
  }
  if (experience.length > 0) {
    return {
      ...draft,
      status: "partial",
      gapType: null,
      evidenceIds: experience.map((item) => item.id).slice(0, MAX_EVIDENCE_LINKS),
      explanation: `You have experience, but no role title matches “${term || "this level"}”.`,
    };
  }
  return {
    ...draft,
    status: "unsupported",
    gapType: "genuinely_missing",
    evidenceIds: [],
    explanation: "No experience items recorded, so this level isn't evidenced.",
  };
}

function skillByKey(key: string): SkillEntry | null {
  return SKILL_TAXONOMY.find((skill) => skill.key === key) ?? null;
}

/** Classifies one requirement against the workspace (PRD §6.4 JD-3/JD-4). */
export function classifyRequirement(
  draft: RequirementDraft,
  index: EvidenceIndex,
): Requirement {
  switch (draft.pattern) {
    case "experience":
      return classifyExperience(draft, index);
    case "education":
      return classifyEducation(draft, index);
    case "seniority":
      return classifySeniority(draft, index);
    default:
      return classifySkill(draft, index);
  }
}

export interface MatchResult {
  requirements: Requirement[];
  /** Status summary, useful for the report header. */
  counts: Record<RequirementStatus, number>;
}

export function matchRequirements(
  drafts: RequirementDraft[],
  index: EvidenceIndex,
): MatchResult {
  // Parsing through the contract schema keeps the wire shape exact (no draft
  // bookkeeping such as `skillKeys` leaks into the report).
  const requirements = drafts.map((draft) =>
    RequirementSchema.parse(classifyRequirement(draft, index)),
  );
  return {
    requirements,
    counts: {
      matched: requirements.filter((r) => r.status === "matched").length,
      partial: requirements.filter((r) => r.status === "partial").length,
      unsupported: requirements.filter((r) => r.status === "unsupported").length,
    },
  };
}
