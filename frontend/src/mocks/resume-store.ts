import {
  type AnalysisReport,
  type Claim,
  type Resume,
  type ResumeDiff,
  type ResumeEvidence,
  type ResumeGenerateRequest,
  type ResumePurgeResult,
  type ResumeRefreshRequest,
  type ResumeRefreshResult,
  type ResumeSection,
  type ResumeSectionEdit,
  type ResumeSummary,
  type ResumeVersion,
  type ResumeVersionPurgeResult,
  type TargetLength,
} from "@/lib/schemas";
import { computeAtsReport } from "@/lib/analysis/ats";
import {
  buildResumeDiff,
  collectEvidence,
  generateTailoredResume,
  itemFromEvidence,
  mergeRefresh,
  simulateMockReword,
  validateClaimGrounding,
} from "@/lib/resume";
import { standardResumeId } from "@/lib/resume/ids";
import { deriveStandardResume, loadWorkspace } from "./workspace-store";
import { getReport, getTarget } from "./targets-store";
import type { KeyValueStorage } from "./workspace-store";

/**
 * Persistent tailored-resume store for the mock API (B5 contract, Â§6).
 *
 * The wire shapes and rules match `docs/api/contract-proposals.md` Â§6 and the
 * merged B5 OpenAPI export: deterministic generation, evidence
 * snapshots, insert-only versions, grounding-checked edits, computed staleness,
 * and selective refresh that never overwrites hand-edited sections unless
 * explicitly asked.
 */

export const RESUMES_KEY_PREFIX = "riq.resumes.";
const STANDARD_RESUME_ID = "resume-standard";

export class ResumeStoreError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResumeStoreError";
  }
}

export type Clock = () => string;
const isoClock: Clock = () => new Date().toISOString();

interface StoredVersion {
  version: ResumeVersion;
  evidence: ResumeEvidence[];
}

interface StoredResume {
  resume: Resume;
  evidence: ResumeEvidence[];
}

interface StoredResumes {
  resumes: StoredResume[];
  versions: Record<string, StoredVersion[]>;
}

function resumesKey(userId: string): string {
  return `${RESUMES_KEY_PREFIX}${userId}`;
}

