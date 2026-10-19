import { z } from "zod";
import {
  MonthValueSchema,
  WorkspaceSectionSchema,
  type WorkspaceItem,
  type WorkspaceSection,
} from "./workspace";

/**
 * Upload + extraction review contract (PRD §6.2 IM-1..IM-3, §7.5
 * `/workspace/import`). These are the shapes the B2 backend must serve; the
 * MSW handlers implement them today and nothing here reaches a real parser.
 *
 * The hard rule from PRD §4/§6: nothing enters the workspace until the user
 * confirms each item (IM-2), and a confirmed item is only *Verified* when a
 * certificate document or link is attached (IM-3).
 */

/** IM-1: only PDF and DOCX are accepted. */
export const IMPORT_FILE_TYPES = ["pdf", "docx"] as const;
export const ImportFileTypeSchema = z.enum(IMPORT_FILE_TYPES);
export type ImportFileType = z.infer<typeof ImportFileTypeSchema>;

/** IM-1: 5 MiB cap, mirroring the backend request-size guard (PRD §11). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Accepted `accept` attribute for the file input. */
export const IMPORT_ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Human-readable limit shown next to the dropzone. */
export const IMPORT_LIMITS_COPY = "PDF or DOCX · up to 5 MB";

export function importFileTypeOf(fileName: string): ImportFileType | null {
  const extension = fileName.trim().toLowerCase().split(".").pop();
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  return null;
}

export type ImportUploadCheck =
  | { ok: true; fileType: ImportFileType }
  | { ok: false; reason: string };

/**
 * Client-side upload gate (PRD §11 "upload type, size and content checks").
 * The backend re-checks all of this; failing here only saves a round trip.
 */
export function validateImportUpload(file: {
  name: string;
  size: number;
}): ImportUploadCheck {
  const fileType = importFileTypeOf(file.name);
  if (!fileType) {
    return { ok: false, reason: "Only PDF and DOCX files can be imported." };
  }
  if (file.size <= 0) {
    return { ok: false, reason: "That file looks empty. Pick another one." };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, reason: "Files must be 5 MB or smaller." };
  }
  return { ok: true, fileType };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };

/**
 * Parser confidence below this value marks a field as *uncertain*, so the
 * review screen highlights it for verification (IM-2). Documented rather than
 * hidden: the review UI prints the threshold it uses.
 */
export const UNCERTAIN_CONFIDENCE = 0.75;

/**
 * Demo-mode disclosure (PRD §4, §6.2). There is no parser in this build, so the
 * review is explicitly and prominently labelled as sample data — a user must
 * never be able to mistake it for their own file. The exact sentence is shared
 * by the banner and the test so the two cannot drift apart.
 */
export const DEMO_MODE_COPY =
  "Demo mode: this preview is sample data. Your file was not read.";

/** Workspace field a single extracted value maps onto. */
export const ExtractedFieldKeySchema = z.enum([
  "title",
  "organization",
  "startDate",
  "endDate",
  "location",
]);
export type ExtractedFieldKey = z.infer<typeof ExtractedFieldKeySchema>;

export const ExtractedFieldSchema = z.object({
  key: ExtractedFieldKeySchema,
  /** Human label shown in the review table. */
  label: z.string(),
  value: z.string(),
  /** Parser confidence 0–1 for this field. */
  confidence: z.number().min(0).max(1),
  /** 1-based line of the mock document preview this value came from. */
  sourceLine: z.number().int().positive(),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

/**
 * One candidate workspace item produced by the parser. It is only a proposal:
 * `ImportReviewItem.status` records whether the user has accepted it.
 */
export const ExtractionItemSchema = z.object({
  id: z.string(),
  section: WorkspaceSectionSchema,
  fields: z.array(ExtractedFieldSchema).min(1),
  bullets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /**
   * Whole-item confidence: the weakest field confidence. A single shaky field
   * makes the whole item worth a look, which is the conservative reading.
   */
  confidence: z.number().min(0).max(1),
});
export type ExtractionItem = z.infer<typeof ExtractionItemSchema>;

export const ImportItemStatusSchema = z.enum([
  "pending",
  "confirmed",
  "rejected",
]);
export type ImportItemStatus = z.infer<typeof ImportItemStatusSchema>;

/** IM-3: supporting evidence attached during review. `null` = none yet. */
export const ImportSupportSchema = z.union([
  z.object({ kind: z.literal("file"), name: z.string().min(1) }),
  z.object({ kind: z.literal("link"), url: z.string().min(1) }),
]);
export type ImportSupport = z.infer<typeof ImportSupportSchema>;

/**
 * Editable values for a candidate item. The user verifies (and may correct)
 * every field before confirming; the extraction itself stays untouched so the
 * review can always show what was read versus what was accepted.
 */
export const ImportItemValuesSchema = z
  .object({
    title: z.string().trim().max(200),
    organization: z.string().trim().max(200),
    startDate: MonthValueSchema,
    endDate: MonthValueSchema,
    location: z.string().trim().max(200),
    bullets: z.array(z.string().trim().max(600)).max(30).default([]),
    tags: z.array(z.string().trim().max(40)).max(30).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The end date can't be before the start date.",
      });
    }
  });
