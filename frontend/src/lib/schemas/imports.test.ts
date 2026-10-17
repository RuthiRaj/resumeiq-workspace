import { describe, expect, it } from "vitest";
import {
  IMPORT_LIMITS_COPY,
  MAX_IMPORT_BYTES,
  evidenceForReviewItem,
  reviewItemProblem,
  reviewItemToWorkspaceInput,
  reviewProgress,
  uncertainFields,
  validateImportUpload,
  type ImportReviewItem,
} from "@/lib/schemas";
import { buildImportSession, previewNote } from "@/mocks/import-fixtures";

/**
 * Extraction-review logic (PRD §6.2 IM-1..IM-3): upload gating, the uncertainty
 * flag, the evidence rule and the shape of what actually reaches the workspace.
 */

function session(fileName: string, fileSize = 200_000) {
  return buildImportSession({
    id: "imp-1",
    fileName,
    fileType: fileName.endsWith(".docx") ? "docx" : "pdf",
    fileSize,
    now: "2026-10-17T09:00:00.000Z",
  });
}

function withSupport(
  item: ImportReviewItem,
  support: NonNullable<ImportReviewItem["support"]>,
): ImportReviewItem {
  return { ...item, support };
}

describe("import upload validation (IM-1)", () => {
  it("accepts PDF and DOCX", () => {
    expect(validateImportUpload({ name: "resume.pdf", size: 1024 }).ok).toBe(true);
    expect(validateImportUpload({ name: "resume.docx", size: 1024 }).ok).toBe(true);
  });

  it("rejects unsupported types with a readable reason", () => {
    const check = validateImportUpload({ name: "photo.png", size: 1024 });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("PDF");
  });

  it("rejects files over the size limit", () => {
    const check = validateImportUpload({
      name: "resume.pdf",
      size: MAX_IMPORT_BYTES + 1,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain("MB");
  });

  it("states the limits in one place", () => {
    expect(IMPORT_LIMITS_COPY).toContain("5 MB");
  });
});

describe("extraction review (IM-2)", () => {
  it("flags only the fields the parser was unsure about", () => {
    const parsed = session("ada-resume.pdf");
    const internship = parsed.items.find((item) => item.id === "ext-internship");
    expect(internship).toBeDefined();
    const uncertain = uncertainFields(internship as ImportReviewItem);
    expect(uncertain.map((field) => field.key)).toContain("organization");
    expect(uncertain.map((field) => field.key)).toContain("endDate");
    expect(uncertain.map((field) => field.key)).not.toContain("title");
  });

  it("never returns a field the user could not check against the source", () => {
    const parsed = session("ada-resume.pdf");
    for (const entry of parsed.items) {
      for (const field of uncertainFields(entry)) {
        // Every flagged field points at a real preview line.
        expect(field.sourceLine).toBeGreaterThan(0);
        expect(field.sourceLine).toBeLessThanOrEqual(
          parsed.sourceText.split("\n").length,
        );
      }
    }
  });

  it("reads nothing from a scanned document and says so", () => {
    const parsed = session("scanned-cv.pdf");
    expect(parsed.items).toEqual([]);
    expect(parsed.previewAvailable).toBe(false);
  });

  it("labels the preview as simulated for both formats", () => {
    expect(previewNote("pdf")).toContain("Simulated");
    expect(previewNote("docx")).toContain("Simulated");
  });

  it("reports progress over the reviewed items", () => {
    const parsed = session("ada-resume.pdf");
    const total = parsed.items.length;
    const progress = reviewProgress(parsed.items);
    expect(progress).toEqual({ total, pending: total, confirmed: 0, rejected: 0 });
    const [first, ...rest] = parsed.items;
    expect(
      reviewProgress([{ ...first, status: "confirmed" }, ...rest]).confirmed,
    ).toBe(1);
  });
});

describe("confirming an item (IM-3)", () => {
  const parsed = session("ada-resume.pdf");
  const internship = parsed.items.find((item) => item.id === "ext-internship") as ImportReviewItem;

  it("records User-attested without a certificate", () => {
    expect(evidenceForReviewItem(internship)).toBe("attested");
    const input = reviewItemToWorkspaceInput(internship);
    expect(input.evidence).toBe("attested");
    expect(input.attachments).toEqual([]);
    expect(input.links).toEqual([]);
  });

  it("records Verified when a certificate link is attached", () => {
    const withLink = withSupport(internship, {
      kind: "link",
      url: "https://example.com/credentials/abc",
    });
    expect(evidenceForReviewItem(withLink)).toBe("verified");
    const input = reviewItemToWorkspaceInput(withLink);
    expect(input.evidence).toBe("verified");
    expect(input.links).toEqual(["https://example.com/credentials/abc"]);
  });

  it("records Verified when a certificate file is attached", () => {
    const withFile = withSupport(internship, {
      kind: "file",
      name: "internship-certificate.pdf",
    });
    const input = reviewItemToWorkspaceInput(withFile);
    expect(input.evidence).toBe("verified");
    expect(input.attachments).toHaveLength(1);
    expect(input.attachments[0]?.name).toBe("internship-certificate.pdf");
  });

  it("copies the reviewed values, not the raw extraction", () => {
    const edited: ImportReviewItem = {
      ...internship,
      values: {
        ...internship.values,
        title: "Backend Engineering Intern",
        endDate: "",
        bullets: ["  Trimmed line  ", ""],
      },
    };
    const input = reviewItemToWorkspaceInput(edited);
    expect(input.title).toBe("Backend Engineering Intern");
    expect(input.endDate).toBeUndefined();
    expect(input.bullets).toEqual(["Trimmed line"]);
  });

  it("blocks confirming an item without a title", () => {
    const empty: ImportReviewItem = {
      ...internship,
      values: { ...internship.values, title: "   " },
    };
    expect(reviewItemProblem(empty)).toContain("title");
    expect(reviewItemProblem(internship)).toBeNull();
  });

  it("blocks confirming a malformed month", () => {
    const broken: ImportReviewItem = {
      ...internship,
      values: { ...internship.values, startDate: "June 2024" },
    };
    expect(reviewItemProblem(broken)).not.toBeNull();
  });

  it("uses the same mid-level skills the analysis engine will match", () => {
    const skills = parsed.items
      .filter((item) => item.extraction.section === "skill")
      .map((item) => reviewItemToWorkspaceInput(item).title);
    expect(skills).toContain("TypeScript");
    expect(skills).toContain("React");
    expect(skills).toContain("PostgreSQL");
  });
});