function emptyState(): StoredResumes {
  return { resumes: [], versions: {} };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadResumes(storage: KeyValueStorage, userId: string): StoredResumes {
  try {
    const raw = storage.getItem(resumesKey(userId));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as StoredResumes;
    if (!parsed || !Array.isArray(parsed.resumes)) return emptyState();
    return { resumes: parsed.resumes, versions: parsed.versions ?? {} };
  } catch {
    return emptyState();
  }
}

function saveResumes(
  storage: KeyValueStorage,
  userId: string,
  state: StoredResumes,
): void {
  storage.setItem(resumesKey(userId), JSON.stringify(state));
}

function findStored(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): StoredResume | null {
  return (
    loadResumes(storage, userId).resumes.find(
      (entry) => entry.resume.id === resumeId,
    ) ?? null
  );
}

function requireStored(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): StoredResume {
  const found = findStored(storage, userId, resumeId);
  if (!found) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  return found;
}

function requireTailored(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): StoredResume {
  if (resumeId === STANDARD_RESUME_ID || resumeId === standardResumeId()) {
    throw new ResumeStoreError(
      409,
      "resume_not_tailored",
      "The standard resume is derived from your workspace and cannot be edited.",
    );
  }
  return requireStored(storage, userId, resumeId);
}

function standardResume(
  storage: KeyValueStorage,
  userId: string,
): Resume {
  return deriveStandardResume(loadWorkspace(storage, userId));
}

function removedItemIds(
  evidence: ResumeEvidence[],
  items: Resume["sections"] extends never ? never : ReturnType<typeof loadWorkspace>["items"],
): string[] {
  const active = new Set(
    items.filter((item) => !item.deletedAt).map((item) => item.id),
  );
  return evidence
    .map((entry) => entry.itemId)
    .filter((itemId) => !active.has(itemId));
}

function decorate(stored: StoredResume, workspaceVersion: number, items: ReturnType<typeof loadWorkspace>["items"]): Resume {
  const removed = new Set(removedItemIds(stored.evidence, items));
  return {
    ...stored.resume,
    stale:
      stored.resume.stale ||
      stored.resume.workspaceVersion !== workspaceVersion,
    sections: stored.resume.sections.map((section) => ({
      ...section,
      claims: section.claims.map((claim) => ({
        ...claim,
        removed: claim.evidenceIds.some((id) => removed.has(id)),
      })),
    })),
    removedEvidenceIds: [...removed],
  };
}

function decorateVersion(
  stored: StoredVersion,
  workspaceVersion: number,
  items: ReturnType<typeof loadWorkspace>["items"],
): ResumeVersion {
  const removed = new Set(removedItemIds(stored.evidence, items));
  return {
    ...stored.version,
    stale:
      stored.version.stale ||
      stored.version.workspaceVersion !== workspaceVersion,
    sections: stored.version.sections.map((section) => ({
      ...section,
      claims: section.claims.map((claim) => ({
        ...claim,
        removed: claim.evidenceIds.some((id) => removed.has(id)),
      })),
    })),
    removedEvidenceIds: [...removed],
  };
}

function summaryOf(resume: Resume): ResumeSummary {
  return {
    id: resume.id,
    kind: resume.kind,
    targetId: resume.targetId ?? null,
    title: resume.title ?? null,
    workspaceVersion: resume.workspaceVersion,
    stale: resume.stale,
    aiUsed: resume.aiUsed,
    editedSections: [...resume.editedSections],
    removedEvidenceIds: [...resume.removedEvidenceIds],
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
}

function atsFor(
  evidence: ResumeEvidence[],
  report: AnalysisReport | null,
): Resume["ats"] {
  if (!report) return null;
  return computeAtsReport({
    items: evidence.map(itemFromEvidence),
    requirements: report.requirements,
  });
}

function applyMockAi(
  sections: ResumeSection[],
  evidence: ResumeEvidence[],
): { sections: ResumeSection[]; aiUsed: boolean } {
  const byId = new Map(evidence.map((entry) => [entry.itemId, entry]));
  let aiUsed = false;
  const next = sections.map((section) => ({
    ...section,
    claims: section.claims.map((claim) => {
      if (claim.evidenceIds.length !== 1) return claim;
      const source = byId.get(claim.evidenceIds[0]);
      if (!source || !source.bullets.includes(claim.text)) return claim;
      const candidate = simulateMockReword(claim.text);
      if (!candidate) return claim;
      const grounded = validateClaimGrounding(candidate, [
        itemFromEvidence(source),
      ]);
      if (!grounded.ok) return claim;
      aiUsed = true;
      return { ...claim, text: candidate, aiRewritten: true };
    }),
  }));
  return { sections: next, aiUsed };
}

function defaultTitle(role: string, company: string | null | undefined): string {
  return company ? `${role} at ${company}` : role;
}

function appendVersion(
  state: StoredResumes,
  resume: Resume,
  evidence: ResumeEvidence[],
  reason: ResumeVersion["reason"],
  at: string,
): void {
  const existing = state.versions[resume.id] ?? [];
  const nextNumber =
    Math.max(
      0,
      ...existing.map((entry) => {
        const match = /-v(\d+)$/.exec(entry.version.id);
        return match ? Number.parseInt(match[1], 10) : 0;
      }),
    ) + 1;
  const version: ResumeVersion = {
    id: `${resume.id}-v${nextNumber}`,
    resumeId: resume.id,
    workspaceVersion: resume.workspaceVersion,
    createdAt: at,
    reason,
    title: resume.title ?? null,
    aiUsed: resume.aiUsed,
    sections: deepClone(resume.sections),
    ats: resume.ats ? deepClone(resume.ats) : null,
    editedSections: [...resume.editedSections],
    stale: false,
    removedEvidenceIds: [],
  };
  state.versions[resume.id] = [
    ...existing,
    { version, evidence: deepClone(evidence) },
  ];
}

/* ------------------------------------------------------------------- reads */

export function listResumes(
  storage: KeyValueStorage,
  userId: string,
): ResumeSummary[] {
  const ws = loadWorkspace(storage, userId);
  const state = loadResumes(storage, userId);
  const standard = summaryOf(standardResume(storage, userId));
  const tailored = state.resumes
    .map((entry) => decorate(entry, ws.version, ws.items))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summaryOf);
  return [standard, ...tailored];
}

export function getResume(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): Resume {
  if (resumeId === STANDARD_RESUME_ID || resumeId === standardResumeId()) {
    return standardResume(storage, userId);
  }
  const ws = loadWorkspace(storage, userId);
  return decorate(requireStored(storage, userId, resumeId), ws.version, ws.items);
}

export function listVersions(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): ResumeVersion[] {
  if (resumeId === STANDARD_RESUME_ID || resumeId === standardResumeId()) return [];
  requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  return [...(loadResumes(storage, userId).versions[resumeId] ?? [])]
    .map((entry) => decorateVersion(entry, ws.version, ws.items))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function diffResume(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): ResumeDiff {
  const ws = loadWorkspace(storage, userId);
  if (resumeId === STANDARD_RESUME_ID || resumeId === standardResumeId()) {
    return {
      resumeId: STANDARD_RESUME_ID,
      targetId: null,
      workspaceVersion: ws.version,
      currentWorkspaceVersion: ws.version,
      stale: false,
      added: [],
      removed: [],
      edited: [],
      changedSections: [],
      removedEvidenceIds: [],
    };
  }
  const stored = requireStored(storage, userId, resumeId);
  const decorated = decorate(stored, ws.version, ws.items);
  return buildResumeDiff(
    decorated,
    stored.evidence,
    ws.items,
    ws.version,
  );
}

/* -------------------------------------------------------------- generation */

export function generateResume(
  storage: KeyValueStorage,
  userId: string,
  targetId: string,
  input: ResumeGenerateRequest,
  now: Clock = isoClock,
): Resume {
  const ws = loadWorkspace(storage, userId);
  const target = getTarget(storage, userId, targetId);
  if (!target) {
    throw new ResumeStoreError(
      404,
      "target_not_found",
      "That job target no longer exists.",
    );
  }
  const report = getReport(storage, userId, targetId);
  if (!report) {
    throw new ResumeStoreError(
      409,
      "analysis_required",
      "Run the analysis for this target before generating a resume.",
    );
  }
  if (report.workspaceVersion !== ws.version) {
    throw new ResumeStoreError(
      409,
      "analysis_stale",
      "Your workspace changed after this analysis. Re-run it, then generate the resume.",
    );
  }

  const generated = generateTailoredResume(
    ws.items,
    report.requirements,
    (target.length ?? "one_page") as TargetLength,
  );
  const ai = input.rewordWithAi
    ? applyMockAi(generated.sections, generated.evidence)
    : { sections: generated.sections, aiUsed: false };
  const at = now();
  const title =
    input.title?.trim() || defaultTitle(target.role, target.company);
  const resume: Resume = {
    id: `resume-${Date.parse(at)}-${loadResumes(storage, userId).resumes.length + 1}`,
    kind: "tailored",
    targetId: target.id,
    title,
    workspaceVersion: ws.version,
    stale: false,
    sections: ai.sections,
    createdAt: at,
    updatedAt: at,
    aiUsed: ai.aiUsed,
    ats: atsFor(generated.evidence, report),
    editedSections: [],
    removedEvidenceIds: [],
  };

  const state = loadResumes(storage, userId);
  state.resumes.push({
    resume: deepClone(resume),
    evidence: deepClone(generated.evidence),
  });
  appendVersion(state, resume, generated.evidence, "generated", at);
  saveResumes(storage, userId, state);
  return decorate(
    { resume, evidence: generated.evidence },
    ws.version,
    ws.items,
  );
}

/* ------------------------------------------------------------------ edits */

export function editResumeSection(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  sectionKey: string,
  edit: ResumeSectionEdit,
  now: Clock = isoClock,
): Resume {
  const stored = requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const sectionIndex = stored.resume.sections.findIndex(
    (section) => section.key === sectionKey,
  );
  if (sectionIndex === -1) {
    throw new ResumeStoreError(
      404,
      "resume_section_not_found",
      "That section isn't part of this resume.",
    );
  }

  const active = new Map(
    ws.items
      .filter((item) => !item.deletedAt)
      .map((item) => [item.id, item]),
  );
  const claims: Claim[] = edit.claims.map((candidate) => {
    const cited = candidate.evidenceIds.map((itemId) => active.get(itemId));
    if (cited.some((item) => !item)) {
      throw new ResumeStoreError(
        422,
        "resume_evidence_not_found",
        "One of the cited workspace items no longer exists. Remove it and cite an item that is still in your workspace.",
      );
    }
    const evidence = cited.filter(
      (item): item is NonNullable<typeof item> => Boolean(item),
    );
    const grounding = validateClaimGrounding(candidate.text, evidence);
    if (!grounding.ok) {
      throw new ResumeStoreError(
        422,
        "resume_claim_ungrounded",
        "This line adds facts that aren't in the cited evidence. Remove or correct the invented detail, or cite stronger evidence.",
      );
    }
    return {
      text: candidate.text,
      evidenceIds: [...candidate.evidenceIds],
      confirmed: true,
      aiRewritten: false,
      removed: false,
    };
  });

  const sections = stored.resume.sections.map((section, index) =>
    index === sectionIndex
      ? { key: sectionKey, claims }
      : section,
  );
  const editedSections = stored.resume.editedSections.includes(sectionKey)
    ? stored.resume.editedSections
    : [...stored.resume.editedSections, sectionKey];
  const evidence = collectEvidence(sections, ws.items, stored.evidence);
  const report = stored.resume.targetId
    ? getReport(storage, userId, stored.resume.targetId)
    : null;
  const resume: Resume = {
    ...stored.resume,
    sections,
    editedSections,
    aiUsed: sections.some((section) =>
      section.claims.some((claim) => claim.aiRewritten),
    ),
    ats: report ? atsFor(evidence, report) : stored.resume.ats ?? null,
    updatedAt: now(),
  };

  const state = loadResumes(storage, userId);
  const index = state.resumes.findIndex(
    (entry) => entry.resume.id === resumeId,
  );
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  state.resumes[index] = {
    resume: deepClone(resume),
    evidence: deepClone(evidence),
  };
  appendVersion(state, resume, evidence, "edited", resume.updatedAt);
  saveResumes(storage, userId, state);
  return decorate({ resume, evidence }, ws.version, ws.items);
}

/* --------------------------------------------------------- stale/restore */

export function markResumeStale(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  now: Clock = isoClock,
): Resume {
  requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const state = loadResumes(storage, userId);
  const index = state.resumes.findIndex(
    (entry) => entry.resume.id === resumeId,
  );
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  state.resumes[index].resume = {
    ...state.resumes[index].resume,
    stale: true,
    updatedAt: now(),
  };
  saveResumes(storage, userId, state);
  return decorate(state.resumes[index], ws.version, ws.items);
}

export function restoreResumeVersion(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  versionId: string,
  now: Clock = isoClock,
): Resume {
  const stored = requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const state = loadResumes(storage, userId);
  const snapshot = (state.versions[resumeId] ?? []).find(
    (entry) => entry.version.id === versionId,
  );
  if (!snapshot) {
    throw new ResumeStoreError(
      404,
      "resume_version_not_found",
      "That resume version no longer exists.",
    );
  }

  const at = now();
  const resume: Resume = {
    ...stored.resume,
    title: snapshot.version.title ?? null,
    workspaceVersion: snapshot.version.workspaceVersion,
    stale: snapshot.version.workspaceVersion !== ws.version,
    sections: deepClone(snapshot.version.sections),
    aiUsed: snapshot.version.aiUsed,
    ats: snapshot.version.ats ? deepClone(snapshot.version.ats) : null,
    editedSections: [...snapshot.version.editedSections],
    updatedAt: at,
  };
  const index = state.resumes.findIndex(
    (entry) => entry.resume.id === resumeId,
  );
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  state.resumes[index] = {
    resume: deepClone(resume),
    evidence: deepClone(snapshot.evidence),
  };
  appendVersion(state, resume, snapshot.evidence, "restored", at);
  saveResumes(storage, userId, state);
  return decorate(
    { resume, evidence: snapshot.evidence },
    ws.version,
    ws.items,
  );
}

/* ---------------------------------------------------------------- refresh */

export function refreshResume(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  request: ResumeRefreshRequest,
  now: Clock = isoClock,
): ResumeRefreshResult {
  const stored = requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const targetId = stored.resume.targetId;
  if (!targetId) {
    throw new ResumeStoreError(
      409,
      "analysis_required",
      "This resume has no job target, so it cannot be refreshed.",
    );
  }
  const target = getTarget(storage, userId, targetId);
  if (!target) {
    throw new ResumeStoreError(
      404,
      "target_not_found",
      "The job target for this resume no longer exists.",
    );
  }
  const report = getReport(storage, userId, targetId);
  if (!report) {
    throw new ResumeStoreError(
      409,
      "analysis_required",
      "Run the analysis for this target before refreshing the resume.",
    );
  }

  const generated = generateTailoredResume(
    ws.items,
    report.requirements,
    (target.length ?? "one_page") as TargetLength,
  );
  const ai = request.rewordWithAi
    ? applyMockAi(generated.sections, generated.evidence)
    : { sections: generated.sections, aiUsed: false };

  const merged = mergeRefresh({
    existingSections: stored.resume.sections,
    freshSections: ai.sections,
    editedSections: stored.resume.editedSections,
    requestedSections: request.sections,
    overwriteEditedSections: request.overwriteEditedSections,
  });
  const evidence = collectEvidence(merged.sections, ws.items, stored.evidence);
  const at = now();
  const resume: Resume = {
    ...stored.resume,
    sections: merged.sections,
    editedSections: merged.editedSections,
    workspaceVersion: ws.version,
    stale: false,
    aiUsed: merged.sections.some((section) =>
      section.claims.some((claim) => claim.aiRewritten),
    ) || ai.aiUsed,
    ats: atsFor(evidence, report),
    updatedAt: at,
  };

  const state = loadResumes(storage, userId);
  const index = state.resumes.findIndex(
    (entry) => entry.resume.id === resumeId,
  );
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  state.resumes[index] = {
    resume: deepClone(resume),
    evidence: deepClone(evidence),
  };
  appendVersion(state, resume, evidence, "refreshed", at);
  saveResumes(storage, userId, state);

  return {
    resume: decorate({ resume, evidence }, ws.version, ws.items),
    refreshedSections: merged.refreshedSections,
    skippedSections: merged.skippedSections,
  };
}

/** Keep an unused import out of the production graph while documenting the key. */
export const RESUME_STANDARD_ID = standardResumeId();

/* ------------------------------------------------- deletion / purge (B6) */

function purgeSections(
  sections: ResumeSection[],
  removed: Set<string>,
): { sections: ResumeSection[]; removedClaims: number } {
  let removedClaims = 0;
  const next = sections.map((section) => ({
    ...section,
    claims: section.claims.filter((claim) => {
      const drop = claim.evidenceIds.some((id) => removed.has(id));
      if (drop) removedClaims += 1;
      return !drop;
    }),
  }));
  return { sections: next, removedClaims };
}

/** Permanently delete a tailored resume and all of its versions. */
export function deleteResume(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
): void {
  requireTailored(storage, userId, resumeId);
  const state = loadResumes(storage, userId);
  state.resumes = state.resumes.filter((entry) => entry.resume.id !== resumeId);
  delete state.versions[resumeId];
  saveResumes(storage, userId, state);
}

/** Permanently delete one saved version (the current resume is untouched). */
export function deleteResumeVersion(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  versionId: string,
): void {
  requireTailored(storage, userId, resumeId);
  const state = loadResumes(storage, userId);
  const existing = state.versions[resumeId] ?? [];
  if (!existing.some((entry) => entry.version.id === versionId)) {
    throw new ResumeStoreError(
      404,
      "resume_version_not_found",
      "That resume version no longer exists.",
    );
  }
  state.versions[resumeId] = existing.filter(
    (entry) => entry.version.id !== versionId,
  );
  saveResumes(storage, userId, state);
}

/**
 * Rewrite removed-item claims out of the current resume and every saved
 * version. Appends one `purged` version only when the current resume changed,
 * mirroring the B6 route.
 */
export function purgeResume(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  now: Clock = isoClock,
): ResumePurgeResult {
  requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const state = loadResumes(storage, userId);
  const index = state.resumes.findIndex((entry) => entry.resume.id === resumeId);
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_not_found",
      "That resume no longer exists.",
    );
  }
  const stored = state.resumes[index];
  const removed = new Set(removedItemIds(stored.evidence, ws.items));
  if (removed.size === 0) {
    return {
      resume: decorate(stored, ws.version, ws.items),
      purgedVersions: 0,
      removedClaims: 0,
      removedEvidenceIds: [],
    };
  }

  const at = now();
  const purged = purgeSections(stored.resume.sections, removed);
  const evidence = stored.evidence.filter((entry) => !removed.has(entry.itemId));
  const resume: Resume = {
    ...stored.resume,
    sections: purged.sections,
    updatedAt: at,
    removedEvidenceIds: [],
  };
  state.resumes[index] = { resume: deepClone(resume), evidence: deepClone(evidence) };

  let purgedVersions = 0;
  state.versions[resumeId] = (state.versions[resumeId] ?? []).map((entry) => {
    const rewritten = purgeSections(entry.version.sections, removed);
    if (rewritten.removedClaims > 0) purgedVersions += 1;
    return {
      version: {
        ...entry.version,
        sections: rewritten.sections,
        removedEvidenceIds: [],
      },
      evidence: entry.evidence.filter((item) => !removed.has(item.itemId)),
    };
  });

  // A rewrite is a real content change, so it becomes part of the history.
  if (purged.removedClaims > 0) {
    appendVersion(state, resume, evidence, "purged", at);
  }
  saveResumes(storage, userId, state);

  return {
    resume: decorate(
      state.resumes[index] ?? { resume, evidence },
      ws.version,
      ws.items,
    ),
    purgedVersions,
    removedClaims: purged.removedClaims,
    removedEvidenceIds: [...removed],
  };
}

