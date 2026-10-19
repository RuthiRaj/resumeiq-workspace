import { http, HttpResponse } from "msw";
import { TargetCreateSchema } from "@/lib/schemas";
import {
  createSampleTargets,
  createTarget,
  getReport,
  getTarget,
  listTargets,
  startRun,
  advanceRun,
} from "./targets-store";
import { failuresEnabled } from "./dev-state";
import { currentUserId, failIfEnabled, latency, storage } from "./context";

/**
 * Job target + analysis endpoints (B4 contract).
 *
 * The analysis is *staged*, not instant: `GET .../analysis/run` advances the
 * persisted run from wall-clock time, so the theatre can poll and animate real
 * progress, and a reload resumes where it left off (PRD §6.4, §7.4.4).
 */
export const targetHandlers = [
  http.get("/api/v1/targets", async () => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    return HttpResponse.json(listTargets(storage(), currentUserId()));
  }),

  http.post("/api/v1/targets", async ({ request }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const parsed = TargetCreateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json(
        {
          error: "Check the highlighted fields and try again.",
          detail: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }
    const target = createTarget(storage(), currentUserId(), parsed.data);
    return HttpResponse.json(target, { status: 201 });
  }),

  http.get("/api/v1/targets/:id", async ({ params }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const target = getTarget(storage(), currentUserId(), String(params.id));
    if (!target) {
      return HttpResponse.json({ error: "That job target no longer exists." }, { status: 404 });
    }
    return HttpResponse.json(target);
  }),

  // Start (or restart) the analysis run.
  http.post("/api/v1/targets/:id/analysis", async ({ params }) => {
    await latency(150);
    const run = startRun(storage(), currentUserId(), String(params.id));
    if (!run) {
      return HttpResponse.json({ error: "That job target no longer exists." }, { status: 404 });
    }
    return HttpResponse.json({ run, report: null }, { status: 202 });
  }),

  // Poll the run. Deliberately *not* behind `failIfEnabled`: the dev failure
  // toggle fails the run mid-flight so the theatre shows its failed state.
  http.get("/api/v1/targets/:id/analysis/run", async ({ params }) => {
    const state = advanceRun(
      storage(),
      currentUserId(),
      String(params.id),
      undefined,
      failuresEnabled(),
    );
    if (!state) {
      return HttpResponse.json(
        { error: "No analysis run for that target. Start one first." },
        { status: 404 },
      );
    }
    return HttpResponse.json(state);
  }),

  http.get("/api/v1/targets/:id/analysis", async ({ params }) => {
    await latency();
    const failure = failIfEnabled();
    if (failure) return failure;
    const report = getReport(storage(), currentUserId(), String(params.id));
    if (!report) {
      return HttpResponse.json(
        { error: "This target hasn't finished an analysis yet." },
        { status: 404 },
      );
    }
    return HttpResponse.json(report);
  }),

  // Dev-only: write the three demo targets (PRD §8.5).
  http.post("/api/v1/dev/sample-targets", async () => {
    if (process.env.NODE_ENV !== "development") {
      return HttpResponse.json({ error: "Not found." }, { status: 404 });
    }
    await latency();
    const targets = createSampleTargets(storage(), currentUserId());
    return HttpResponse.json({ targets });
  }),
];
