import { http, HttpResponse } from "msw";
import { z } from "zod";
import {
  ImportItemStatusSchema,
  ImportItemValuesSchema,
  ImportSupportSchema,
  validateImportUpload,
} from "@/lib/schemas";
import {
  createImport,
  getImport,
  listImportSummaries,
  updateImportItem,
} from "./imports-store";
import {
  currentUserId,
  failIfEnabled,
  latency,
  providerLatency,
  storage,
} from "./context";

/**
 * Upload + extraction review endpoints (B2 contract, PRD §6.2 IM-1..IM-3).
 *
 * The upload is read as multipart/form-data (the shape the FastAPI backend will
 * expose); the mock only needs the file's name and size, because the extracted
 * items come from the simulated document in `import-fixtures.ts`.
 */

const JsonUploadBody = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
});

const ImportItemPatchBody = z.object({
  values: ImportItemValuesSchema.optional(),
  status: ImportItemStatusSchema.optional(),
  support: ImportSupportSchema.nullable().optional(),
});

async function readUpload(
  request: Request,
): Promise<{ name: string; size: number } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) return { name: file.name, size: file.size };
    } catch {
      return null;
    }
    return null;
  }
  const parsed = JsonUploadBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return null;
  return { name: parsed.data.fileName, size: parsed.data.fileSize };
}

export const importHandlers = [
  http.post("/api/v1/imports", async ({ request }) => {
    // "Slow AI": long enough for the staged extraction progress to be real.
    await providerLatency();
    const failure = failIfEnabled();
    if (failure) return failure;

    const upload = await readUpload(request);
    if (!upload) {
      return HttpResponse.json(
        { error: "Attach a PDF or DOCX file to import." },
        { status: 400 },
      );
    }
    const check = validateImportUpload(upload);
    if (!check.ok) {
      return HttpResponse.json({ error: check.reason }, { status: 400 });
    }
    if (upload.size === 0) {
      return HttpResponse.json(
        { error: "That file looks empty. Pick another one." },
        { status: 400 },
      );
    }

    const session = createImport(
      storage(),
      currentUserId(),
      { fileName: upload.name, fileType: check.fileType, fileSize: upload.size },
      () => new Date().toISOString(),
    );
    return HttpResponse.json({ import: session }, { status: 201 });
  }),

  http.get("/api/v1/imports", async () => {
    await latency();
    return HttpResponse.json(listImportSummaries(storage(), currentUserId()));
  }),

  http.get("/api/v1/imports/:id", async ({ params }) => {
    await latency();
    const session = getImport(storage(), currentUserId(), String(params.id));
    if (!session) {
      return HttpResponse.json({ error: "That import no longer exists." }, { status: 404 });
    }
    return HttpResponse.json(session);
  }),

  http.patch("/api/v1/imports/:id/items/:itemId", async ({ request, params }) => {
    await latency(150);
    const failure = failIfEnabled();
    if (failure) return failure;
    const parsed = ImportItemPatchBody.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return HttpResponse.json(
        { error: "Check the highlighted fields and try again." },
        { status: 422 },
      );
    }
    const item = updateImportItem(
      storage(),
      currentUserId(),
      String(params.id),
      String(params.itemId),
      parsed.data,
      () => new Date().toISOString(),
    );
    if (!item) {
      return HttpResponse.json(
        { error: "That extracted item no longer exists." },
        { status: 404 },
      );
    }
    return HttpResponse.json(item);
  }),
];
