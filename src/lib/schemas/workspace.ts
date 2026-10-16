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

export const AttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const WorkspaceItemSchema = z.object({
  id: z.string(),
  section: WorkspaceSectionSchema,
  title: z.string().min(1, "Title is required"),
  organization: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  evidence: EvidenceStateSchema,
  order: z.number(),
  deletedAt: z.string().optional(),
});
export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;

export const WorkspaceSchema = z.object({
  version: z.number().int().nonnegative(),
  items: z.array(WorkspaceItemSchema),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceChangeLogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  workspaceVersion: z.number().int().nonnegative(),
  itemId: z.string(),
  op: z.enum(["add", "edit", "delete", "reorder"]),
  at: z.string(),
});
export type WorkspaceChangeLogEntry = z.infer<
  typeof WorkspaceChangeLogEntrySchema
>;
