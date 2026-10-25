import type {
  AtsCheck,
  AtsExample,
  AtsIssue,
  AtsKeyword,
  AtsReport,
  Requirement,
  WorkspaceItem,
  WorkspaceSection,
} from "@/lib/schemas";
import {
  findSkillByTerm,
  mentionsSkill,
  mentionsTerm,
} from "./taxonomy";

/**
 * Deterministic ATS checks (PRD §6.7). Nothing here is a language-model
 * opinion and nothing is a guarantee: each check is a rule, each issue says
 * what was found, and each example is a *presentational* rewrite of the user's
 * own text — same facts, no new claims. The panel always prints the score
 * formula (SCORE_METHODOLOGY_NOTE / ATS_CHECK_NOTE) next to the number.
 */

export interface AtsInput {
  items: WorkspaceItem[];
  requirements: Requirement[];
}

/** Section heading the checks expect to find content for. */
const EXPECTED_HEADINGS: { section: WorkspaceSection; label: string }[] = [
  { section: "education", label: "Education" },
  { section: "experience", label: "Experience" },
  { section: "project", label: "Projects" },
  { section: "skill", label: "Skills" },
];

const PENALTY = { high: 12, med: 7, low: 3 } as const;

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
];

// Contact patterns for ATS checks
const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;
const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i;

// BI/Analytics tools to extract as keywords
const BI_TOOLS = [
  "excel",
  "tableau",
  "power bi",
  "powerbi",
  "looker",
  "metabase",
  "superset",
  "qlik",
  "microstrategy",
  "cognos",
  "sisense",
  "mode",
  "periscope",
  "chartio",
  "redash",
  "google data studio",
  "data studio",
  "datastudio",
];

/** "2025-03" → "Mar 2025". Formatting only; the date itself is unchanged. */
export function monthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1] ?? match[2];
  return `${month} ${match[1]}`;
}

// Type for keyword objects (matches AtsKeyword from schema but with explicit requirementId)
interface KeywordWithId extends AtsKeyword {
  requirementId: string | null | undefined;
}

function dateRange(item: WorkspaceItem, format: "iso" | "label"): string {
  if (!item.startDate) return "";
  const start = format === "iso" ? item.startDate : monthLabel(item.startDate);
  if (!item.endDate) return `${start} – Present`;
  const end = format === "iso" ? item.endDate : monthLabel(item.endDate);
  return `${start} – ${end}`;
}

/** One resume line for an item, used by the before/after examples. */
function headerLine(item: WorkspaceItem, format: "iso" | "label"): string {
  const parts = [item.title];
  if (item.organization) parts.push(item.organization);
  const range = dateRange(item, format);
  if (range) parts.push(range);
  return parts.join(" · ");
}

function splitBullet(bullet: string): string {
  const trimmed = bullet.trim();
  if (trimmed.length <= 160) return trimmed;
  const sentenceEnd = trimmed.slice(0, 200).search(/\.\s/);
  const cutAt =
    sentenceEnd > 60
      ? sentenceEnd + 1
      : trimmed.slice(0, 160).lastIndexOf(" ") > 60
        ? trimmed.slice(0, 160).lastIndexOf(" ")
        : 160;
  return `${trimmed.slice(0, cutAt).trim()}\n${trimmed.slice(cutAt).trim()}`;
}

/** Everything the standard resume would contain, lower-cased for keyword hits. */
export function resumeTextOf(items: WorkspaceItem[]): string {
  return items
    .map((item) =>
      [item.title, item.organization ?? "", ...item.tags, ...item.bullets].join(" "),
    )
    .join(" \n ")
    .toLowerCase();
}

/**
 * Is this keyword readable in the resume text? Uses the taxonomy when the
 * keyword names a known skill so aliases count ("integration tests" answers
 * "Automated testing"), and whole-word matching either way so "reactive" never
 * counts as "React".
 */
function keywordPresent(resumeText: string, keyword: string): boolean {
  const skill = findSkillByTerm(keyword);
  return skill
    ? mentionsSkill(resumeText, skill)
    : mentionsTerm(resumeText, keyword);
}

