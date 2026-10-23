"use client";

import { useState } from "react";
import { Download, FileWarning, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/features/ui/toast-store";
import { ApiError, apiErrorMessage, api } from "@/lib/api";
import { downloadBlob } from "@/lib/export/download";
import {
  describeExportCheck,
  parseExportCheck,
  type ExportCheck,
} from "@/lib/export/pdf-export";
import { useCapabilities } from "@/lib/privacy/use-capabilities";
import { cn } from "@/lib/utils";

/**
 * Server-side PDF export (B6 §9.2) shared by `/resume` and the studio.
 *
 * The download only starts after the server's `X-Export-*` text-extraction
 * check says `passed`. A refused export (502 `export_verification_failed`)
 * downloads nothing, keeps the resume editable and explains the check in
 * place. When capabilities say PDF export is off — including a failed
 * capabilities read — the control stays disabled with the reason instead of
 * looking clickable.
 */
export function PdfExportButton({
  resumeId,
  className,
}: {
  resumeId: string;
  className?: string;
}) {
  const capabilities = useCapabilities();
  const [working, setWorking] = useState(false);
  const [check, setCheck] = useState<ExportCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const unavailable = !capabilities.isLoading && !capabilities.pdfExport;

  async function run() {
    setWorking(true);
    setError(null);
    setCheck(null);
    try {
      const result = await api.exportResumePdf(resumeId);
      const parsed = parseExportCheck(result.headers);
      setCheck(parsed);
      if (parsed.textCheck === "failed") {
        // Defensive: a 200 with a failed check must never reach the user.
        setError(
          "The PDF failed its text check and was not downloaded. Your resume is unchanged; try again.",
        );
        return;
      }
      downloadBlob(result.blob, parsed.filename);
      toast({
        tone: "success",
        title: "PDF downloaded",
        description: describeExportCheck(parsed),
      });
    } catch (cause) {
      const failedCheck =
        cause instanceof ApiError && cause.responseHeaders
          ? parseExportCheck(cause.responseHeaders)
          : null;
      if (failedCheck) setCheck(failedCheck);
      const message = apiErrorMessage(
        cause,
        "The PDF could not be exported. Your resume is unchanged; try again.",
      );
      setError(
        cause instanceof ApiError && cause.status === 502
          ? `${message} Your resume is unchanged and stays editable; no file was downloaded.`
          : message,
      );
      toast({
        tone: "error",
        title: "PDF export refused",
        description:
          "No file was downloaded. Your resume is unchanged and still editable.",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid="pdf-export">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void run()}
        disabled={working || capabilities.isLoading || unavailable}
        aria-busy={working}
        aria-describedby={unavailable ? "pdf-export-unavailable" : undefined}
        data-testid="pdf-export-button"
      >
        {working ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {working
          ? "Checking PDF…"
          : unavailable
            ? "PDF export unavailable"
            : "Download PDF"}
      </Button>

      {unavailable ? (
        <p
          id="pdf-export-unavailable"
          className="max-w-xs text-[11px] leading-relaxed text-muted"
        >
          {capabilities.isError
            ? "This server's capabilities could not be checked, so PDF export is treated as unavailable. Retry to check again."
            : "This server does not offer server-side PDF export. Your browser's Print / Save as PDF still works."}
        </p>
      ) : null}

      {check ? (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 text-[11px] leading-relaxed",
            check.textCheck === "failed" ? "text-evidence-missing" : "text-muted",
          )}
          data-testid="pdf-export-check"
        >
          <FileWarning className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          {describeExportCheck(check)}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="max-w-xs text-[11px] leading-relaxed text-evidence-missing"
          data-testid="pdf-export-error"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
