"use client";

import { useEffect } from "react";
import type { Resume, ResumeTemplate, TargetLength } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { ResumeDocument } from "./resume-document";
import { buildResumeDocument } from "./resume-document-model";

/**
 * Screen preview of the shared resume document. Warnings and counters are
 * deliberately rendered *outside* the white page, under it, so the document
 * contains only resume facts.
 */
export function ResumePaper({
  resume,
  template,
  length,
  order,
  hidden,
  className,
  testId = "resume-paper",
}: {
  resume: Pick<Resume, "sections">;
  template: ResumeTemplate;
  length: TargetLength;
  order: string[];
  hidden: string[];
  className?: string;
  testId?: string;
}) {
  const resumeDocument = buildResumeDocument(resume, { length, order, hidden });

  // The preview document is also the print document. This body class lets the
  // print stylesheet hide the app shell without mounting a second copy.
  useEffect(() => {
    globalThis.document.body.classList.add("resume-print-mode");
    return () => {
      globalThis.document.body.classList.remove("resume-print-mode");
    };
  }, []);

  return (
    <div className={cn("resume-paper-frame mx-auto w-full max-w-[52rem]", className)}>
      <ResumeDocument
        document={resumeDocument}
        template={template}
        testId={testId}
        className="resume-paper"
      />

      <div className="no-print mt-3 flex flex-col gap-1.5 px-1 text-xs leading-relaxed text-muted">
        {resumeDocument.hiddenForLength > 0 ? (
          <p data-testid="resume-hidden-count">
            {resumeDocument.hiddenForLength} more line
            {resumeDocument.hiddenForLength === 1 ? "" : "s"} hidden by the{" "}
            {length === "one_page" ? "one-page" : "two-page"} setting. Choose
            “Two pages” to see everything.
          </p>
        ) : null}
        {resumeDocument.unconfirmed > 0 ? (
          <p data-testid="resume-unconfirmed-count">
            {resumeDocument.unconfirmed} line
            {resumeDocument.unconfirmed === 1 ? "" : "s"} still need confirmation in
            the workspace. They are shown as written; nothing is invented.
          </p>
        ) : null}
        {resumeDocument.removed > 0 ? (
          <p data-testid="resume-removed-count">
            {resumeDocument.removed} line
            {resumeDocument.removed === 1 ? "" : "s"} cite deleted sources and are
            omitted from the document.
          </p>
        ) : null}
        {resumeDocument.empty ? (
          <p data-testid="resume-empty-note">
            Nothing is visible in this preview. Add workspace items or re-enable
            a hidden section.
          </p>
        ) : null}
      </div>
    </div>
  );
}
