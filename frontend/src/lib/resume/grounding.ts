import type { WorkspaceItem } from "@/lib/schemas";
import { SKILL_TAXONOMY } from "@/lib/analysis/taxonomy";

/**
 * Deterministic claim grounding (B3 claim validator, mirrored for the mock).
 *
 * A hand edit or an AI rewrite may only restate facts already present in the
 * cited workspace item. This checker rejects:
 *  - numbers/metrics that are not in the evidence;
 *  - technologies that are not in the evidence;
 *  - organisations and job-title words that are not in the evidence;
 *  - years or month-year dates that are not in the evidence.
 *
 * It deliberately fails closed. The real backend runs the same idea against
 * exactly the cited items; the frontend mock must not accept a claim the live
 * API would reject, otherwise F5 would only look correct in demo mode.
 */

export type GroundingViolationCode =
  | "missing_evidence"
  | "invented_metric"
  | "unsupported_technology"
  | "unsupported_organization"
  | "inflated_title"
  | "unsupported_date";

export interface GroundingViolation {
  code: GroundingViolationCode;
  value: string;
}

export interface GroundingResult {
  ok: boolean;
  violations: GroundingViolation[];
}

const TITLE_WORDS = new Set([
  "engineer",
  "developer",
  "manager",
  "analyst",
  "scientist",
  "designer",
  "architect",
  "director",
  "intern",
  "consultant",
  "administrator",
  "specialist",
  "officer",
  "researcher",
  "programmer",
  "lead",
  "president",
]);

const LEVEL_MODIFIERS = new Set([
  "senior",
  "staff",
  "principal",
  "head",
  "chief",
  "junior",
  "associate",
  "distinguished",
  "executive",
  "vice",
]);

const ORG_STRONG = [
  "Inc",
  "LLC",
  "Ltd",
  "Limited",
  "Corp",
  "Corporation",
  "GmbH",
  "University",
  "Institute",
  "Foundation",
];
const ORG_WEAK = [
  "Labs",
  "Technologies",
  "Systems",
  "Solutions",
  "Consulting",
];

const ORG_RE = new RegExp(
  `\\b(?:[A-Z][\\w&.'-]*\\s+){0,3}(?:${ORG_STRONG.join("|")})\\.?` +
    `|\\b(?:[A-Z][\\w&.'-]*\\s+){1,3}(?:${ORG_WEAK.join("|")})\\.?`,
  "g",
);

const TOKEN_RE = /[A-Za-z][A-Za-z'.\-]*/g;
const NUMBER_RE =
  /(?<![\w.])(?:[$€£]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|percent|k|m|bn|x))?(?![\w])/gi;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const MONTH_YEAR_RE = new RegExp(
  `\\b(?:${MONTHS})\\.?\\s+((?:19|20)\\d{2})\\b`,
  "gi",
);

function normalise(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wholeTermPattern(term: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9+#])${escapeRegExp(term)}(?![A-Za-z0-9+#])`,
    "i",
  );
}

const TECH_PATTERNS: { key: string; pattern: RegExp }[] = SKILL_TAXONOMY.flatMap(
  (skill) =>
    [skill.label, ...skill.aliases].map((surface) => ({
      key: skill.key,
      pattern: wholeTermPattern(surface),
    })),
);

export function technologiesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const { key, pattern } of TECH_PATTERNS) {
    if (pattern.test(text)) found.add(key);
  }
  return found;
}

function normaliseNumber(token: string): string {
  let value = token.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
  value = value.replace(/percent/g, "%");
  for (const symbol of ["$", "€", "£"]) value = value.replace(symbol, "");
  try {
    if (value.endsWith("bn")) {
      return String(Number.parseFloat(value.slice(0, -2)) * 1_000_000_000);
    }
    if (value.endsWith("k")) {
      return String(Number.parseFloat(value.slice(0, -1)) * 1_000);
    }
    if (value.endsWith("m")) {
      return String(Number.parseFloat(value.slice(0, -1)) * 1_000_000);
    }
  } catch {
    return value;
  }
  return value;
}

export function numbersIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(NUMBER_RE)].map((match) => normaliseNumber(match[0])),
  );
}

