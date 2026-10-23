import { describe, expect, it } from "vitest";
import { dataExportFilename } from "./download";

describe("dataExportFilename", () => {
  it("uses the export timestamp date", () => {
    expect(dataExportFilename("2026-10-22T09:15:00.000Z")).toBe(
      "resumeiq-data-export-2026-10-22.json",
    );
  });

  it("falls back to today when the timestamp is unreadable", () => {
    expect(dataExportFilename("not-a-date")).toMatch(
      /^resumeiq-data-export-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});
