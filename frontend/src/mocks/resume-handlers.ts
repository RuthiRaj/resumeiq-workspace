import { http, HttpResponse } from "msw";
import {
  ResumeGenerateRequestSchema,
  ResumeRefreshRequestSchema,
  ResumeSectionEditSchema,
} from "@/lib/schemas";
import { loadConsent } from "@/lib/privacy/consent";
import { currentUserId, failIfEnabled, latency, storage } from "./context";
import {
  ResumeStoreError,
  diffResume,
  editResumeSection,
  generateResume,
  getResume,
  listResumes,
  listVersions,
  markResumeStale,
  refreshResume,
  restoreResumeVersion,
} from "./resume-store";

/**
 * Tailored-resume mock endpoints (B5 contract §6). They intentionally enforce
 * the same gates as the FastAPI branch: current analysis, recorded AI consent,
 * active evidence ids, grounding-checked edits and per-section refresh.
 */

function detail(status: number, code: string, message: string) {
  return HttpResponse.json({ detail: { code, message } }, { status });
}

function fromError(error: unknown) {
  if (error instanceof ResumeStoreError) {
    return detail(error.status, error.code, error.message);
  }
  return detail(500, "internal_error", "The mock resume service hit an error.");
}

async function bodyOf<T>(
  request: Request,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<T | null> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function aiConsentGranted(): boolean {
  return loadConsent(storage())?.aiProcessing === true;
}

function aiGateError() {
  return detail(
    403,
    "ai_consent_required",
    "AI rewording needs recorded AI-processing consent. Generate without it, or record consent in Privacy settings.",
  );
}

export const resumeHandlers = [
  http.get("/api/v1/resumes", async () => {
    return (
      failIfEnabled() ??
      (await latency(), HttpResponse.json(listResumes(storage(), currentUserId())))
    );
  }),

  http.get("/api/v1/resumes/:resumeId", async ({ params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    try {
      return HttpResponse.json(
        getResume(storage(), currentUserId(), String(params.resumeId)),
      );
    } catch (error) {
      return fromError(error);
    }
  }),

  http.post("/api/v1/targets/:targetId/resume", async ({ request, params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    const input = await bodyOf(request, ResumeGenerateRequestSchema);
    if (!input) {
      return detail(
        422,
        "validation_error",
        "The generation request is not valid.",
      );
    }
    if (input.rewordWithAi && !aiConsentGranted()) return aiGateError();
    try {
      const resume = generateResume(
        storage(),
        currentUserId(),
        String(params.targetId),
        input,
      );
      return HttpResponse.json(resume, { status: 201 });
    } catch (error) {
      return fromError(error);
    }
  }),

  http.patch(
    "/api/v1/resumes/:resumeId/sections/:sectionKey",
    async ({ request, params }) => {
      const failed = failIfEnabled();
      if (failed) return failed;
      await latency();
      const input = await bodyOf(request, ResumeSectionEditSchema);
      if (!input) {
        return detail(
          422,
          "validation_error",
          "A section needs at least one line, and every line needs text and evidence.",
        );
      }
      try {
        return HttpResponse.json(
          editResumeSection(
            storage(),
            currentUserId(),
            String(params.resumeId),
            String(params.sectionKey),
            input,
          ),
        );
      } catch (error) {
        return fromError(error);
      }
    },
  ),

  http.get("/api/v1/resumes/:resumeId/versions", async ({ params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    try {
      return HttpResponse.json(
        listVersions(storage(), currentUserId(), String(params.resumeId)),
      );
    } catch (error) {
      return fromError(error);
    }
  }),

  http.post(
    "/api/v1/resumes/:resumeId/versions/:versionId/restore",
    async ({ params }) => {
      const failed = failIfEnabled();
      if (failed) return failed;
      await latency();
      try {
        return HttpResponse.json(
          restoreResumeVersion(
            storage(),
            currentUserId(),
            String(params.resumeId),
            String(params.versionId),
          ),
        );
      } catch (error) {
        return fromError(error);
      }
    },
  ),

  http.post("/api/v1/resumes/:resumeId/stale", async ({ params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    try {
      return HttpResponse.json(
        markResumeStale(
          storage(),
          currentUserId(),
          String(params.resumeId),
        ),
      );
    } catch (error) {
      return fromError(error);
    }
  }),

  http.get("/api/v1/resumes/:resumeId/diff", async ({ params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    try {
      return HttpResponse.json(
        diffResume(storage(), currentUserId(), String(params.resumeId)),
      );
    } catch (error) {
      return fromError(error);
    }
  }),

  http.post("/api/v1/resumes/:resumeId/refresh", async ({ request, params }) => {
    const failed = failIfEnabled();
    if (failed) return failed;
    await latency();
    const input = await bodyOf(request, ResumeRefreshRequestSchema);
    if (!input) {
      return detail(
        422,
        "validation_error",
        "The refresh request is not valid.",
      );
    }
    if (input.rewordWithAi && !aiConsentGranted()) return aiGateError();
    try {
      return HttpResponse.json(
        refreshResume(
          storage(),
          currentUserId(),
          String(params.resumeId),
          input,
        ),
      );
    } catch (error) {
      return fromError(error);
    }
  }),
];
