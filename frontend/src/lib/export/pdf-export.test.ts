import { describe, expect, it } from "vitest";
import { describeExportCheck, parseExportCheck } from "./pdf-export";

describe("parseExportCheck", () => {
  it("reads the extraction headers and content-disposition filename", () => {
    const headers = new Headers({
      "X-Export-Text-Check": "passed",
      "X-Export-Sections-Checked": "5",
      "X-Export-Sections-Missing": "1",
      "X-Export-Claims-Checked": "21",
      "X-Export-Claims-Missing": "0",
      "Content-Disposition": 'attachment; filename="senior-frontend.pdf"',
    });

    expect(parseExportCheck(headers)).toEqual({
      textCheck: "passed",
      sectionsChecked: 5,
      sectionsMissing: 1,
      claimsChecked: 21,
      claimsMissing: 0,
      filename: "senior-frontend.pdf",
    });
  });

  it("falls back to a safe name and unknown check when headers are absent", () => {
    const parsed = parseExportCheck(new Headers(), "fallback.pdf");

    expect(parsed.textCheck).toBe("unknown");
    expect(parsed.filename).toBe("fallback.pdf");
    expect(parsed.claimsChecked).toBe(0);
  });

  it("never keeps a path from the content-disposition header", () => {
    const headers = new Headers({
      "Content-Disposition": 'attachment; filename="../../etc/passwd.pdf"',
    });

    expect(parseExportCheck(headers).filename).toBe("passwd.pdf");
  });

  it("supports the UTF-8 filename form", () => {
    const headers = new Headers({
      "Content-Disposition":
        "attachment; filename*=UTF-8''resume%20senior%20frontend.pdf",
    });

    expect(parseExportCheck(headers).filename).toBe("resume senior frontend.pdf");
  });
});

describe("describeExportCheck", () => {
  it("states the verified counts for a passed check", () => {
    expect(
      describeExportCheck({
        textCheck: "passed",
        sectionsChecked: 3,
        sectionsMissing: 0,
        claimsChecked: 12,
        claimsMissing: 0,
        filename: "resume.pdf",
      }),
    ).toBe("Text extraction passed: 3 sections and 12 claims verified.");
  });

  it("uses singular nouns for a one-section, one-claim resume", () => {
    expect(
      describeExportCheck({
        textCheck: "passed",
        sectionsChecked: 1,
        sectionsMissing: 0,
        claimsChecked: 1,
        claimsMissing: 0,
        filename: "resume.pdf",
      }),
    ).toBe("Text extraction passed: 1 section and 1 claim verified.");
  });

  it("explains a refusal without claiming the PDF was delivered", () => {
    const message = describeExportCheck({
      textCheck: "failed",
      sectionsChecked: 3,
      sectionsMissing: 1,
      claimsChecked: 12,
      claimsMissing: 2,
      filename: "resume.pdf",
    });

    expect(message).toContain("3 checks missing");
    expect(message).toContain("refused");
  });

  it("does not invent a result when the server sent no check", () => {
    expect(
      describeExportCheck({
        textCheck: "unknown",
        sectionsChecked: 0,
        sectionsMissing: 0,
        claimsChecked: 0,
        claimsMissing: 0,
        filename: "resume.pdf",
      }),
    ).toContain("did not report");
  });

  it("never claims a refused PDF was downloaded", () => {
    const message = describeExportCheck(
      {
        textCheck: "unknown",
        sectionsChecked: 0,
        sectionsMissing: 0,
        claimsChecked: 0,
        claimsMissing: 0,
        filename: "resume.pdf",
      },
      false,
    );

    expect(message).not.toContain("was downloaded");
    expect(message).toContain("was not downloaded");
    expect(message).toContain("did not report");
  });
});
