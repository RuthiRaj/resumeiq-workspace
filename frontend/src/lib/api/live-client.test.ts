import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiErrorMessage } from "./client";
import { setAccessTokenProvider } from "./token";

/**
 * Live-client wire tests (I1). `fetch` is mocked, so nothing leaves the test:
 * these assert the live URL, Bearer token, Zod validation and the mapping of
 * the backend's `{detail:{code,message}}` envelope onto `ApiError`.
 */

const ITEM = {
  id: "item-1",
  section: "experience",
  title: "Engineer",
  organization: null,
  startDate: "2024-01",
  endDate: null,
  location: null,
  bullets: ["Did a thing"],
  tags: [],
  links: [],
  attachments: [],
  evidence: "attested",
  order: 0,
  deletedAt: null,
};

const WORKSPACE = {
  version: 3,
  items: [ITEM],
  updatedAt: "2026-10-20T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock() {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_MODE = "live";
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:8000/";
  setAccessTokenProvider(async () => "access-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessTokenProvider(null);
  delete process.env.NEXT_PUBLIC_API_MODE;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
});

describe("live API client", () => {
  it("calls the FastAPI origin with the Bearer token and validates the body", async () => {
    const mock = fetchMock().mockResolvedValue(jsonResponse(WORKSPACE));
    vi.stubGlobal("fetch", mock);

    const workspace = await api.getWorkspace();

    expect(workspace.version).toBe(3);
    expect(workspace.items[0]?.organization).toBeNull();
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8000/api/v1/workspace");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-token");
  });

  it("drops unknown fields instead of forwarding them", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock().mockResolvedValue(
        jsonResponse({ ...WORKSPACE, internalSecret: "never render me" }),
      ),
    );

    const workspace = await api.getWorkspace();

    expect(workspace).not.toHaveProperty("internalSecret");
  });

  it("maps {detail:{code,message}} onto ApiError and keeps the code", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock().mockResolvedValue(
        jsonResponse(
          { detail: { code: "consent_required", message: "Grant AI-processing consent before running an analysis." } },
          403,
        ),
      ),
    );

    const error = await api.startAnalysis("target-1").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe("consent_required");
    expect(apiError.path).toBe("/targets/target-1/analysis");
    expect(apiError.message).toContain("consent");
    expect(apiErrorMessage(apiError, "fallback")).toContain("consent");
  });

  it("falls back to code copy when the envelope has no message", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock().mockResolvedValue(
        jsonResponse({ detail: { code: "rate_limited", message: "" } }, 429),
      ),
    );

    const error = (await api.listTargets().catch((err: unknown) => err)) as ApiError;

    expect(error.code).toBe("rate_limited");
    expect(error.message).toContain("Too many requests");
  });

  it("rejects a response that does not match the schema", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock().mockResolvedValue(jsonResponse({ version: 1, items: "nope" })),
    );

    const error = (await api.getWorkspace().catch((err: unknown) => err)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("invalid_response");
    expect(error.status).toBe(502);
  });

  it("maps a network failure to a friendly ApiError", async () => {
    vi.stubGlobal("fetch", fetchMock().mockRejectedValue(new TypeError("offline")));

    const error = (await api.getStandardResume().catch((err: unknown) => err)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe("network");
    expect(error.message).toContain("couldn't reach the server");
  });

  it("sends the multipart upload to POST /imports only", async () => {
    const session = {
      id: "import-1",
      fileName: "cv.pdf",
      fileType: "pdf",
      fileSize: 1234,
      pageCount: 1,
      sourceText: "Ada Lovelace",
      previewAvailable: true,
      items: [],
      createdAt: "2026-10-20T10:00:00.000Z",
      updatedAt: "2026-10-20T10:00:00.000Z",
    };
    const mock = fetchMock().mockResolvedValue(jsonResponse({ import: session }, 201));
    vi.stubGlobal("fetch", mock);

    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    const result = await api.uploadImport(file);

    expect(result.import.id).toBe("import-1");
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8000/api/v1/imports");
    expect(init?.body).toBeInstanceOf(FormData);
    // The browser must set the multipart boundary itself.
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
  });

  it("confirms a normal card through the atomic backend route", async () => {
    const review = {
      id: "review-1",
      extraction: {
        id: "ex-1",
        section: "experience",
        fields: [
          { key: "title", label: "Role", value: "Engineer", confidence: 0.9, sourceLine: 1 },
        ],
        bullets: [],
        tags: [],
        confidence: 0.9,
      },
      values: {
        title: "Engineer",
        organization: "",
        startDate: "",
        endDate: "",
        location: "",
        bullets: [],
        tags: [],
      },
      status: "confirmed",
      support: null,
      decidedAt: "2026-10-20T10:00:00.000Z",
    };
    const mock = fetchMock().mockResolvedValue(
      jsonResponse({ item: ITEM, review }, 200),
    );
    vi.stubGlobal("fetch", mock);

    const result = await api.confirmImportItem("import-1", {
      ...review,
      status: "pending",
      extraction: { ...review.extraction, section: "experience" },
    } as never);

    expect(result.items).toHaveLength(1);
    expect(result.review.status).toBe("confirmed");
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8000/api/v1/imports/import-1/items/review-1/confirm");
    expect(init?.method).toBe("POST");
  });

  it("keeps mock-only features out of live mode", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);

    const error = (await api.listVersions().catch((err: unknown) => err)) as ApiError;

    expect(error.code).toBe("not_available_in_live_mode");
    expect(error.status).toBe(501);
    expect(mock).not.toHaveBeenCalled();
  });

  it("defaults to the mock transport (relative URL, no token)", async () => {
    delete process.env.NEXT_PUBLIC_API_MODE;
    const mock = fetchMock().mockResolvedValue(jsonResponse(WORKSPACE));
    vi.stubGlobal("fetch", mock);

    await api.getWorkspace();

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("/api/v1/workspace");
    expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  });
});
