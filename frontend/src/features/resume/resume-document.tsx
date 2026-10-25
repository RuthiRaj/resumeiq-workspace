import type { CSSProperties } from "react";
import type { ResumeTemplate } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import type { ResumeDocumentModel } from "./resume-document-model";

/**
 * One ATS-safe document used by the screen preview, the print-only portal and
 * (mirrored in Python) the server PDF. The app's dark UI stops at the white
 * page: no cards, glow, counters or product copy live inside this component.
 */

// One ATS-safe family per document. The templates only change metrics, not the
// typeface, so the printed text stays consistent across Precision/Classic/Compact.
const ATS_FONT = 'Arial, Calibri, "Liberation Sans", Helvetica, sans-serif';

const FONT_STACKS: Record<ResumeTemplate, string> = {
  precision: ATS_FONT,
  classic: ATS_FONT,
  compact: ATS_FONT,
};

interface TemplateMetrics {
  bodySize: string;
  lineHeight: number;
  nameSize: string;
  contactSize: string;
  headingSize: string;
  entrySize: string;
  sectionGap: string;
  entryGap: string;
  bulletGap: string;
}

const TEMPLATE_METRICS: Record<ResumeTemplate, TemplateMetrics> = {
  precision: {
    bodySize: "10.5pt",
    lineHeight: 1.35,
    nameSize: "20pt",
    contactSize: "9.5pt",
    headingSize: "10pt",
    entrySize: "10.5pt",
    sectionGap: "4.5mm",
    entryGap: "2.6mm",
    bulletGap: "0.8mm",
  },
  classic: {
    bodySize: "10.5pt",
    lineHeight: 1.3,
    nameSize: "20pt",
    contactSize: "9.5pt",
    headingSize: "10pt",
    entrySize: "10.5pt",
    sectionGap: "4.2mm",
    entryGap: "2.4mm",
    bulletGap: "0.8mm",
  },
  compact: {
    bodySize: "9.75pt",
    lineHeight: 1.22,
    nameSize: "18pt",
    contactSize: "9pt",
    headingSize: "9.5pt",
    entrySize: "9.75pt",
    sectionGap: "3.2mm",
    entryGap: "1.9mm",
    bulletGap: "0.5mm",
  },
};

export function ResumeDocument({
  document,
  template,
  className,
  testId,
}: {
  document: ResumeDocumentModel;
  template: ResumeTemplate;
  className?: string;
  testId?: string;
}) {
  const metrics = TEMPLATE_METRICS[template];
  const pageStyle: CSSProperties = {
    fontFamily: FONT_STACKS[template],
    fontSize: metrics.bodySize,
    lineHeight: metrics.lineHeight,
    color: "#000",
    background: "#fff",
  };

  return (
    <article
      className={cn("resume-document", className)}
      style={pageStyle}
      aria-label="Resume document"
      data-testid={testId}
    >
      {document.name || document.contact ? (
        <header className="resume-document-header">
          {document.name ? (
            <h1
              style={{
                margin: 0,
                fontSize: metrics.nameSize,
                lineHeight: 1.15,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {document.name}
            </h1>
          ) : null}
          {document.contact ? (
            <p
              style={{
                margin: "2mm 0 0",
                fontSize: metrics.contactSize,
                lineHeight: 1.35,
              }}
            >
              {document.contact}
            </p>
          ) : null}
          <div
            aria-hidden="true"
            style={{
              borderBottom: "0.6pt solid #000",
              marginTop: "3mm",
            }}
          />
        </header>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: metrics.sectionGap,
          marginTop: document.name || document.contact ? "4mm" : 0,
        }}
      >
        {document.sections.map((section) => (
          <section
            key={section.key}
            aria-label={section.label}
            className="resume-document-section"
          >
            <h2
              style={{
                margin: 0,
                paddingBottom: "1mm",
                borderBottom: "0.5pt solid #000",
                fontSize: metrics.headingSize,
                lineHeight: 1.2,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {section.label}
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: metrics.entryGap,
                marginTop: "2mm",
              }}
            >
              {section.entries.map((entry, index) => {
                if (section.key === "skill" || section.key === "summary") {
                  return (
                    <p
                      key={`${section.key}-${index}-${entry.title}`}
                      style={{
                        margin: 0,
                        fontSize: metrics.bodySize,
                        lineHeight: metrics.lineHeight,
                      }}
                    >
                      {entry.title}
                    </p>
                  );
                }

                if (entry.listItem) {
                  return (
                    <ul
                      key={`${section.key}-${index}-${entry.title}`}
                      style={{
                        margin: 0,
                        paddingLeft: "4.5mm",
                        listStyleType: "disc",
                        listStylePosition: "outside",
                      }}
                    >
                      <li
                        style={{
                          fontSize: metrics.bodySize,
                          lineHeight: metrics.lineHeight,
                          marginBottom: metrics.bulletGap,
                        }}
                      >
                        {entry.title}
                      </li>
                    </ul>
                  );
                }

                return (
                  <div
                    key={`${section.key}-${index}-${entry.title}`}
                    className="resume-document-entry"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: "6mm",
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          minWidth: 0,
                          fontSize: metrics.entrySize,
                          lineHeight: 1.25,
                        }}
                      >
                        <strong style={{ fontWeight: 700 }}>{entry.title}</strong>
                        {entry.organization ? (
                          <span style={{ fontWeight: 400 }}>
                            {" "}
                            — {entry.organization}
                          </span>
                        ) : null}
                      </p>
                      {entry.dates ? (
                        <p
                          style={{
                            margin: 0,
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                            fontSize: metrics.entrySize,
                            lineHeight: 1.25,
                          }}
                        >
                          {entry.dates}
                        </p>
                      ) : null}
                    </div>
                    {entry.bullets.length > 0 ? (
                      <ul
                        style={{
                          margin: "1mm 0 0",
                          paddingLeft: "4.5mm",
                          listStyleType: "disc",
                          listStylePosition: "outside",
                        }}
                      >
                        {entry.bullets.map((bullet, bulletIndex) => (
                          <li
                            key={`${bullet}-${bulletIndex}`}
                            style={{
                              fontSize: metrics.bodySize,
                              lineHeight: metrics.lineHeight,
                              marginBottom: metrics.bulletGap,
                            }}
                          >
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
