import type { Claim, Resume, TargetLength } from "@/lib/schemas";

/**
 * The shared resume-document model used by the web preview, the print-only
 * sheet and (mirrored in Python) the server PDF.
 *
 * It turns the claim wire format into the conventional ATS-safe structure:
 * name, one contact line, then sections in a fixed order. It never invents a
 * fact; it only parses, groups and formats claims that already exist.
 */

export interface ResumeDocumentEntry {
  title: string;
  organization: string;
  dates: string;
  bullets: string[];
  /** A flat line (skill/summary) rather than a title + bullet entry. */
  listItem: boolean;
}

export interface ResumeDocumentSection {
  key: string;
  label: string;
  entries: ResumeDocumentEntry[];
}

export interface ResumeDocumentModel {
  name: string;
  contact: string;
  sections: ResumeDocumentSection[];
  /** Claims omitted by the one/two-page setting; shown outside the document. */
  hiddenForLength: number;
  /** Lines whose evidence still needs confirmation; shown outside the document. */
  unconfirmed: number;
  /** Lines whose source item was deleted; never printed. */
  removed: number;
  empty: boolean;
}

export interface ResumeDocumentOptions {
  length: TargetLength;
  order: string[];
  hidden: string[];
}

export const CLAIM_LIMIT: Record<TargetLength, number> = {
  one_page: 32,
  two_page: 56,
};

export const RESUME_DOCUMENT_SECTIONS = [
  { key: "summary", label: "Summary", sourceKeys: ["summary"] },
  { key: "education", label: "Education", sourceKeys: ["education"] },
  {
    key: "experience",
    label: "Experience",
    sourceKeys: ["experience", "internship"],
  },
  { key: "project", label: "Projects", sourceKeys: ["project"] },
  { key: "skill", label: "Skills", sourceKeys: ["skill"] },
  {
    key: "certificate",
    label: "Certifications",
    sourceKeys: ["certificate", "training", "course"],
  },
  {
    key: "achievement",
    label: "Achievements and awards",
    sourceKeys: ["achievement", "extracurricular"],
  },
  { key: "publication", label: "Publications", sourceKeys: ["publication"] },
] as const;

/**
 * Unique presentation-control entries. A control owns every workspace key that
 * merges into one document heading, so the same heading can never be listed
 * twice.
 */
export const RESUME_DOCUMENT_CONTROL_SECTIONS = [
  { key: "personal", label: "Personal details", sourceKeys: ["personal"] },
  ...RESUME_DOCUMENT_SECTIONS,
] as const;

/**
 * Default order for the presentation controls. These are document-section ids,
 * not raw workspace keys; the model maps merged keys back to their heading.
 */
export const DEFAULT_DOCUMENT_ORDER = [
  "personal",
  "summary",
  "education",
  "experience",
  "project",
  "skill",
  "certificate",
  "achievement",
  "publication",
] as const;

export interface ResumeDocumentControl {
  id: string;
  label: string;
  sourceKeys: readonly string[];
  hidden: boolean;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_YEAR = /\b(\d{4})-(\d{2})\b/g;
const CONTACT_LIKE = /@|https?:\/\/|\+?\d[\d\s().-]{6,}/i;

export function formatResumeDate(value: string): string {
  return value.replace(MONTH_YEAR, (match, year: string, month: string) => {
    const index = Number(month) - 1;
    return MONTHS[index] ? `${MONTHS[index]} ${year}` : match;
  });
}

export function formatDateRange(value: string): string {
  return formatResumeDate(value)
    .replace(/\s+[-–—]\s+/g, " – ")
    .trim();
}

export function isDateRange(value: string): boolean {
  return /\b\d{4}-\d{2}\b/.test(value) || /\bpresent\b/i.test(value);
}

export function looksLikeHeader(value: string): boolean {
  return value.includes(" · ") || isDateRange(value);
}

export function parseResumeHeader(value: string): {
  title: string;
  organization: string;
  dates: string;
} {
  const parts = value
    .split(" · ")
    .map((part) => part.trim())
    .filter(Boolean);

  let dates = "";
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last && isDateRange(last)) {
      dates = formatDateRange(parts.pop() ?? "");
    }
  }

  return {
    title: parts.shift() ?? "",
    organization: parts.join(" · "),
    dates,
  };
}