export function computeAtsReport(input: AtsInput): AtsReport {
  const items = input.items;
  const issues: AtsIssue[] = [];
  const examples: AtsExample[] = [];
  const checks: AtsCheck[] = [];

  const sectionsPresent = new Set(items.map((item) => item.section));

  /* 1. Standard headings ------------------------------------------------ */
  const missingHeadings = EXPECTED_HEADINGS.filter(
    (heading) => !sectionsPresent.has(heading.section),
  );
  if (missingHeadings.length > 0) {
    const labels = missingHeadings.map((h) => h.label);
    // Downgrade "Experience" to low if internship section exists
    let severity: "high" | "med" | "low" = "med";
    if (
      missingHeadings.some((h) => h.section === "experience") &&
      sectionsPresent.has("internship")
    ) {
      severity = "low";
    }
    const issue: AtsIssue = {
      id: "ats-headings",
      severity,
      message: `No ${labels.join(", ")} content to place under a standard heading.`,
      fix: `Add ${labels.map((l) => l.toLowerCase()).join(", ")} items in your workspace — parsers look for those headings.`,
      check: "Standard headings",
    };
    issues.push(issue);
    checks.push({
      id: "headings",
      label: "Standard section headings",
      status: "issue",
      detail: `Missing: ${labels.join(", ")}.`,
      issueIds: [issue.id],
    });
  } else {
    checks.push({
      id: "headings",
      label: "Standard section headings",
      status: "pass",
      detail: "Education, experience, projects and skills all have content.",
      issueIds: [],
    });
  }

  /* 2. Month-precision dates ------------------------------------------- */
  const undated = items.filter(
    (item) =>
      (item.section === "experience" ||
        item.section === "internship" ||
        item.section === "education") &&
      !item.startDate,
  );
  if (undated.length > 0) {
    const issue: AtsIssue = {
      id: "ats-dates",
      severity: "med",
      message: `${undated.length} dated section ${undated.length === 1 ? "item has" : "items have"} no start date.`,
      fix: "Add a month-precision start date (YYYY-MM) to each role and qualification.",
      check: "Dates present",
    };
    issues.push(issue);
    checks.push({
      id: "dates",
      label: "Month-precision dates",
      status: "issue",
      detail: undated.map((item) => item.title).join(", "),
      issueIds: [issue.id],
    });
  } else {
    checks.push({
      id: "dates",
      label: "Month-precision dates",
      status: "pass",
      detail: "Every role and qualification carries a start date.",
      issueIds: [],
    });
  }

  const firstDated = items.find(
    (item) => item.startDate && item.endDate && item.section !== "skill",
  );
  if (firstDated) {
    examples.push({
      id: "example-dates",
      issueId: undated.length > 0 ? "ats-dates" : "ats-format",
      before: headerLine(firstDated, "iso"),
      after: headerLine(firstDated, "label"),
      note: "Formatting only — the same dates, rendered the way people read them. No detail was invented.",
    });
  }

  /* 3. Detail lines ----------------------------------------------------- */
  const detailSections: WorkspaceSection[] = ["experience", "internship", "project"];
  const emptyDetail = items.filter(
    (item) => detailSections.includes(item.section) && item.bullets.length === 0,
  );
  if (emptyDetail.length > 0) {
    const issue: AtsIssue = {
      id: "ats-bullets",
      severity: "med",
      message: `${emptyDetail.length} ${emptyDetail.length === 1 ? "entry has" : "entries have"} no detail lines.`,
      fix: "Add one or two lines describing what you did and what changed, using numbers you can defend.",
      check: "Detail lines",
    };
    issues.push(issue);
    checks.push({
      id: "bullets",
      label: "Detail lines on roles and projects",
      status: "issue",
      detail: emptyDetail.map((item) => item.title).join(", "),
      issueIds: [issue.id],
    });
  } else if (items.some((item) => detailSections.includes(item.section))) {
    checks.push({
      id: "bullets",
      label: "Detail lines on roles and projects",
      status: "pass",
      detail: "Every role and project has at least one detail line.",
      issueIds: [],
    });
  }

  /* 4. Overlong lines --------------------------------------------------- */
  const longBullets = items.flatMap((item) =>
    item.bullets
      .filter((bullet) => bullet.trim().length > 200)
      .map((bullet) => ({ item, bullet: bullet.trim() })),
  );
  if (longBullets.length > 0) {
    const issue: AtsIssue = {
      id: "ats-long-lines",
      severity: "low",
      message: `${longBullets.length} detail ${longBullets.length === 1 ? "line runs" : "lines run"} past 200 characters.`,
      fix: "Split long lines into two shorter ones so a reader can scan them.",
      check: "Line length",
    };
    issues.push(issue);
    checks.push({
      id: "line-length",
      label: "Scannable line length",
      status: "issue",
      detail: longBullets.map((entry) => entry.item.title).join(", "),
      issueIds: [issue.id],
    });
    const sample = longBullets[0];
    examples.push({
      id: "example-long-line",
      issueId: issue.id,
      before: sample.bullet,
      after: splitBullet(sample.bullet),
      note: "Formatting only — the same sentence, broken in two. No words were added or removed.",
    });
  } else if (items.some((item) => detailSections.includes(item.section))) {
    checks.push({
      id: "line-length",
      label: "Scannable line length",
      status: "pass",
      detail: "No detail line is over 200 characters.",
      issueIds: [],
    });
  }

  /* 5. Keyword coverage (PRD §6.7) -------------------------------------- */
  // A keyword is a *term*, not a sentence. Only the skill requirements become
  // keywords: experience, education and seniority lines are prose, and counting
  // them would report "50% coverage" for a posting that is fully evidenced.
  const resumeText = resumeTextOf(items);
  const keywords: KeywordWithId[] = input.requirements
    .filter((requirement) => !requirement.pattern)
    .map((requirement) => ({
      keyword: requirement.text,
      // Matched the same way the analysis matches skills (label *or* alias, on
      // whole words) so "Automated testing" is present when the resume says
      // "integration tests", and "React" is never present because a bullet says
      // "reactive".
      present: keywordPresent(resumeText, requirement.text),
      requirementId: requirement.id,
    }));
  // Also extract BI/analytics tools from all requirements and check resume
  const biToolsFound = new Set<string>();
  for (const requirement of input.requirements) {
    const reqLower = requirement.text.toLowerCase();
    for (const tool of BI_TOOLS) {
      if (reqLower.includes(tool)) {
        biToolsFound.add(tool);
      }
    }
  }
  for (const tool of biToolsFound) {
    if (!keywords.some((k) => k.keyword.toLowerCase() === tool)) {
      keywords.push({
        keyword: tool.charAt(0).toUpperCase() + tool.slice(1),
        present: keywordPresent(resumeText, tool),
        requirementId: undefined,
      });
    }
  }
  const present = keywords.filter((keyword) => keyword.present).length;
  const coverage =
    keywords.length === 0 ? 0 : Math.round((present / keywords.length) * 100);

  if (keywords.length > 0) {
    if (coverage < 60) {
      const issue: AtsIssue = {
        id: "ats-keywords",
        severity: coverage < 40 ? "high" : "med",
        message: `Only ${coverage}% of this job's keywords appear in the text of your resume (${present} of ${keywords.length}).`,
        fix: "Add the keywords you can honestly back with evidence; the gaps list below shows which ones need a new project or course first.",
        check: "Keyword coverage",
      };
      issues.push(issue);
      checks.push({
        id: "keywords",
        label: "Job keywords present",
        status: "issue",
        detail: `${coverage}% coverage — missing ${keywords
          .filter((keyword) => !keyword.present)
          .map((keyword) => keyword.keyword)
          .join(", ")}.`,
        issueIds: [issue.id],
      });
    } else {
      checks.push({
        id: "keywords",
        label: "Job keywords present",
        status: "pass",
        detail: `${coverage}% coverage (${present} of ${keywords.length} terms).`,
        issueIds: [],
      });
    }
  }

  /* 6. Contact details -------------------------------------------------- */
  if (!sectionsPresent.has("personal")) {
    const issue: AtsIssue = {
      id: "ats-contact",
      severity: "low",
      message: "No personal details item, so the resume has no header block.",
      fix: "Add a personal details item with the name and links you want shown.",
      check: "Contact block",
    };
    issues.push(issue);
    checks.push({
      id: "contact",
      label: "Contact block present",
      status: "issue",
      detail: "No personal details item.",
      issueIds: [issue.id],
    });
  } else {
    const personalItems = items.filter((item) => item.section === "personal");
    const contactIssues: string[] = [];
    for (const p of personalItems) {
      const allText = [p.title, p.organization ?? "", ...p.bullets, ...p.links].join(" ").toLowerCase();
      const hasPhone = PHONE_RE.test(allText);
      const hasEmail = EMAIL_RE.test(allText);
      const hasLinkedIn = LINKEDIN_RE.test(allText);
      const hasGitHub = GITHUB_RE.test(allText);
      const hasSummary = p.bullets.some((b) => b.length > 50) || (p.organization && p.organization.length > 50);
      if (!hasPhone) contactIssues.push("phone");
      if (!hasEmail) contactIssues.push("email");
      if (!hasLinkedIn) contactIssues.push("LinkedIn");
      if (!hasGitHub) contactIssues.push("GitHub");
      if (!hasSummary) contactIssues.push("summary");
    }
    if (contactIssues.length > 0) {
      const issue: AtsIssue = {
        id: "ats-contact",
        severity: "low",
        message: `Personal details missing: ${contactIssues.join(", ")}.`,
        fix: "Add phone, email, LinkedIn, GitHub, and a professional summary to your personal details.",
        check: "Contact details",
      };
      issues.push(issue);
      checks.push({
        id: "contact",
        label: "Contact details complete",
        status: "issue",
        detail: `Missing: ${contactIssues.join(", ")}.`,
        issueIds: [issue.id],
      });
    } else {
      checks.push({
        id: "contact",
        label: "Contact details complete",
        status: "pass",
        detail: "Phone, email, LinkedIn, GitHub, and summary all present.",
        issueIds: [],
      });
    }
  }

  /* 7. Layout — honestly not checked yet -------------------------------- */
  checks.push({
    id: "layout",
    label: "Single-column layout",
    status: "not_checked",
    detail:
      "Layout checks run on the rendered PDF, which lands with export in F5. Nothing is claimed about it yet.",
    issueIds: [],
  });

  const penalty = issues.reduce(
    (total, issue) => total + PENALTY[issue.severity],
    0,
  );

  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    keywordCoverage: coverage,
    keywords,
    checks,
    issues,
    examples,
  };
}
