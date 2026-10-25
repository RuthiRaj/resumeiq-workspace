import type {
  Resume,
  ResumeTemplate,
  TargetLength,
  WorkspaceSection,
} from "@/lib/schemas";
import { DEFAULT_DOCUMENT_ORDER } from "./resume-document-model";

/** Local presentation choices for the live standard-resume preview. */
export interface ResumePreferences {
  template: ResumeTemplate;
  length: TargetLength;
  /** Section keys in display order; unknown/new keys are merged on load. */
  order: string[];
  /** Section keys hidden from the preview and the print sheet. */
  hidden: string[];
}

export const RESUME_PREFERENCES_KEY = "riq.resume-preferences.v1";

export const DEFAULT_RESUME_PREFERENCES: ResumePreferences = {
  template: "precision",
  length: "one_page",
  order: [...DEFAULT_DOCUMENT_ORDER],
  hidden: [],
};

const TEMPLATES = new Set<ResumeTemplate>(["precision", "classic", "compact"]);
const LENGTHS = new Set<TargetLength>(["one_page", "two_page"]);

export function loadResumePreferences(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): ResumePreferences {
  try {
    const raw = storage.getItem(RESUME_PREFERENCES_KEY);
    if (!raw) return DEFAULT_RESUME_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<ResumePreferences>;
    return {
      template: TEMPLATES.has(parsed.template as ResumeTemplate)
        ? (parsed.template as ResumeTemplate)
        : DEFAULT_RESUME_PREFERENCES.template,
      length: LENGTHS.has(parsed.length as TargetLength)
        ? (parsed.length as TargetLength)
        : DEFAULT_RESUME_PREFERENCES.length,
      order: Array.isArray(parsed.order)
        ? parsed.order.filter((value): value is string => typeof value === "string")
        : [],
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((value): value is string => typeof value === "string")
        : [],
    };
  } catch {
    return DEFAULT_RESUME_PREFERENCES;
  }
}

export function saveResumePreferences(
  preferences: ResumePreferences,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  try {
    storage.setItem(RESUME_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // A full/blocked storage must never break the preview.
  }
}

/** Ordered section keys for a resume, merging unknown keys at the end. */
export function orderedSectionKeys(
  resume: Pick<Resume, "sections">,
  order: string[],
): string[] {
  const present = resume.sections.map((section) => section.key);
  const known = order.filter((key) => present.includes(key));
  const rest = present.filter((key) => !known.includes(key));
  return [...known, ...rest];
}

export function moveSectionKey(
  order: string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const index = order.indexOf(key);
  if (index === -1) return order;
  const target = index + direction;
  if (target < 0 || target >= order.length) return order;
  const next = [...order];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function sectionLabel(key: string): string {
  const labels: Record<WorkspaceSection, string> = {
    personal: "Personal details",
    education: "Education",
    experience: "Experience",
    internship: "Experience",
    project: "Projects",
    skill: "Skills",
    achievement: "Achievements and awards",
    extracurricular: "Achievements and awards",
    certificate: "Certifications",
    course: "Certifications",
    publication: "Publications",
    training: "Certifications",
  };
  return labels[key as WorkspaceSection] ?? key;
}
