import type { Resume } from "@/lib/schemas";

/**
 * Minimal single-page PDF used by the mock export route (B6 §9.2 parity).
 *
 * It renders only the resume's own title, section headings and claims — the
 * same rule as the live exporter — and produces real PDF bytes so the browser
 * downloads a file that opens. ASCII-only Helvetica keeps the byte offsets
 * exact and the text layer extractable.
 */

const SECTION_LABELS: Record<string, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  project: "Projects",
  skill: "Skills",
  certification: "Certifications",
  course: "Courses",
  achievement: "Achievements",
  publication: "Publications",
  training: "Training",
  internship: "Internships",
  contact: "Contact",
};

/** Typographic characters that would otherwise need embedded font subsets. */
function toAscii(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(line: string, width = 92): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function sectionLabel(key: string): string {
  return (
    SECTION_LABELS[key] ??
    key
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

export interface MockPdfResult {
  bytes: Uint8Array;
  sectionsChecked: number;
  claimsChecked: number;
  filename: string;
}

export function buildMockResumePdf(resume: Resume): MockPdfResult {
  const title = toAscii(resume.title?.trim() || "Resume");
  const lines: string[] = [title, ""];
  let sectionsChecked = 0;
  let claimsChecked = 0;

  for (const section of resume.sections) {
    const claims = section.claims.filter((claim) => claim.text.trim());
    if (!claims.length) continue;
    sectionsChecked += 1;
    lines.push(sectionLabel(section.key).toUpperCase());
    for (const claim of claims) {
      claimsChecked += 1;
      lines.push(...wrap(`- ${toAscii(claim.text.trim())}`).map((line, index) => (index === 0 ? line : `  ${line}`)));
    }
    lines.push("");
  }

  const content = [
    "BT",
    "/F1 10 Tf",
    "14 TL",
    "56 786 Td",
    ...lines.map((line) => `(${escapePdf(line)}) Tj T*`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const slug = (resume.title ?? "resume")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  return {
    bytes: new TextEncoder().encode(pdf),
    sectionsChecked,
    claimsChecked,
    filename: `${slug || "resume"}.pdf`,
  };
}