export type ImportItemValues = z.infer<typeof ImportItemValuesSchema>;

export const ImportReviewItemSchema = z.object({
  id: z.string(),
  extraction: ExtractionItemSchema,
  values: ImportItemValuesSchema,
  status: ImportItemStatusSchema.default("pending"),
  support: ImportSupportSchema.nullable().default(null),
  decidedAt: z.string().nullish(),
});
export type ImportReviewItem = z.infer<typeof ImportReviewItemSchema>;

export const ImportSessionSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: ImportFileTypeSchema,
  fileSize: z.number().int().nonnegative(),
  /** Simulated page count of the parsed document. */
  pageCount: z.number().int().positive(),
  /**
   * Simulated document text used by the side-by-side preview. F4 has no real
   * parser, so this is generated mock content and is labelled as such in the
   * UI — it is never presented as the user's real document.
   */
  sourceText: z.string(),
  /** False when the mock cannot render a preview for this format. */
  previewAvailable: z.boolean(),
  items: z.array(ImportReviewItemSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ImportSession = z.infer<typeof ImportSessionSchema>;

/** List row for `GET /imports` (no document text). */
export const ImportSummarySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: ImportFileTypeSchema,
  itemCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ImportSummary = z.infer<typeof ImportSummarySchema>;

/** Fields the review screen must flag for verification (IM-2). */
export function uncertainFields(item: ImportReviewItem): ExtractedField[] {
  return item.extraction.fields.filter(
    (field) => field.confidence < UNCERTAIN_CONFIDENCE,
  );
}

export function isUncertainItem(item: ImportReviewItem): boolean {
  return uncertainFields(item).length > 0;
}

/**
 * IM-3 evidence rule: a supporting certificate file or link makes the item
 * *Verified*; without one the item can only ever be *User-attested*.
 */
export function evidenceForReviewItem(
  item: ImportReviewItem,
): "verified" | "attested" {
  return item.support ? "verified" : "attested";
}

/**
 * Which editable fields make sense for each section (PRD §6.1 WS-3, §6.2 IM-2).
 *
 * A personal detail is a name and a location: it has no employer, no dates and
 * no certificate, and the workspace does not model those there. A skill is a
 * name and nothing else, so skills are reviewed together as one card of chips
 * rather than one card each. The full field set on every section would invite
 * users to type information that can be stored nowhere and evidenced never.
 */
export type ReviewDateMode = "none" | "range" | "issued";

export interface ReviewFieldPolicy {
  /** Label for the single editable title field; `null` when the section has none. */
  titleLabel: string | null;
  /** Label for the organisation field; `null` when the section has none. */
  organizationLabel: string | null;
  /** `range` = start + end month; `issued` = one issued month; `none` = no dates. */
  dateMode: ReviewDateMode;
  location: boolean;
  bullets: boolean;
  /** Tags are the skills: render them as removable chips and review as one card. */
  skillChips: boolean;
  /** Show the free-text keyword input (never alongside `skillChips`). */
  keywords: boolean;
  /** Copy for the supporting-evidence control, or `null` when none applies. */
  supportLabel: string | null;
}

const REVIEW_FIELD_POLICIES: Record<WorkspaceSection, ReviewFieldPolicy> = {
  personal: {
    titleLabel: "Full name",
    organizationLabel: null,
    dateMode: "none",
    location: true,
    bullets: false,
    skillChips: false,
    keywords: false,
    supportLabel: null,
  },
  education: {
    titleLabel: "Qualification",
    organizationLabel: "Institution",
    dateMode: "range",
    location: true,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "certificate or transcript",
  },
  experience: {
    titleLabel: "Role",
    organizationLabel: "Employer",
    dateMode: "range",
    location: true,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "reference or certificate",
  },
  internship: {
    titleLabel: "Role",
    organizationLabel: "Employer",
    dateMode: "range",
    location: true,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "certificate",
  },
  project: {
    titleLabel: "Project",
    organizationLabel: "Context",
    dateMode: "range",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "repository or demo link",
  },
  skill: {
    titleLabel: null,
    organizationLabel: null,
    dateMode: "none",
    location: false,
    bullets: false,
    skillChips: true,
    keywords: false,
    supportLabel: null,
  },
  achievement: {
    titleLabel: "Award",
    organizationLabel: "Awarding body",
    dateMode: "issued",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "award certificate",
  },
  extracurricular: {
    titleLabel: "Activity",
    organizationLabel: "Organisation",
    dateMode: "range",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "supporting link",
  },
  certificate: {
    titleLabel: "Certificate",
    organizationLabel: "Issuer",
    dateMode: "issued",
    location: false,
    bullets: false,
    skillChips: false,
    keywords: true,
    supportLabel: "certificate",
  },
  course: {
    titleLabel: "Course",
    organizationLabel: "Provider",
    dateMode: "range",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "completion certificate",
  },
  publication: {
    titleLabel: "Title",
    organizationLabel: "Venue or publisher",
    dateMode: "issued",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "DOI or publisher link",
  },
  training: {
    titleLabel: "Programme",
    organizationLabel: "Provider",
    dateMode: "range",
    location: false,
    bullets: true,
    skillChips: false,
    keywords: true,
    supportLabel: "completion certificate",
  },
};

export function reviewFieldPolicy(section: WorkspaceSection): ReviewFieldPolicy {
  return REVIEW_FIELD_POLICIES[section];
}

/**
 * The create payload sent to `POST /workspace/items` when the user confirms a
 * single-item section. Derived from the reviewed values — never from the raw
 * extraction — so what the user read on screen is exactly what enters the
 * workspace. Only the fields the section's policy actually shows are carried
 * across, and a skills card (one card, many chips) must go through
 * `reviewItemToWorkspaceInputs` instead.
 */
export function reviewItemToWorkspaceInput(
  item: ImportReviewItem,
): Omit<WorkspaceItem, "id"> {
  const policy = reviewFieldPolicy(item.extraction.section);
  if (policy.skillChips) {
    throw new Error(
      "A skills card creates one item per chip — use reviewItemToWorkspaceInputs().",
    );
  }
  const evidence = evidenceForReviewItem(item);
  const support = item.support;
  return {
    section: item.extraction.section,
    title: item.values.title.trim(),
    organization: policy.organizationLabel
      ? item.values.organization.trim() || undefined
      : undefined,
    startDate:
      policy.dateMode === "range" ? item.values.startDate || undefined : undefined,
    endDate:
      policy.dateMode === "none" ? undefined : item.values.endDate || undefined,
    location: policy.location ? item.values.location.trim() || undefined : undefined,
    bullets: policy.bullets
      ? item.values.bullets.map((bullet) => bullet.trim()).filter(Boolean)
      : [],
    tags: policy.keywords
      ? item.values.tags.map((tag) => tag.trim()).filter(Boolean)
      : [],
    // A link is also an evidence link for the workspace item; a file becomes
    // an attachment so `Verified` stays true to its definition (PRD §4.2).
    links: support?.kind === "link" ? [support.url] : [],
    attachments:
      support?.kind === "file"
        ? [{ id: `att-${item.id}`, name: support.name, url: `mock://${item.id}` }]
        : [],
    evidence,
    order: 0,
  };
}

/**
 * Every workspace item a confirm should create. A skills card is one review card
 * holding many chips, so it becomes one `skill` item per chip — the workspace
 * models skills one per item and the analysis engine matches each separately.
 * Every other section maps to exactly one item.
 */
export function reviewItemToWorkspaceInputs(
  item: ImportReviewItem,
): Omit<WorkspaceItem, "id">[] {
  const policy = reviewFieldPolicy(item.extraction.section);
  if (!policy.skillChips) return [reviewItemToWorkspaceInput(item)];

  const skills = [...new Set(item.values.tags.map((tag) => tag.trim()).filter(Boolean))];
  return skills.map((skill) => ({
    section: item.extraction.section,
    title: skill,
    organization: undefined,
    startDate: undefined,
    endDate: undefined,
    location: undefined,
    bullets: [],
    tags: [],
    links: [],
    attachments: [],
    // Skills carry no certificate control, so a skill is always User-attested (IM-3).
    evidence: "attested" as const,
    order: 0,
  }));
}

/** Why an item cannot be confirmed yet, or `null` when it is ready. */
export function reviewItemProblem(item: ImportReviewItem): string | null {
  const policy = reviewFieldPolicy(item.extraction.section);
  if (policy.skillChips) {
    return item.values.tags.some((tag) => tag.trim())
      ? null
      : "Add at least one skill before confirming — nothing is saved without a skill.";
  }
  const parsed = ImportItemValuesSchema.safeParse(item.values);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    if (first?.path[0] === "title") {
      return "Add a title before confirming — nothing is saved without one.";
    }
    return first?.message ?? "Check the highlighted fields.";
  }
  if (item.values.title.trim() === "") {
    return "Add a title before confirming — nothing is saved without one.";
  }
  return null;
}

export interface ReviewProgress {
  total: number;
  pending: number;
  confirmed: number;
  rejected: number;
}

export function reviewProgress(items: ImportReviewItem[]): ReviewProgress {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    confirmed: items.filter((item) => item.status === "confirmed").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
}

/** Human label for the evidence state a review item would produce (IM-3). */
export function reviewSupportLabel(item: ImportReviewItem): string {
  if (!item.support) return "No certificate attached yet";
  return item.support.kind === "file"
    ? `Certificate file: ${item.support.name}`
    : `Certificate link: ${item.support.url}`;
}
