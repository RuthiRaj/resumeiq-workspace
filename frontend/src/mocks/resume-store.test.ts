import { beforeEach, describe, expect, it } from "vitest";
import { jobDescriptionFixture } from "./analysis-fixtures";
import { ResumeStoreError, generateResume, getResume, listResumes, listVersions, editResumeSection, diffResume, refreshResume, restoreResumeVersion } from "./resume-store";
import { createTarget, startRun, advanceRun } from "./targets-store";
import {
  loadWorkspace,
  setPersona,
  softDeleteItem,
  updateItem,
} from "./workspace-store";
import type { KeyValueStorage } from "./workspace-store";
class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const USER = "user-f5";
const START = "2026-10-21T09:00:00.000Z";
const DONE = "2026-10-21T09:00:06.000Z";
const GENERATED = "2026-10-21T09:01:00.000Z";

function analyzedTarget(storage: MemoryStorage) {
  setPersona(storage, USER, "midlevel");
  const fixture = jobDescriptionFixture("strong");
  const target = createTarget(
    storage,
    USER,
    {
      role: fixture.role,
      company: fixture.company,
      jobDescription: fixture.jobDescription,
      requiredSkills: fixture.requiredSkills,
      template: fixture.template,
      length: fixture.length,
    },
    () => START,
  );
  startRun(storage, USER, target.id, () => START);
  const run = advanceRun(storage, USER, target.id, () => DONE);
  expect(run?.report).not.toBeNull();
  return target;
}

describe("mock tailored-resume store", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("generates a grounded snapshot with a version, ATS result and standard first", () => {
    const target = analyzedTarget(storage);
    const resume = generateResume(
      storage,
      USER,
      target.id,
      { rewordWithAi: false },
      () => GENERATED,
    );

    expect(resume.kind).toBe("tailored");
    expect(resume.workspaceVersion).toBe(loadWorkspace(storage, USER).version);
    expect(resume.sections.length).toBeGreaterThan(0);
    expect(resume.ats?.score).toBeGreaterThanOrEqual(0);
    expect(resume.sections.flatMap((section) => section.claims).every(
      (claim) => claim.evidenceIds.length > 0,
    )).toBe(true);

    expect(listResumes(storage, USER)[0]?.kind).toBe("standard");
    expect(listVersions(storage, USER, resume.id)).toHaveLength(1);
    expect(listVersions(storage, USER, resume.id)[0]?.reason).toBe("generated");
    expect(getResume(storage, USER, resume.id).id).toBe(resume.id);
  });

  it("rejects an invented fact on edit, then records a grounded edit", () => {
    const target = analyzedTarget(storage);
    const resume = generateResume(
      storage,
      USER,
      target.id,
      { rewordWithAi: false },
      () => GENERATED,
    );
    const experience = resume.sections.find((section) => section.key === "experience");
    expect(experience).toBeDefined();

    const ungrounded = {
      claims: experience!.claims.map((claim) => ({
        text: claim.text,
        evidenceIds: claim.evidenceIds,
      })),
    };
    ungrounded.claims[0] = {
      text: "Principal Architect at Google using AWS, 999% growth in 2026.",
      evidenceIds: experience!.claims[0]!.evidenceIds,
    };

    let error: unknown;
    try {
      editResumeSection(storage, USER, resume.id, "experience", ungrounded);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ResumeStoreError);
    expect((error as ResumeStoreError).code).toBe("resume_claim_ungrounded");

    const grounded = {
      claims: experience!.claims.map((claim) => ({
        text: `${claim.text} — verified`,
        evidenceIds: claim.evidenceIds,
      })),
    };
    const edited = editResumeSection(
      storage,
      USER,
      resume.id,
      "experience",
      grounded,
      () => "2026-10-21T09:02:00.000Z",
    );
    expect(edited.editedSections).toContain("experience");
    expect(listVersions(storage, USER, resume.id)).toHaveLength(2);
    expect(listVersions(storage, USER, resume.id)[0]?.reason).toBe("edited");
  });

  it("keeps removed claims visible when refresh skips an edited section", () => {
    const target = analyzedTarget(storage);
    const resume = generateResume(
      storage,
      USER,
      target.id,
      { rewordWithAi: false },
      () => GENERATED,
    );
    const experience = resume.sections.find((section) => section.key === "experience")!;
    const citedId = experience.claims[0]!.evidenceIds[0]!;

    editResumeSection(
      storage,
      USER,
      resume.id,
      "experience",
      {
        claims: experience.claims.map((claim) => ({
          text: `${claim.text} — verified`,
          evidenceIds: claim.evidenceIds,
        })),
      },
      () => "2026-10-21T09:02:00.000Z",
    );

    updateItem(
      storage,
      USER,
      citedId,
      { title: `${experience.claims[0]!.text.split(" · ")[0]} II` },
      () => "2026-10-21T09:03:00.000Z",
    );
    softDeleteItem(storage, USER, citedId, () => "2026-10-21T09:04:00.000Z");

    const diff = diffResume(storage, USER, resume.id);
    expect(diff.stale).toBe(true);
    expect(diff.removed.map((entry) => entry.itemId)).toContain(citedId);
    expect(diff.changedSections).toContain("experience");

    const refreshed = refreshResume(
      storage,
      USER,
      resume.id,
      { sections: [], overwriteEditedSections: [], rewordWithAi: false },
      () => "2026-10-21T09:05:00.000Z",
    );
    expect(refreshed.skippedSections).toEqual([
      { section: "experience", reason: "edited" },
    ]);
    const kept = refreshed.resume.sections.find(
      (section) => section.key === "experience",
    );
    expect(
      kept?.claims.some(
        (claim) => claim.evidenceIds.includes(citedId) && claim.removed,
      ),
    ).toBe(true);
    expect(refreshed.resume.removedEvidenceIds).toContain(citedId);

    const overwritten = refreshResume(
      storage,
      USER,
      resume.id,
      {
        sections: ["experience"],
        overwriteEditedSections: ["experience"],
        rewordWithAi: false,
      },
      () => "2026-10-21T09:06:00.000Z",
    );
    expect(overwritten.skippedSections).toEqual([]);
    expect(overwritten.refreshedSections).toContain("experience");
    expect(
      overwritten.resume.sections
        .find((section) => section.key === "experience")
        ?.claims.some((claim) => claim.evidenceIds.includes(citedId)),
    ).toBe(false);
  });

  it("restores an old version non-destructively", () => {
    const target = analyzedTarget(storage);
    const resume = generateResume(
      storage,
      USER,
      target.id,
      { rewordWithAi: false },
      () => GENERATED,
    );
    const experience = resume.sections.find((section) => section.key === "experience")!;
    editResumeSection(
      storage,
      USER,
      resume.id,
      "experience",
      {
        claims: experience.claims.map((claim) => ({
          text: `${claim.text} — verified`,
          evidenceIds: claim.evidenceIds,
        })),
      },
      () => "2026-10-21T09:02:00.000Z",
    );
    const generated = listVersions(storage, USER, resume.id).find(
      (version) => version.reason === "generated",
    )!;

    const restored = restoreResumeVersion(
      storage,
      USER,
      resume.id,
      generated.id,
      () => "2026-10-21T09:03:00.000Z",
    );

    expect(restored.sections[0]?.claims[0]?.text).toBe(
      resume.sections[0]?.claims[0]?.text,
    );
    expect(listVersions(storage, USER, resume.id)).toHaveLength(3);
    expect(listVersions(storage, USER, resume.id)[0]?.reason).toBe("restored");
  });
});
