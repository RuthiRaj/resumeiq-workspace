import { z } from "zod";

export const ClaimSchema = z.object({
  text: z.string(),
  /** Workspace item IDs backing this claim. Empty = needs confirmation. */
  evidenceIds: z.array(z.string()).default([]),
  /** True once a human confirmed an unsupported statement. */
  confirmed: z.boolean().default(false),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ResumeSectionSchema = z.object({
  key: z.string(),
  claims: z.array(ClaimSchema).default([]),
});
export type ResumeSection = z.infer<typeof ResumeSectionSchema>;

export const ResumeSchema = z.object({
  id: z.string(),
  kind: z.enum(["standard", "tailored"]),
  targetId: z.string().optional(),
  /** Workspace version this resume was generated from (staleness, PRD §6.8). */
  workspaceVersion: z.number().int().nonnegative(),
  stale: z.boolean().default(false),
  sections: z.array(ResumeSectionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Resume = z.infer<typeof ResumeSchema>;