/** Rewrite removed-item claims out of a single saved version. */
export function purgeResumeVersion(
  storage: KeyValueStorage,
  userId: string,
  resumeId: string,
  versionId: string,
): ResumeVersionPurgeResult {
  requireTailored(storage, userId, resumeId);
  const ws = loadWorkspace(storage, userId);
  const state = loadResumes(storage, userId);
  const versions = state.versions[resumeId] ?? [];
  const index = versions.findIndex((entry) => entry.version.id === versionId);
  if (index === -1) {
    throw new ResumeStoreError(
      404,
      "resume_version_not_found",
      "That resume version no longer exists.",
    );
  }
  const stored = versions[index];
  const removed = new Set(removedItemIds(stored.evidence, ws.items));
  if (removed.size === 0) {
    return {
      version: decorateVersion(stored, ws.version, ws.items),
      removedClaims: 0,
      removedEvidenceIds: [],
    };
  }
  const purged = purgeSections(stored.version.sections, removed);
  const next: StoredVersion = {
    version: {
      ...stored.version,
      sections: purged.sections,
      removedEvidenceIds: [],
    },
    evidence: stored.evidence.filter((entry) => !removed.has(entry.itemId)),
  };
  state.versions[resumeId] = versions.map((entry, position) =>
    position === index ? next : entry,
  );
  saveResumes(storage, userId, state);
  return {
    version: decorateVersion(next, ws.version, ws.items),
    removedClaims: purged.removedClaims,
    removedEvidenceIds: [...removed],
  };
}

/** Account deletion: remove every tailored resume and saved version. */
export function clearResumes(storage: KeyValueStorage, userId: string): void {
  saveResumes(storage, userId, emptyState());
}

/** Rows for `GET /export`; the wire export exposes stored rows, not summaries. */
export function exportResumeData(storage: KeyValueStorage, userId: string) {
  const state = loadResumes(storage, userId);
  return {
    resumes: state.resumes.map((entry) => entry.resume),
    versions: Object.values(state.versions)
      .flat()
      .map((entry) => entry.version),
    claims: state.resumes.flatMap((entry) =>
      entry.resume.sections.flatMap((section) =>
        section.claims.map((claim) => ({
          resumeId: entry.resume.id,
          section: section.key,
          ...claim,
        })),
      ),
    ),
  };
}
