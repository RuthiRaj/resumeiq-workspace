import { loadSession } from "@/lib/auth/store";
import type { UserDataExport } from "@/lib/schemas";
import { clearConsent, loadConsent } from "@/lib/privacy/consent";
import type { KeyValueStorage } from "./workspace-store";
import { loadWorkspace, workspaceKey } from "./workspace-store";
import { loadTargets, targetsKey } from "./targets-store";
import { clearResumes, exportResumeData } from "./resume-store";
import { importsKey, loadImports } from "./imports-store";

/**
 * Mock parity for the B6 privacy routes (`GET /export`, `DELETE /account`).
 *
 * Deletion removes the same categories the backend's `SECURITY DEFINER`
 * function removes (every public row), then writes empty stores so a reload
 * cannot reseed fixtures behind the user's back. The mock auth identity is kept
 * on purpose: that matches `authUserDeleted: false` and lets the UI show the
 * honest "operator must remove the sign-in email" state.
 */

function rows<T>(values: T[]): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(values)) as Record<string, unknown>[];
}

export function buildMockDataExport(
  storage: KeyValueStorage,
  userId: string,
  exportedAt = new Date().toISOString(),
): UserDataExport {
  const session = loadSession(storage);
  const ws = loadWorkspace(storage, userId);
  const targets = loadTargets(storage, userId);
  const resumes = exportResumeData(storage, userId);
  const imports = loadImports(storage, userId);
  const consent = loadConsent(storage);
  const reports = Object.values(targets.reports);

  return {
    format: "resumeiq.data-export.v1",
    exportedAt,
    userId,
    email: session?.user.email ?? null,
    workspace: rows(ws.items),
    workspaceVersions: [],
    evidenceLinks: [],
    changeLog: rows(ws.changelog),
    targets: rows(targets.targets),
    jdRequirements: rows(
      reports.flatMap((report) =>
        report.requirements.map((requirement) => ({
          targetId: report.targetId,
          ...requirement,
        })),
      ),
    ),
    reports: rows(reports),
    analysisRuns: rows(Object.values(targets.runs)),
    resumes: rows(resumes.resumes),
    resumeVersions: rows(resumes.versions),
    resumeClaims: rows(resumes.claims),
    consentRecords: rows(consent ? [consent] : []),
    imports: rows(imports.sessions),
    importReviewItems: rows(imports.sessions.flatMap((item) => item.items)),
    profile: null,
    skills: [],
    skillRelations: [],
    auditEvents: [],
  };
}

export interface MockDeletionResult {
  dataDeleted: boolean;
  authUserDeleted: false;
  remainingStep: "auth_user";
  deletedAt: string;
  deletedCounts: Record<string, number>;
  message: string;
}

export function deleteMockUserData(
  storage: KeyValueStorage,
  userId: string,
): MockDeletionResult {
  const ws = loadWorkspace(storage, userId);
  const targets = loadTargets(storage, userId);
  const resumes = exportResumeData(storage, userId);
  const imports = loadImports(storage, userId);
  const consent = loadConsent(storage);
  const at = new Date().toISOString();

  const deletedCounts = {
    workspace_items: ws.items.length,
    targets: targets.targets.length,
    reports: Object.keys(targets.reports).length,
    resumes: resumes.resumes.length,
    resume_versions: resumes.versions.length,
    resume_claims: resumes.claims.length,
    imports: imports.sessions.length,
    import_review_items: imports.sessions.reduce(
      (total, session) => total + session.items.length,
      0,
    ),
    consent_records: consent ? 1 : 0,
    audit_events: 0,
  };

  // Empty state, not a removed key: a removed key would let the fixture seed
  // reappear on the next read, which would look like a failed deletion.
  storage.setItem(
    workspaceKey(userId),
    JSON.stringify({
      version: ws.version + 1,
      items: [],
      changelog: [],
      updatedAt: at,
    }),
  );
  storage.setItem(
    targetsKey(userId),
    JSON.stringify({ targets: [], reports: {}, runs: {} }),
  );
  clearResumes(storage, userId);
  storage.setItem(importsKey(userId), JSON.stringify({ sessions: [] }));
  clearConsent(storage);

  return {
    dataDeleted: true,
    authUserDeleted: false,
    remainingStep: "auth_user",
    deletedAt: at,
    deletedCounts,
    message:
      "Your ResumeIQ data was deleted. The sign-in identity still exists and must be removed by the service operator.",
  };
}
