import type {
  ExtractedField,
  ExtractionItem,
  ImportFileType,
  ImportReviewItem,
  ImportSession,
} from "@/lib/schemas";

/**
 * Simulated document extraction (PRD §6.2 IM-1..IM-3).
 *
 * This build has no parser: this module fabricates *the document*, never a
 * claim about the user. Every name in the sample text is deliberately
 * unmistakable — "Sample …" throughout — so nothing here can be mistaken for
 * something read out of the user's own file, and the review screen shows a
 * "Sample" tag on every card and a demo-mode banner above them. Each generated
 * field records the line of the simulated preview it was read from, so the
 * side-by-side review is coherent and every highlighted value can be checked
 * against its source line.
 *
 * Three outcomes are produced deterministically, so tests and demos are stable:
 *  - file name containing "cert"  → a certificate with a credential link
 *    (confirms as Verified, PRD IM-3);
 *  - name containing "scanned" or a file under 1 KB → nothing readable, which
 *    exercises the "we couldn't read this document" state;
 *  - anything else → a two-role sample resume with two uncertain fields.
 */

const RESUME_LINES = [
  "SAMPLE APPLICANT",
  "Sample City · sample.applicant@example.com",
  "",
  "EXPERIENCE",
  "Backend Intern",
  "Sample Payments Ltd",
  "2024-06 – 2024-09",
  "Built an internal reporting endpoint used by the support team.",
  "Wrote integration tests for the refund flow.",
  "",
  "EDUCATION",
  "B.Sc. Information Technology",
  "Sample State University",
  "2021-08 – 2025-05",
  "",
  "PROJECTS",
  "Sample Recipe Box",
  "Personal project",
  "2025-01",
  "A small recipe organiser built with React and TypeScript.",
  "",
  "SKILLS",
  "TypeScript, React, PostgreSQL",
];

const CERTIFICATE_LINES = [
  "CERTIFICATE OF COMPLETION",
  "Sample Cloud Fundamentals",
  "Issued to: Sample Applicant",
  "Issued by: Sample Learning",
  "Issued: 2025-03",
  "Credential ID: SAMPLE-1234",
  "Verify at: https://example.com/credentials/sample-1234",
];

