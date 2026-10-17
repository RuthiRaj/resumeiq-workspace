import { z } from "zod";

/** Evidence states (PRD §4). Every workspace item carries exactly one. */
export const EvidenceStateSchema = z.enum([
  "verified",
  "attested",
  "related",
  "missing",
]);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

/** Workspace sections (PRD §6.1 WS-1). */
export const WorkspaceSectionSchema = z.enum([
  "personal",
  "education",
  "experience",
  "internship",
  "project",
  "skill",
  "achievement",
  "extracurricular",
  "certificate",
  "course",
  "publication",
  "training",
]);
export type WorkspaceSection = z.infer<typeof WorkspaceSectionSchema>;

/**
 * Canonical display/derivation order (matches PRD WS-1 order). UI metadata
 * (labels, icons) lives in `features/workspace/sections.ts`; this list is kept
 * dependency-free so the mock API can use it without pulling in UI code.
 */
export const WORKSPACE_SECTION_ORDER = [
  "personal",
  "education",
  "experience",
  "internship",
  "project",
  "skill",
  "achievement",
  "extracurricular",
  "certificate",
  "course",
  "publication",
  "training",
] as const satisfies readonly WorkspaceSection[];

/**
 * Dev-only sample workspaces (PRD §8.5). Never a real user property — the
 * persona switcher only exists in `next dev`. `empty` models a brand-new
 * workspace so the designed empty states are reachable on demand.
 */
export const WorkspacePersonaSchema = z.enum(["fresher", "midlevel", "empty"]);
export type WorkspacePersona = z.infer<typeof WorkspacePersonaSchema>;

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * Workspace item as returned by `GET /workspace` (B1 OpenAPI
 * `WorkspaceItemResponse`). Optional text fields are *nullable* on the wire
 * (`string | null`), so they must be modelled as `nullish` — `.optional()`
 * alone rejects a `null` the backend legitimately sends for "not set".
 */
export const WorkspaceItemSchema = z.object({
  id: z.string(),
  section: WorkspaceSectionSchema,
  title: z.string().min(1, "Title is required"),
  organization: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  location: z.string().nullish(),
  bullets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  evidence: EvidenceStateSchema,
  order: z.number(),
  deletedAt: z.string().nullish(),
});
export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;

export const WorkspaceSchema = z.object({
  version: z.number().int().nonnegative(),
  items: z.array(WorkspaceItemSchema),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/**
 * Change-log operation (PRD §6.1 WS-4, ADR-013/ADR-017). `restore` is the undo
 * of a soft delete: the B1 database stores it as its own `action`, so the
 * frontend models it explicitly rather than collapsing every undo into `edit`.
 * The current B1 wire mapper still surfaces a restore as `edit`; the backend
 * should send `restore` verbatim once reconciled (see docs/DECISIONS.md).
 */
export const WorkspaceChangeOpSchema = z.enum([
  "add",
  "edit",
  "delete",
  "reorder",
  "restore",
]);
export type WorkspaceChangeOp = z.infer<typeof WorkspaceChangeOpSchema>;

export const WorkspaceChangeLogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  workspaceVersion: z.number().int().nonnegative(),
  itemId: z.string(),
  op: WorkspaceChangeOpSchema,
  at: z.string(),
  /**
   * Human label for the affected item, captured at write time so the log stays
   * readable after a soft delete. Nullable on the wire (ADR-013): the B1
   * response models it as `string | null`.
   */
  label: z.string().nullish(),
});
export type WorkspaceChangeLogEntry = z.infer<
  typeof WorkspaceChangeLogEntrySchema
>;

/** Reorder request body (PRD §6.1 WS-6). One version bump per reorder. */
export const WorkspaceReorderInputSchema = z.object({
  section: WorkspaceSectionSchema,
  /** Item ids in their new display order; must be the section's active items. */
  orderedIds: z.array(z.string()).min(1),
});
export type WorkspaceReorderInput = z.infer<typeof WorkspaceReorderInputSchema>;

/** Full URL-ish check used by the editor (http/https only). */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Month-precision date input (PRD §6.1 WS-3, ADR-017). The workspace wire format
 * is `YYYY-MM` only (the backend normalises to month precision), so the editor
 * rejects day precision, partial years and free text. An empty value means "not
 * set". Enforcing this also makes the start/end comparison below a correct
 * lexicographic test, which it would not be for day-precision strings.
 */
export const MonthValueSchema = z
  .string()
  .trim()
  .max(20)
  .refine((value) => value === "" || /^\d{4}-(0[1-9]|1[0-2])$/.test(value), {
    message: "Use month precision, e.g. 2024-06",
  });

/**
 * Editor-facing schema (React Hook Form + Zod, PRD §6.1 WS-3, §7.7).
 *
 * Stricter than the wire `WorkspaceItemSchema` so inline validation catches
 * problems before a request is made; the wire shape itself is unchanged.
 * Empty bullet/link rows are allowed here and stripped on submit, so a row
 * being typed into never trips validation mid-keystroke.
 */
export const WorkspaceItemFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required")
      .max(200, "Keep the title under 200 characters"),
    organization: z.string().trim().max(200, "Keep this under 200 characters"),
    startDate: MonthValueSchema,
    endDate: MonthValueSchema,
    location: z.string().trim().max(200, "Keep this under 200 characters"),
    bullets: z
      .array(z.string().trim().max(600, "Keep each bullet under 600 characters"))
      .max(30, "Up to 30 bullets per item"),
    tags: z
      .array(z.string().trim().max(40, "Tags are 40 characters max"))
      .max(30, "Up to 30 tags"),
    links: z
      .array(
        z
          .string()
          .trim()
          .max(500, "Keep links under 500 characters")
          .refine(
            (value) => value === "" || isHttpUrl(value),
            "Enter a full URL, e.g. https://example.com",
          ),
      )
      .max(20, "Up to 20 links"),
    attachments: z.array(AttachmentSchema).max(10, "Up to 10 attachments"),
    evidence: EvidenceStateSchema,
  })
  .superRefine((value, ctx) => {
    // "Verified" means a document or link is attached (PRD §4.2). Enforce it
    // here so the saved evidence state always matches its definition.
    const hasSupport =
      value.attachments.length > 0 ||
      value.links.some((link) => link.trim() !== "");
    if (value.evidence === "verified" && !hasSupport) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message:
          "Verified needs a supporting document or link. Attach one, or choose User-attested.",
      });
    }
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The end date can't be before the start date.",
      });
    }
  });
export type WorkspaceItemFormValues = z.infer<typeof WorkspaceItemFormSchema>;
