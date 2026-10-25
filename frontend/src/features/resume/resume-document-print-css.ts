/**
 * The sheet rules for a standalone `ResumeDocument` print page.
 *
 * The app's screen preview uses the same box metrics from `globals.css`; this
 * string exists because the PDF route renders the component without the app
 * shell. Keep the two in sync when the A4 sheet changes.
 */
export const RESUME_DOCUMENT_PRINT_CSS = `
  @page {
    size: A4;
    margin: 0;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .resume-document {
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    padding: 14mm 16mm;
    border: 0;
    border-radius: 0;
    background: #fff;
    color: #000;
    box-shadow: none;
  }

  .resume-document-entry,
  .resume-document-section {
    break-inside: avoid;
  }

  .resume-document h1,
  .resume-document h2 {
    break-after: avoid;
  }
`;