/** 1-based line number of the first preview line containing `needle`. */
function lineOf(lines: string[], needle: string): number {
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

function field(
  key: ExtractedField["key"],
  label: string,
  value: string,
  confidence: number,
  sourceLine: number,
): ExtractedField {
  return { key, label, value, confidence, sourceLine };
}

/** Whole-item confidence is the weakest field — the conservative reading. */
function buildItem(input: {
  id: string;
  section: ExtractionItem["section"];
  fields: ExtractedField[];
  bullets?: string[];
  tags?: string[];
}): ExtractionItem {
  return {
    id: input.id,
    section: input.section,
    fields: input.fields,
    bullets: input.bullets ?? [],
    tags: input.tags ?? [],
    confidence: Math.min(...input.fields.map((entry) => entry.confidence)),
  };
}

function valuesFrom(fields: ExtractedField[]) {
  const get = (key: ExtractedField["key"]) =>
    fields.find((entry) => entry.key === key)?.value ?? "";
  return {
    title: get("title"),
    organization: get("organization"),
    startDate: get("startDate"),
    endDate: get("endDate"),
    location: get("location"),
    bullets: [] as string[],
    tags: [] as string[],
  };
}

function toReviewItem(
  extraction: ExtractionItem,
  support: ImportReviewItem["support"] = null,
): ImportReviewItem {
  return {
    id: extraction.id,
    extraction,
    values: {
      ...valuesFrom(extraction.fields),
      bullets: extraction.bullets,
      tags: extraction.tags,
    },
    status: "pending",
    support,
    decidedAt: null,
  };
}

function resumeItems(lines: string[]): ImportReviewItem[] {
  const internship = buildItem({
    id: "ext-internship",
    section: "internship",
    fields: [
      field("title", "Role", "Backend Intern", 0.94, lineOf(lines, "Backend Intern")),
      // Uncertain: the parser only half-trusts the employer line.
      field("organization", "Employer", "Sample Payments Ltd", 0.68, lineOf(lines, "Sample Payments Ltd")),
      field("startDate", "Start", "2024-06", 0.9, lineOf(lines, "2024-06 – 2024-09")),
      // Uncertain: the end date is close to another date in the document.
      field("endDate", "End", "2024-09", 0.55, lineOf(lines, "2024-06 – 2024-09")),
    ],
    bullets: [
      lines[lineOf(lines, "Built an internal reporting") - 1],
      lines[lineOf(lines, "Wrote integration tests") - 1],
    ],
    tags: ["testing"],
  });

  const education = buildItem({
    id: "ext-education",
    section: "education",
    fields: [
      field("title", "Qualification", "B.Sc. Information Technology", 0.93, lineOf(lines, "B.Sc. Information")),
      field("organization", "Institution", "Sample State University", 0.9, lineOf(lines, "Sample State University")),
      field("startDate", "Start", "2021-08", 0.88, lineOf(lines, "2021-08 – 2025-05")),
      field("endDate", "End", "2025-05", 0.7, lineOf(lines, "2021-08 – 2025-05")),
    ],
  });

  const project = buildItem({
    id: "ext-project",
    section: "project",
    fields: [
      field("title", "Project", "Sample Recipe Box", 0.9, lineOf(lines, "Sample Recipe Box")),
      field("organization", "Context", "Personal project", 0.85, lineOf(lines, "Personal project")),
      field("startDate", "Start", "2025-01", 0.8, lineOf(lines, "2025-01")),
      // Nothing to read: flagged as uncertain so the user decides (ongoing?).
      field("endDate", "End", "", 0.3, lineOf(lines, "2025-01")),
    ],
    bullets: [lines[lineOf(lines, "A small recipe organiser") - 1]],
    tags: ["react", "typescript"],
  });

  // Skills are reviewed as a single card of chips, not one card per skill, and
  // the extraction keeps the individual names in `tags` (PRD §6.1 WS-3).
  const skillLine = lineOf(lines, "TypeScript, React, PostgreSQL");
  const skills = buildItem({
    id: "ext-skills",
    section: "skill",
    fields: [field("title", "Skills", "Skills", 0.92, skillLine)],
    tags: ["TypeScript", "React", "PostgreSQL"],
  });

  const personal = buildItem({
    id: "ext-personal",
    section: "personal",
    fields: [
      field("title", "Name", "Sample Applicant", 0.95, lineOf(lines, "SAMPLE APPLICANT")),
      field("location", "Location", "Sample City", 0.8, lineOf(lines, "Sample City")),
    ],
  });

  return [
    personal,
    internship,
    education,
    project,
    skills,
  ].map((item) => toReviewItem(item));
}

function certificateItems(lines: string[]): ImportReviewItem[] {
  const certificate = buildItem({
    id: "ext-certificate",
    section: "certificate",
    fields: [
      field("title", "Certificate", "Sample Cloud Fundamentals", 0.9, lineOf(lines, "Sample Cloud Fundamentals")),
      field("organization", "Issuer", "Sample Learning", 0.9, lineOf(lines, "Issued by")),
      field("endDate", "Issued", "2025-03", 0.85, lineOf(lines, "Issued: 2025-03")),
    ],
    tags: ["cloud"],
  });
  return [
    toReviewItem(certificate, {
      kind: "link",
      url: "https://example.com/credentials/sample-1234",
    }),
  ];
}

export interface ImportSessionInput {
  id: string;
  fileName: string;
  fileType: ImportFileType;
  fileSize: number;
  now: string;
}

export function buildImportSession(input: ImportSessionInput): ImportSession {
  const lower = input.fileName.toLowerCase();
  const isCertificate = lower.includes("cert");
  const unreadable = lower.includes("scanned") || input.fileSize < 1024;

  const lines = isCertificate ? CERTIFICATE_LINES : RESUME_LINES;
  const items = unreadable
    ? []
    : isCertificate
      ? certificateItems(lines)
      : resumeItems(lines);

  return {
    id: input.id,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
    pageCount: 1,
    sourceText: unreadable ? "" : lines.join("\n"),
    // Every supported format gets a text preview in F4. The flag exists so a
    // future image-only upload renders the "no preview" state instead of an
    // empty panel (see `import-review.tsx`).
    previewAvailable: !unreadable,
    items,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Human note about what the simulated preview does and does not show. */
export function previewNote(fileType: ImportFileType): string {
  return fileType === "pdf"
    ? "Simulated text preview — layout, columns and images are not rendered in F4."
    : "Simulated text-only preview — DOCX formatting is not rendered in F4.";
}
