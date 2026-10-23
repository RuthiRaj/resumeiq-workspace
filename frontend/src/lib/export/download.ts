/**
 * Client-side file downloads (data export + PDF). Kept in one place so every
 * download uses the same object-URL cleanup and no screen leaks a blob URL.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, filename);
}

/** `resumeiq-data-export-2026-10-22.json`, derived from the export timestamp. */
export function dataExportFilename(exportedAt: string): string {
  const date = new Date(exportedAt);
  const stamp = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  return `resumeiq-data-export-${stamp}.json`;
}
