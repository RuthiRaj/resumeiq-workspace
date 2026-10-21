import type {
  Requirement,
  ResumeEvidence,
  ResumeSection,
  TargetLength,
  WorkspaceItem,
} from "@/lib/schemas";
import { evidenceFromItem } from "./evidence";

/**
 * Deterministic tailored-resume engine (B5, PRD §6.8 RG-1..RG-6).
 *
 * It never writes prose. It selects and orders the user's own workspace items
 * using the report, then copies their existing header fields and bullets
 * verbatim. Only reordering and trimming happen, so no employer, title, date,
 * metric, technology or certificate can be invented.
 */

export const TAILORED_SECTION_ORDER = [
  "personal",
  "experience",
  "internship",
  "project",
  "education",
  "certificate",
  "course",
  "training",
  "skill",
  "achievement",
  "publication",
  "extracurricular",
] as const;

export type TailoredSectionKey = (typeof TAILORED_SECTION_ORDER)[number];

const SECTION_RANK = new Map<string, number>(
  TAILORED_SECTION_ORDER.map((key, index) => [key, index]),
);

const CLAIM_BUDGET: Record<TargetLength, number> = {
  one_page: 28,
  two_page: 44,
};
const BULLETS_PER_ITEM: Record<TargetLength, number> = {
  one_page: 2,
  two_page: 3,
};
const MIN_ITEMS = 6;

const REQUIRED_MATCH = 100;
const PREFERRED_MATCH = 80;
const REQUIRED_PARTIAL = 50;
const PREFERRED_PARTIAL = 30;

const STOPWORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "from",
  "your",
  "you",
  "our",
  "are",
  "has",
  "have",
  "using",
  "work",
  "working",
  "experience",
  "years",
  "year",
  "strong",
  "skills",
  "ability",
  "role",
]);

