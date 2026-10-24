/**
 * B6 PDF-export metadata (contract-proposals §9.2).
 *
 * The server streams the PDF and reports a text-extraction check in headers.
 * A refused export (502 `export_verification_failed`) carries the same
 * headers, so the UI can say *why* no file was delivered. Header values are
 * counts only, never claim text (no personal data in logs/proxies).
 */

export type TextCheck = "passed" | "failed" | "unknown";

export interface ExportCheck {
  textCheck: TextCheck;
  sectionsChecked: number;
  sectionsMissing: number;
  claimsChecked: number;
  claimsMissing: number;
  filename: string;
}

function count(headers: Headers, name: string): number {
  const raw = headers.get(name);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  // RFC 5987: filename*=UTF-8''resume.pdf (preferred over the ASCII fallback).
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  const candidate = extended
    ? decodeURIComponent(extended[1].trim())
    : /filename\s*=\s*"([^"]+)"/i.exec(value)?.[1] ??
      /filename\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim();
  if (!candidate) return null;
  // Never let a header path escape the download name.
  const base = candidate.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/[^\w .-]+/g, "-").replace(/\s+/g, " ").trim();
  return safe || null;
}

export function parseExportCheck(
  headers: Headers,
  fallbackFilename = "resumeiq-resume.pdf",
): ExportCheck {
  const raw = headers.get("X-Export-Text-Check")?.toLowerCase();
  return {
    textCheck: raw === "passed" || raw === "failed" ? raw : "unknown",
    sectionsChecked: count(headers, "X-Export-Sections-Checked"),
    sectionsMissing: count(headers, "X-Export-Sections-Missing"),
    claimsChecked: count(headers, "X-Export-Claims-Checked"),
    claimsMissing: count(headers, "X-Export-Claims-Missing"),
    filename:
      filenameFromDisposition(headers.get("Content-Disposition")) ??
      fallbackFilename,
  };
}

/** Human-readable extraction result; never claims the PDF is "ATS-proof". */
export function describeExportCheck(
  check: ExportCheck,
  delivered = true,
): string {
  if (check.textCheck === "unknown") {
    return delivered
      ? "The PDF was downloaded, but the server did not report its text-extraction check."
      : "The server did not report its PDF text-extraction check, so the PDF was not downloaded.";
  }
  if (check.textCheck === "failed") {
    const missing = check.claimsMissing + check.sectionsMissing;
    return `Text extraction failed (${missing} check${missing === 1 ? "" : "s"} missing), so the PDF was refused.`;
  }
  return `Text extraction passed: ${check.sectionsChecked} section${
    check.sectionsChecked === 1 ? "" : "s"
  } and ${check.claimsChecked} claim${check.claimsChecked === 1 ? "" : "s"} verified.`;
}
