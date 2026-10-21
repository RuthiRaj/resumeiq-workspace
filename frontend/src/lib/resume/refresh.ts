import type {
  ResumeRefreshSkip,
  ResumeSection,
} from "@/lib/schemas";
import { TAILORED_SECTION_ORDER } from "./generate";

export interface MergeRefreshInput {
  existingSections: ResumeSection[];
  /** Freshly generated sections from the current workspace + latest report. */
  freshSections: ResumeSection[];
  /** Section keys the user has hand-edited. */
  editedSections: string[];
  /** Empty means every section. */
  requestedSections: string[];
  /** Explicit sections the user chose to overwrite despite hand edits. */
  overwriteEditedSections: string[];
}

export interface MergeRefreshResult {
  sections: ResumeSection[];
  refreshedSections: string[];
  skippedSections: ResumeRefreshSkip[];
  editedSections: string[];
}

/**
 * Merge a fresh deterministic generation into a stored resume (B5 §6.6).
 *
 * Edited sections are left exactly as they were unless the caller explicitly
 * names them in `overwriteEditedSections`. This is also why a removed source
 * item stays visible in a skipped section with `removed: true`: refresh must
 * never silently erase text the user wrote by hand.
 */
export function mergeRefresh(input: MergeRefreshInput): MergeRefreshResult {
  const existing = new Map(
    input.existingSections.map((section) => [section.key, section]),
  );
  const fresh = new Map(
    input.freshSections.map((section) => [section.key, section]),
  );
  const edited = new Set(input.editedSections);
  const remainingEdited = new Set(edited);
  const overwrite = new Set(input.overwriteEditedSections);
  const requested = [...new Set(input.requestedSections)];
  const requestedSet =
    requested.length > 0
      ? new Set(requested)
      : new Set([...existing.keys(), ...fresh.keys()]);

  const sections: ResumeSection[] = [];
  const refreshedSections: string[] = [];
  const skippedSections: ResumeRefreshSkip[] = [];

  // Known tailored sections keep their canonical order. Any extra key present
  // in either snapshot is preserved after them rather than being dropped by an
  // older client that does not know a new section yet.
  const orderedKeys = [
    ...new Set([
      ...TAILORED_SECTION_ORDER,
      ...[...existing.keys()].filter(
        (key) => !(TAILORED_SECTION_ORDER as readonly string[]).includes(key),
      ),
      ...[...fresh.keys()].filter(
        (key) =>
          !(TAILORED_SECTION_ORDER as readonly string[]).includes(key) &&
          !existing.has(key),
      ),
      ...input.editedSections,
    ]),
  ];

  for (const key of orderedKeys) {
    const current = existing.get(key);
    const generated = fresh.get(key);

    if (requestedSet.has(key) && edited.has(key) && !overwrite.has(key)) {
      skippedSections.push({ section: key, reason: "edited" });
      // Keep the hand-edited text, including any claim whose source is gone.
      if (current) sections.push(current);
      continue;
    }

    if (requestedSet.has(key)) {
      remainingEdited.delete(key);
      if (generated) {
        sections.push(generated);
        refreshedSections.push(key);
      } else if (current) {
        // Every source item for this section is gone; dropping it is the
        // refresh result, and the diff lists what disappeared.
        refreshedSections.push(key);
      }
      continue;
    }

    if (current) sections.push(current);
  }

  return {
    sections,
    refreshedSections,
    skippedSections,
    editedSections: orderedKeys.filter((key) => remainingEdited.has(key)),
  };
}
