import type {
  Resume,
  ResumeDiff,
  ResumeDiffEntry,
  ResumeEvidence,
  WorkspaceItem,
} from "@/lib/schemas";
import { evidenceFromItem } from "./evidence";
import { TAILORED_SECTION_ORDER } from "./generate";

const SECTION_RANK = new Map<string, number>(
  TAILORED_SECTION_ORDER.map((key, index) => [key, index]),
);

function bySectionThenTitle(a: ResumeDiffEntry, b: ResumeDiffEntry): number {
  return (
    (SECTION_RANK.get(a.section) ?? 99) -
      (SECTION_RANK.get(b.section) ?? 99) || a.title.localeCompare(b.title)
  );
}

/**
 * Compare a resume's evidence snapshot with the current workspace (B5 §6.6).
 *
 * - `added`   current active items the resume does not cite;
 * - `removed` cited items that are deleted/missing;
 * - `edited`  cited items whose content fingerprint changed.
 *
 * Position is excluded from the fingerprint, so moving an item is not an edit.
 */
export function buildResumeDiff(
  resume: Pick<
    Resume,
    "id" | "targetId" | "workspaceVersion" | "stale"
  >,
  evidence: ResumeEvidence[],
  items: WorkspaceItem[],
  currentWorkspaceVersion: number,
): ResumeDiff {
  const active = new Map(
    items
      .filter((item) => !item.deletedAt)
      .map((item) => [item.id, item]),
  );
  const snapshot = new Map(evidence.map((entry) => [entry.itemId, entry]));

  const added: ResumeDiffEntry[] = [];
  for (const [itemId, item] of active) {
    if (snapshot.has(itemId)) continue;
    added.push({ itemId, section: item.section, title: item.title });
  }

  const removed: ResumeDiffEntry[] = [];
  const edited: ResumeDiffEntry[] = [];
  for (const [itemId, entry] of snapshot) {
    const current = active.get(itemId);
    if (!current) {
      removed.push({
        itemId,
        section: entry.section,
        title: entry.title,
      });
      continue;
    }
    if (evidenceFromItem(current).fingerprint !== entry.fingerprint) {
      edited.push({
        itemId,
        section: current.section,
        title: current.title,
      });
    }
  }

  added.sort(bySectionThenTitle);
  removed.sort(bySectionThenTitle);
  edited.sort(bySectionThenTitle);

  const changedSections = [
    ...new Set([...added, ...removed, ...edited].map((entry) => entry.section)),
  ].sort(
    (a, b) => (SECTION_RANK.get(a) ?? 99) - (SECTION_RANK.get(b) ?? 99),
  );

  return {
    resumeId: resume.id,
    targetId: resume.targetId ?? null,
    workspaceVersion: resume.workspaceVersion,
    currentWorkspaceVersion,
    stale: resume.stale || resume.workspaceVersion !== currentWorkspaceVersion,
    added,
    removed,
    edited,
    changedSections,
    removedEvidenceIds: removed.map((entry) => entry.itemId),
  };
}
