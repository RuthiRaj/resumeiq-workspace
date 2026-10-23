import type { ResumeEvidence, WorkspaceItem } from "@/lib/schemas";

/**
 * Source-evidence snapshots (B5). A tailored resume keeps the state of every
 * item it cited so diff/refresh can distinguish three cases:
 *  - unchanged: fingerprint matches;
 *  - edited: item still exists but its content changed;
 *  - removed: item was soft-deleted after the snapshot.
 * Workspace position is deliberately excluded from the fingerprint, so moving
 * an item in the workspace is not reported as a content edit.
 */

/** Stable FNV-1a hash; small, deterministic and available in every runtime. */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evidenceFingerprint(
  item: Pick<
    WorkspaceItem,
    | "section"
    | "title"
    | "organization"
    | "startDate"
    | "endDate"
    | "location"
    | "bullets"
    | "tags"
    | "evidence"
  >,
): string {
  return stableHash(
    JSON.stringify({
      section: item.section,
      title: item.title,
      organization: item.organization ?? null,
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      location: item.location ?? null,
      bullets: item.bullets,
      tags: item.tags,
      evidence: item.evidence,
    }),
  );
}

export function evidenceFromItem(item: WorkspaceItem): ResumeEvidence {
  return {
    itemId: item.id,
    section: item.section,
    title: item.title,
    organization: item.organization ?? null,
    startDate: item.startDate ?? null,
    endDate: item.endDate ?? null,
    location: item.location ?? null,
    bullets: [...item.bullets],
    tags: [...item.tags],
    evidence: item.evidence,
    order: item.order,
    fingerprint: evidenceFingerprint(item),
  };
}

/** Rebuild the workspace-item view used by ATS checks and claim validation. */
export function itemFromEvidence(evidence: ResumeEvidence): WorkspaceItem {
  return {
    id: evidence.itemId,
    section: evidence.section,
    title: evidence.title,
    organization: evidence.organization ?? null,
    startDate: evidence.startDate ?? null,
    endDate: evidence.endDate ?? null,
    location: evidence.location ?? null,
    bullets: [...evidence.bullets],
    tags: [...evidence.tags],
    links: [],
    attachments: [],
    evidence: evidence.evidence,
    order: evidence.order,
    deletedAt: null,
  };
}
