import { describe, expect, it } from "vitest";
import { ResumeSchema } from "@/lib/schemas";
import { buildMockResumePdf } from "./mock-pdf";

function resume() {
  return ResumeSchema.parse({
    id: "resume-1",
    kind: "tailored",
    targetId: "target-1",
    title: "Senior Frontend Engineer",
    workspaceVersion: 3,
    sections: [
      {
        key: "summary",
        claims: [
          { text: "Frontend engineer with 6 years of experience." },
          { text: "Built accessible interfaces in React." },
        ],
      },
      {
        key: "experience",
        claims: [{ text: "Led the design system at Halcyon." }],
      },
      { key: "education", claims: [] },
    ],
    createdAt: "2026-10-20T09:00:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
  });
}

describe("buildMockResumePdf", () => {
  it("produces a real PDF with exact xref offsets", () => {
    const pdf = buildMockResumePdf(resume());
    const text = new TextDecoder().decode(pdf.bytes);

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);

    const startxref = /startxref\n(\d+)/.exec(text);
    expect(startxref).not.toBeNull();
    const offset = Number.parseInt(startxref![1], 10);
    expect(text.slice(offset, offset + 4)).toBe("xref");
  });

  it("counts only non-empty sections and every rendered claim", () => {
    const pdf = buildMockResumePdf(resume());

    expect(pdf.sectionsChecked).toBe(2);
    expect(pdf.claimsChecked).toBe(3);
    expect(pdf.filename).toBe("senior-frontend-engineer.pdf");
  });

  it("transliterates typographic characters instead of emitting broken text", () => {
    const input = resume();
    input.sections[0].claims[0].text = "Built “smart” interfaces — fast.";
    const text = new TextDecoder().decode(buildMockResumePdf(input).bytes);

    expect(text).toContain('Built "smart" interfaces - fast.');
  });
});
