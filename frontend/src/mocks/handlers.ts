import { http, HttpResponse } from "msw";
import { fixtureItems, fixtureWorkspaceVersion } from "./fixtures";

/**
 * MSW handlers implementing the same endpoints the FastAPI backend will
 * expose later (PRD §8.3), so no UI rewrite is needed at integration (B7).
 * F0: workspace read + standard-resume stub. Full behaviours (sync,
 * staleness, slow AI, failures) land in F3–F4.
 */
export const handlers = [
  http.get("/api/v1/workspace", () =>
    HttpResponse.json({
      version: fixtureWorkspaceVersion,
      items: fixtureItems,
      updatedAt: new Date().toISOString(),
    }),
  ),

  http.get("/api/v1/resume/standard", () =>
    HttpResponse.json({
      id: "resume-standard",
      kind: "standard",
      workspaceVersion: fixtureWorkspaceVersion,
      stale: false,
      sections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  ),
];
