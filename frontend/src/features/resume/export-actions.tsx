"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/features/ui/toast-store";
import type { Resume, ResumeTemplate, TargetLength } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { printResumeDocument } from "./print-resume";
import { ResumeDocument } from "./resume-document";
import {
  DEFAULT_DOCUMENT_ORDER,
  buildResumeDocument,
} from "./resume-document-model";
import { ResumePrintPortal } from "./resume-print-portal";

/**
 * One export action for `/resume`, the Resume Studio and History.
 *
 * Download PDF uses the browser's own print path on the exact `ResumeDocument`
 * the preview renders; before printing it sets the document title to
 * `<Name> - Resume`, so "Save as PDF" is named after the candidate. There is
 * deliberately one renderer only: the shared `ResumeDocument` fed by
 * `resume-document-model` (same merged section labels, formatted dates, contact
 * line, template and length as the screen). A second, plain-text PDF generator
 * no longer exists.
 *
 * The dark app chrome is hidden by the print stylesheet, so the printed page is
 * the white A4 document alone (`ResumePrintPortal` on pages whose visible
 * preview is not already the sheet).
 */
export function ExportActions({
  resume,
  template = "precision",
  length = "one_page",
  order = [...DEFAULT_DOCUMENT_ORDER],
  hidden = [],
  className,
  printPortal = true,
}: {
  resume?: Pick<Resume, "sections"> | null;
  template?: ResumeTemplate;
  length?: TargetLength;
  order?: string[];
  hidden?: string[];
  className?: string;
  /** Set false when the page's visible preview is already the print sheet. */
  printPortal?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const printDocument = resume
    ? buildResumeDocument(resume, { length, order, hidden })
    : null;
  const canExport = Boolean(printDocument && !printDocument.empty);

  /**
   * The print dialog is the single export path. Chrome/Edge give it a filename
   * of `<Name> - Resume`, so "Save as PDF" produces the same document the user
   * sees, with selectable text and no second layout.
   */
  function downloadPdf() {
    if (!printDocument || !canExport) return;
    setError(null);
    setOpened(false);
    try {
      printResumeDocument(printDocument.name);
      setOpened(true);
      toast({
        tone: "success",
        title: "PDF ready to save",
        description:
          "Choose “Save as PDF”; the file is named after the candidate.",
      });
    } catch {
      setError(
        "Your browser blocked printing, so no PDF was produced. Your resume is unchanged; try again.",
      );
      toast({
        tone: "error",
        title: "PDF not created",
        description: "Your resume is unchanged and stays editable.",
      });
    }
  }

  return (
    <>
      <div
        className={cn("no-print flex w-full flex-col gap-1.5", className)}
        data-testid="export-actions"
      >
        <div className="flex flex-wrap items-stretch gap-2">
          <Button
            variant="primary"
            size="sm"
            className="h-9 min-w-[8.5rem]"
            onClick={downloadPdf}
            disabled={!canExport}
            data-testid="pdf-export-button"
          >
            <Download className="size-4" aria-hidden="true" />
            Download PDF
          </Button>
        </div>

        <div
          className="h-10 w-full overflow-y-auto text-[11px] leading-relaxed"
          aria-live="polite"
          data-testid="export-status"
        >
          {opened ? (
            <p
              role="status"
              className="text-muted"
              data-testid="pdf-export-status"
            >
              Print dialog opened. Choose “Save as PDF” to save this same
              document.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="text-evidence-missing"
              data-testid="pdf-export-error"
            >
              {error}
            </p>
          ) : null}

          {!opened && !error ? (
            <p className="text-muted">
              Download PDF renders this exact document. Your browser&apos;s
              print dialog opens so you can save it as a PDF.
            </p>
          ) : null}
        </div>
      </div>

      {printPortal && printDocument ? (
        <ResumePrintPortal>
          <ResumeDocument
            document={printDocument}
            template={template}
            testId="resume-print-document"
          />
        </ResumePrintPortal>
      ) : null}
    </>
  );
}