const TOKEN_RE = /[a-z0-9][a-z0-9+#.]*/g;

function terms(text: string): Set<string> {
  return new Set(
    [...text.toLowerCase().matchAll(TOKEN_RE)]
      .map((match) => match[0])
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

function requirementWeight(requirement: Requirement): number {
  if (requirement.status === "matched") {
    return requirement.kind === "required" ? REQUIRED_MATCH : PREFERRED_MATCH;
  }
  return requirement.kind === "required" ? REQUIRED_PARTIAL : PREFERRED_PARTIAL;
}

interface RankedItem {
  evidence: ResumeEvidence;
  score: number;
  bestRequirement: number;
  terms: Set<string>;
}

function rankItems(
  items: WorkspaceItem[],
  requirements: Requirement[],
): RankedItem[] {
  const ranked = new Map<string, RankedItem>(
    items.map((item) => [
      item.id,
      {
        evidence: evidenceFromItem(item),
        score: 0,
        bestRequirement: Number.MAX_SAFE_INTEGER,
        terms: new Set<string>(),
      },
    ]),
  );

  requirements.forEach((requirement, index) => {
    if (requirement.status === "unsupported") return;
    const weight = requirementWeight(requirement);
    const requirementTerms = terms(requirement.text);
    for (const itemId of requirement.evidenceIds) {
      const entry = ranked.get(itemId);
      if (!entry) continue;
      entry.score += weight;
      entry.bestRequirement = Math.min(entry.bestRequirement, index);
      for (const term of requirementTerms) entry.terms.add(term);
    }
  });

  // Personal/contact items are always kept. The rest compete by relevance;
  // zero-score items keep section + workspace order, so a thin match still
  // produces a usable resume rather than an arbitrary one.
  return [...ranked.values()].sort((a, b) => {
    const personalA = a.evidence.section === "personal" ? 0 : 1;
    const personalB = b.evidence.section === "personal" ? 0 : 1;
    return (
      personalA - personalB ||
      b.score - a.score ||
      a.bestRequirement - b.bestRequirement ||
      (SECTION_RANK.get(a.evidence.section) ?? 99) -
        (SECTION_RANK.get(b.evidence.section) ?? 99) ||
      a.evidence.order - b.evidence.order
    );
  });
}

function bulletScore(bullet: string, requirementTerms: Set<string>): number {
  if (requirementTerms.size === 0) return 0;
  let score = 0;
  for (const token of bullet.toLowerCase().match(TOKEN_RE) ?? []) {
    if (requirementTerms.has(token)) score += 1;
  }
  return score;
}

function rankBullets(
  bullets: string[],
  requirementTerms: Set<string>,
  limit: number,
): string[] {
  return bullets
    .map((bullet, index) => ({ bullet: bullet.trim(), index }))
    .filter((entry) => entry.bullet.length > 0)
    .sort(
      (a, b) =>
        bulletScore(b.bullet, requirementTerms) -
          bulletScore(a.bullet, requirementTerms) ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.bullet);
}

function headerText(item: ResumeEvidence): string {
  const dates = [item.startDate, item.endDate].filter(Boolean).join(" – ");
  return [item.title, item.organization, dates]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

export interface GeneratedResume {
  sections: ResumeSection[];
  evidence: ResumeEvidence[];
  itemIds: string[];
}

export function generateTailoredResume(
  items: WorkspaceItem[],
  requirements: Requirement[],
  length: TargetLength = "one_page",
): GeneratedResume {
  const active = items.filter((item) => !item.deletedAt);
  const budget = CLAIM_BUDGET[length] ?? CLAIM_BUDGET.one_page;
  const bulletsPerItem = BULLETS_PER_ITEM[length] ?? BULLETS_PER_ITEM.one_page;

  const ranked = rankItems(active, requirements);
  const selected: RankedItem[] = ranked.slice(0, budget);

  if (selected.length < Math.min(MIN_ITEMS, ranked.length)) {
    const picked = new Set(selected.map((entry) => entry.evidence.itemId));
    for (const entry of [...ranked].sort(
      (a, b) => a.evidence.order - b.evidence.order,
    )) {
      if (selected.length >= Math.min(MIN_ITEMS, ranked.length)) break;
      if (!picked.has(entry.evidence.itemId)) {
        selected.push(entry);
        picked.add(entry.evidence.itemId);
      }
    }
  }

  const grouped = new Map<string, RankedItem[]>();
  for (const entry of selected) {
    const bucket = grouped.get(entry.evidence.section) ?? [];
    bucket.push(entry);
    grouped.set(entry.evidence.section, bucket);
  }

  const sections: ResumeSection[] = [];
  const renderedEvidence: ResumeEvidence[] = [];
  let claimCount = 0;

  for (const key of TAILORED_SECTION_ORDER) {
    const entries = grouped.get(key);
    if (!entries || entries.length === 0) continue;

    const claims: ResumeSection["claims"] = entries.map((entry) => ({
      text: headerText(entry.evidence),
      evidenceIds: [entry.evidence.itemId],
      confirmed:
        entry.evidence.evidence === "verified" ||
        entry.evidence.evidence === "attested",
      aiRewritten: false,
      removed: false,
    }));
    claimCount += claims.length;

    for (const entry of entries) {
      const remaining = Math.max(0, budget - claimCount);
      const rankedBullets = rankBullets(
        entry.evidence.bullets,
        entry.terms,
        bulletsPerItem,
      ).slice(0, remaining);
      claimCount += rankedBullets.length;
      const confirmed =
        entry.evidence.evidence === "verified" ||
        entry.evidence.evidence === "attested";
      claims.push(
        ...rankedBullets.map((bullet) => ({
          text: bullet,
          evidenceIds: [entry.evidence.itemId],
          confirmed,
          aiRewritten: false,
          removed: false,
        })),
      );
      renderedEvidence.push({
        ...entry.evidence,
        bullets: rankedBullets,
        tags: [...entry.evidence.tags],
      });
    }

    sections.push({ key, claims });
  }

  return {
    sections,
    evidence: renderedEvidence,
    itemIds: renderedEvidence.map((entry) => entry.itemId),
  };
}

/**
 * Evidence for exactly the claims that survived, preferring fresh workspace
 * items. A deleted item keeps its last snapshot so the line can be flagged as
 * removed instead of silently disappearing.
 */
export function collectEvidence(
  sections: ResumeSection[],
  items: WorkspaceItem[],
  prior: ResumeEvidence[],
): ResumeEvidence[] {
  const current = new Map(
    items
      .filter((item) => !item.deletedAt)
      .map((item) => [item.id, evidenceFromItem(item)]),
  );
  const previous = new Map(prior.map((entry) => [entry.itemId, entry]));
  const result: ResumeEvidence[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    for (const claim of section.claims) {
      for (const itemId of claim.evidenceIds) {
        if (seen.has(itemId)) continue;
        const found = current.get(itemId) ?? previous.get(itemId);
        if (!found) continue;
        seen.add(itemId);
        result.push({ ...found, bullets: [...found.bullets], tags: [...found.tags] });
      }
    }
  }
  return result;
}