function splitPersonalClaim(value: string): { name: string; contact: string } {
  const separator = value.indexOf(" · ");
  if (separator === -1) return { name: value.trim(), contact: "" };
  return {
    name: value.slice(0, separator).trim(),
    contact: value.slice(separator + 3).trim(),
  };
}

function contactPart(value: string): boolean {
  return CONTACT_LIKE.test(value);
}

function groupClaims(claims: Claim[]): Claim[][] {
  const groups = new Map<string, Claim[]>();
  claims.forEach((claim, index) => {
    const key = claim.evidenceIds[0] ?? `solo-${index}`;
    const group = groups.get(key);
    if (group) group.push(claim);
    else groups.set(key, [claim]);
  });
  return [...groups.values()];
}

function buildEntries(key: string, claims: Claim[]): ResumeDocumentEntry[] {
  if (key === "skill") {
    const lines = claims
      .map((claim) => claim.text.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    // Category lines already read like "Languages: TypeScript, Go". Keep them
    // as compact lines. Otherwise join the skills once, comma-separated.
    const categorized = lines.filter((line) => /^[^:]{1,40}:\s*\S/.test(line));
    const compactLines =
      categorized.length === lines.length ? lines : [lines.join(", ")];

    return compactLines.map((text) => ({
      title: text,
      organization: "",
      dates: "",
      bullets: [],
      listItem: true,
    }));
  }

  if (key === "summary") {
    return claims
      .map((claim) => claim.text.trim())
      .filter(Boolean)
      .map((text) => ({
        title: text,
        organization: "",
        dates: "",
        bullets: [],
        listItem: true,
      }));
  }

  return groupClaims(claims).flatMap((group) => {
    const first = group[0];
    if (!first) return [];
    const header = parseResumeHeader(first.text);
    if (!header.title) return [];
    return [
      {
        title: header.title,
        organization: header.organization,
        dates: header.dates,
        bullets: group
          .slice(1)
          .map((claim) => claim.text.trim())
          .filter(Boolean),
        listItem: false,
      },
    ];
  });
}

function sectionRank(order: string[]): Map<string, number> {
  const requested: string[] = [];
  for (const key of order) {
    const definition = RESUME_DOCUMENT_SECTIONS.find(
      (candidate) =>
        candidate.key === key ||
        (candidate.sourceKeys as readonly string[]).includes(key),
    );
    if (definition && !requested.includes(definition.key)) {
      requested.push(definition.key);
    }
  }
  return new Map(requested.map((key, index) => [key, index]));
}

function controlRank(order: string[]): Map<string, number> {
  const requested: string[] = [];
  for (const key of order) {
    const definition = RESUME_DOCUMENT_CONTROL_SECTIONS.find(
      (candidate) =>
        candidate.key === key ||
        (candidate.sourceKeys as readonly string[]).includes(key),
    );
    if (definition && !requested.includes(definition.key)) {
      requested.push(definition.key);
    }
  }
  return new Map(requested.map((key, index) => [key, index]));
}

/**
 * Sections shown in the Section order control: one unique id per document
 * heading, including merged workspace sections. Only sections with at least
 * one claim are listed, matching the previous behavior.
 */
export function documentControlSections(
  resume: Pick<Resume, "sections">,
  order: string[],
  hidden: string[],
): ResumeDocumentControl[] {
  const present = new Set(
    resume.sections
      .filter((section) => section.claims.length > 0)
      .map((section) => section.key),
  );
  const rank = controlRank(order);
  return RESUME_DOCUMENT_CONTROL_SECTIONS.filter((definition) =>
    definition.sourceKeys.some((key) => present.has(key)),
  )
    .map((definition) => {
      const presentSources = definition.sourceKeys.filter((key) =>
        present.has(key),
      );
      return {
        id: definition.key,
        label: definition.label,
        sourceKeys: definition.sourceKeys,
        hidden:
          hidden.includes(definition.key) ||
          (presentSources.length > 0 &&
            presentSources.every((key) => hidden.includes(key))),
      };
    })
    .sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
}

/**
 * Build the document. `hidden` and `order` are presentation preferences; they
 * never delete workspace data. Claims marked `removed` are excluded because
 * printing them would republish deleted information.
 */
export function buildResumeDocument(
  resume: Pick<Resume, "sections">,
  { length, order, hidden }: ResumeDocumentOptions,
): ResumeDocumentModel {
  const byKey = new Map(resume.sections.map((section) => [section.key, section]));
  const allClaims = resume.sections.flatMap((section) => section.claims);
  const removed = allClaims.filter((claim) => claim.removed).length;
  const unconfirmed = allClaims.filter(
    (claim) => !claim.removed && !claim.confirmed,
  ).length;

  const personalClaims = (byKey.get("personal")?.claims ?? []).filter(
    (claim) => !claim.removed,
  );
  let name = "";
  let contact = "";
  const summaryClaims: Claim[] = [
    ...(byKey.get("summary")?.claims ?? []).filter((claim) => !claim.removed),
  ];

  const firstPersonal = personalClaims[0];
  if (firstPersonal && !hidden.includes("personal")) {
    const split = splitPersonalClaim(firstPersonal.text);
    name = split.name;
    if (split.contact) contact = split.contact;
  }

  for (const claim of personalClaims.slice(1)) {
    if (hidden.includes("personal")) break;
    if (contactPart(claim.text)) {
      contact = contact ? `${contact} | ${claim.text}` : claim.text;
    } else {
      summaryClaims.push(claim);
    }
  }

  const rank = sectionRank(order);
  const rawSections: ResumeDocumentSection[] = [];

  for (const definition of RESUME_DOCUMENT_SECTIONS) {
    if (hidden.includes(definition.key)) continue;
    const sourceClaims =
      definition.key === "summary"
        ? summaryClaims
        : definition.sourceKeys.flatMap((key) =>
            hidden.includes(key)
              ? []
              : (byKey.get(key)?.claims ?? []).filter((claim) => !claim.removed),
          );
    if (sourceClaims.length === 0) continue;
    const entries = buildEntries(definition.key, sourceClaims);
    if (entries.length === 0) continue;
    rawSections.push({
      key: definition.key,
      label: definition.label,
      entries,
    });
  }

  rawSections.sort(
    (left, right) =>
      (rank.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.key) ?? Number.MAX_SAFE_INTEGER),
  );

  const personalClaimCount = (name ? 1 : 0) + (contact ? 1 : 0);
  const limit = CLAIM_LIMIT[length];
  const totalClaims =
    personalClaimCount +
    rawSections.reduce(
      (total, section) =>
        total +
        section.entries.reduce(
          (entryTotal, entry) => entryTotal + 1 + entry.bullets.length,
          0,
        ),
      0,
    );

  let visibleClaims = totalClaims;
  if (totalClaims > limit) {
    const sections = rawSections.map((section) => ({
      ...section,
      entries: [...section.entries],
    }));
    for (let index = sections.length - 1; index >= 0 && visibleClaims > limit; index -= 1) {
      const section = sections[index];
      if (!section) continue;
      while (section.entries.length > 0 && visibleClaims > limit) {
        const entry = section.entries.pop();
        if (!entry) break;
        visibleClaims -= 1 + entry.bullets.length;
      }
      if (section.entries.length === 0) sections.splice(index, 1);
    }
    rawSections.length = 0;
    rawSections.push(...sections);
  }

  return {
    name,
    contact,
    sections: rawSections,
    hiddenForLength: Math.max(0, totalClaims - Math.max(0, visibleClaims)),
    unconfirmed,
    removed,
    empty: !name && !contact && rawSections.length === 0,
  };
}