/** Runs of capitalised words, split at sentence boundaries. */
function wordGroups(text: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let previousEnd = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0] ?? "";
    const between = text.slice(previousEnd, match.index ?? 0);
    if (current.length > 0 && /[.!?]|\n/.test(between)) {
      groups.push(current);
      current = [];
    }
    previousEnd = (match.index ?? 0) + token.length;
    const titleCase = /^[A-Z]/.test(token);
    const lower = token.toLowerCase();
    if (
      TITLE_WORDS.has(lower) &&
      current.length > 0 &&
      current.every((word) => LEVEL_MODIFIERS.has(word.toLowerCase()))
    ) {
      current.push(token);
      groups.push(current);
      current = [];
    } else if (titleCase || LEVEL_MODIFIERS.has(lower)) {
      current.push(token);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function titlesIn(text: string): Set<string> {
  const titles = new Set<string>();
  for (const group of wordGroups(text)) {
    if (group.some((word) => TITLE_WORDS.has(word.toLowerCase()))) {
      titles.add(normalise(group.join(" ")));
    }
  }
  return titles;
}

export function organizationsIn(text: string): Set<string> {
  return new Set(
    [...text.matchAll(ORG_RE)].map((match) =>
      normalise((match[0] ?? "").replace(/\.$/, "")),
    ),
  );
}

function evidenceText(items: WorkspaceItem[]): string {
  return items
    .map((item) =>
      [
        item.title,
        item.organization ?? "",
        item.startDate ?? "",
        item.endDate ?? "",
        item.location ?? "",
        ...item.bullets,
        ...item.tags,
        ...item.links,
      ].join(" \n "),
    )
    .join(" \n ");
}

function addMissing(
  violations: GroundingViolation[],
  code: GroundingViolationCode,
  found: Set<string>,
  allowed: Set<string>,
  haystack: string,
) {
  for (const value of [...found].sort()) {
    if (allowed.has(value)) continue;
    if (haystack.includes(value)) continue;
    violations.push({ code, value });
  }
}

/**
 * Validate one claim against exactly the workspace items it cites.
 * Returns the same violation codes the backend's `resume_claim_ungrounded`
 * response stands for, so the UI can explain what was rejected.
 */
export function validateClaimGrounding(
  text: string,
  evidence: WorkspaceItem[],
): GroundingResult {
  if (evidence.length === 0) {
    return { ok: false, violations: [{ code: "missing_evidence", value: "" }] };
  }

  const haystack = normalise(evidenceText(evidence));
  const evidenceYears = new Set([...haystack.matchAll(YEAR_RE)].map((m) => m[0]));
  const evidenceNumbers = numbersIn(haystack);
  const evidenceTech = technologiesIn(haystack);
  for (const item of evidence) {
    for (const tag of item.tags) {
      for (const tech of technologiesIn(tag)) evidenceTech.add(tech);
    }
  }

  const evidenceTitles = titlesIn(haystack);
  for (const item of evidence) {
    evidenceTitles.add(normalise(item.title));
  }
  const evidenceOrgs = organizationsIn(haystack);
  for (const item of evidence) {
    if (item.organization) evidenceOrgs.add(normalise(item.organization));
  }

  const violations: GroundingViolation[] = [];

  for (const number of numbersIn(text)) {
    if (evidenceNumbers.has(number)) continue;
    if (evidenceYears.has(number)) continue;
    violations.push({ code: "invented_metric", value: number });
  }

  addMissing(
    violations,
    "unsupported_technology",
    technologiesIn(text),
    evidenceTech,
    haystack,
  );

  addMissing(
    violations,
    "unsupported_organization",
    organizationsIn(text),
    evidenceOrgs,
    haystack,
  );

  addMissing(violations, "inflated_title", titlesIn(text), evidenceTitles, haystack);

  for (const year of new Set([...text.matchAll(YEAR_RE)].map((m) => m[0]))) {
    if (!evidenceYears.has(year)) {
      violations.push({ code: "unsupported_date", value: year });
    }
  }
  for (const match of text.matchAll(MONTH_YEAR_RE)) {
    if (!evidenceYears.has(match[1] ?? "")) {
      violations.push({ code: "unsupported_date", value: match[0] });
    }
  }

  return { ok: violations.length === 0, violations };
}
