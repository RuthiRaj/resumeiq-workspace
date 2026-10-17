import {
  WORKSPACE_SECTION_ORDER,
  type EvidenceState,
  type WorkspaceItem,
  type WorkspaceItemFormValues,
  type WorkspaceSection,
} from "@/lib/schemas";
import { EVIDENCE_META, EVIDENCE_ORDER } from "./evidence";

/** Pure helpers for the workspace UI — all unit-tested in `workspace-utils.test.ts`. */

export function sortByOrder(items: WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function activeBySection(
  items: WorkspaceItem[],
  section: WorkspaceItem["section"],
): WorkspaceItem[] {
  return sortByOrder(items.filter((item) => !item.deletedAt && item.section === section));
}

export function countBySection(items: WorkspaceItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.deletedAt) continue;
    counts[item.section] = (counts[item.section] ?? 0) + 1;
  }
  return counts;
}

export function evidenceCounts(
  items: WorkspaceItem[],
): Record<EvidenceState, number> {
  const counts: Record<EvidenceState, number> = {
    verified: 0,
    attested: 0,
    related: 0,
    missing: 0,
  };
  for (const item of items) {
    if (item.deletedAt) continue;
    counts[item.evidence] += 1;
  }
  return counts;
}

/**
 * The weakest evidence state present in a set — what a section card should
 * glow with, so gaps are visible at a glance rather than hidden behind a
 * healthy-looking majority.
 */
export function weakestEvidence(items: WorkspaceItem[]): EvidenceState | null {
  const counts = evidenceCounts(items);
  // Walk from weakest (missing) to strongest (verified) so the first state
  // found is the weakest present — a section with any gap glows with that gap.
  for (const state of [...EVIDENCE_ORDER].reverse()) {
    if (counts[state] > 0) return state;
  }
  return null;
}

export interface CompletenessBreakdown {
  score: number;
  coveredSections: number;
  totalSections: number;
  sectionCoverage: number;
  evidenceScore: number;
}

/**
 * Explainable completeness (PRD §7.7: scores are never a black box).
 * 60% = how many of the 12 sections have at least one active item,
 * 40% = average evidence quality across active items.
 */
export function computeCompleteness(items: WorkspaceItem[]): CompletenessBreakdown {
  const active = items.filter((item) => !item.deletedAt);
  const covered = WORKSPACE_SECTION_ORDER.filter((section) =>
    active.some((item) => item.section === section),
  ).length;
  const totalSections = WORKSPACE_SECTION_ORDER.length;
  const sectionCoverage = covered / totalSections;
  const evidenceScore =
    active.length === 0
      ? 0
      : active.reduce((sum, item) => sum + EVIDENCE_META[item.evidence].weight, 0) /
        active.length;
  const score = Math.round(100 * (0.6 * sectionCoverage + 0.4 * evidenceScore));
  return {
    score,
    coveredSections: covered,
    totalSections,
    sectionCoverage,
    evidenceScore,
  };
}

export function moveWithin<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return [...list];
  if (from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const clampedTo = Math.max(0, Math.min(list.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/** New id order after dragging `activeId` onto `overId` (dnd-kit onDragEnd). */
export function reorderIds(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1) return [...ids];
  return moveWithin(ids, from, to);
}

/** Human summary of a change-log entry (label is captured at write time). */
export function describeChange(entry: {
  op: "add" | "edit" | "delete" | "reorder";
  label?: string;
}): string {
  const target = entry.label ? `“${entry.label}”` : "an item";
  switch (entry.op) {
    case "add":
      return `Added ${target}`;
    case "edit":
      return `Updated ${target}`;
    case "delete":
      return `Deleted ${target}`;
    case "reorder":
      return `Reordered ${target}`;
  }
}

/** Trim and drop blank rows before sending an item to the API. */
export function normalizeFormValues(
  values: WorkspaceItemFormValues,
): WorkspaceItemFormValues {
  return {
    ...values,
    title: values.title.trim(),
    organization: values.organization.trim(),
    location: values.location.trim(),
    startDate: values.startDate.trim(),
    endDate: values.endDate.trim(),
    bullets: values.bullets.map((bullet) => bullet.trim()).filter(Boolean),
    tags: values.tags.map((tag) => tag.trim()).filter(Boolean),
    links: values.links.map((link) => link.trim()).filter(Boolean),
  };
}

/** Editor values -> create body (the server assigns id and order). */
export function toCreatePayload(
  section: WorkspaceSection,
  values: WorkspaceItemFormValues,
): Omit<WorkspaceItem, "id"> {
  const v = normalizeFormValues(values);
  return {
    section,
    title: v.title,
    organization: v.organization || undefined,
    startDate: v.startDate || undefined,
    endDate: v.endDate || undefined,
    location: v.location || undefined,
    bullets: v.bullets,
    tags: v.tags,
    links: v.links,
    attachments: v.attachments,
    evidence: v.evidence,
    order: 0,
  };
}

/** Editor values -> update patch (section never changes here; order is server-owned). */
export function toItemPatch(values: WorkspaceItemFormValues): Partial<WorkspaceItem> {
  const v = normalizeFormValues(values);
  return {
    title: v.title,
    organization: v.organization || undefined,
    startDate: v.startDate || undefined,
    endDate: v.endDate || undefined,
    location: v.location || undefined,
    bullets: v.bullets,
    tags: v.tags,
    links: v.links,
    attachments: v.attachments,
    evidence: v.evidence,
  };
}

/** Dependency-free relative time so lists read naturally ("4m ago"). */
export function formatRelativeTime(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
