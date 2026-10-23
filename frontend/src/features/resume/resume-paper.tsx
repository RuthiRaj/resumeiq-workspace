import { Badge } from "@/components/ui/badge";
import type { Claim, Resume, ResumeTemplate, TargetLength } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { orderedSectionKeys, sectionLabel } from "./resume-preferences";

const CLAIM_LIMIT: Record<TargetLength, number> = {
  one_page: 32,
  two_page: 56,
};

function looksLikeHeader(claim: Claim): boolean {
  return claim.text.includes(" · ");
}

function templateClass(template: ResumeTemplate): string {
  if (template === "classic") return "font-serif tracking-[0.005em]";
  if (template === "compact") return "text-[13px] leading-snug";
  return "font-sans";
}

/**
 * Read-only resume sheet used by the live standard-resume preview. It is a
 * white, print-first page; the surrounding app stays dark. Screen-only markers
 * flag lines that still need confirmation, while print shows the resume alone.
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
  const keys = orderedSectionKeys(resume, order).filter(
    (key) => !hidden.includes(key),
  );
  const byKey = new Map(resume.sections.map((section) => [section.key, section]));
  const personal = byKey.get("personal");
  const otherKeys = keys.filter((key) => key !== "personal");

  const initialSeen = personal?.claims.length ?? 0;
  const { rendered, hiddenForLength } = otherKeys.reduce(
    (accumulator, key) => {
      const claims = byKey.get(key)?.claims ?? [];
      const room = Math.max(0, CLAIM_LIMIT[length] - accumulator.seen);
      const visible = claims.slice(0, room);
      accumulator.rendered.push({ key, claims: visible });
      accumulator.hiddenForLength += Math.max(0, claims.length - visible.length);
      accumulator.seen += visible.length;
      return accumulator;
    },
    {
      rendered: [] as { key: string; claims: Claim[] }[],
      hiddenForLength: 0,
      seen: initialSeen,
    },
  );

  return (
    <div
      className={cn(
        "resume-paper mx-auto w-full max-w-[52rem] rounded-sm bg-white p-6 text-neutral-900 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-10 print:max-w-none print:p-0 print:shadow-none",
        templateClass(template),
        className,
      )}
      data-testid={testId}
    >
      <article aria-label="Resume preview">
        {personal && personal.claims.length > 0 ? (
          <header className="border-b border-neutral-300 pb-4">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {personal.claims[0]?.text}
            </h1>
            {personal.claims.slice(1).map((claim, index) => (
              <p
                key={`${claim.text}-${index}`}
                className="mt-1 text-sm leading-relaxed text-neutral-700"
              >
                {claim.text}
                {!claim.confirmed ? (
                  <Badge variant="missing" className="no-print ml-2 align-middle">
                    Needs confirmation
                  </Badge>
                ) : null}
              </p>
            ))}
          </header>
        ) : (
          <header className="border-b border-neutral-300 pb-4">
            <h1 className="text-2xl font-semibold tracking-tight">
              Your resume
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Add a personal-details item to show your name here.
            </p>
          </header>
        )}

        <div className={cn("mt-5 flex flex-col", template === "compact" ? "gap-3" : "gap-5")}>
          {rendered.map(({ key, claims }) =>
            claims.length === 0 ? null : (
              <section key={key} aria-labelledby={`resume-section-${key}`}>
                <h2
                  id={`resume-section-${key}`}
                  className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500"
                >
                  {sectionLabel(key)}
                </h2>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {claims.map((claim, index) => {
                    const header = looksLikeHeader(claim);
                    return (
                      <li
                        key={`${claim.text}-${index}`}
                        className={cn(
                          "text-sm leading-relaxed",
                          header
                            ? "font-medium text-neutral-900"
                            : "flex gap-2 text-neutral-700",
                        )}
                      >
                        {header ? null : (
                          <span aria-hidden="true" className="text-neutral-400">
                            •
                          </span>
                        )}
                        <span>
                          {claim.text}
                          {!claim.confirmed ? (
                            <Badge
                              variant="missing"
                              className="no-print ml-2 align-middle"
                            >
                              Needs confirmation
                            </Badge>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
          )}
        </div>

        {rendered.every((section) => section.claims.length === 0) &&
        (!personal || personal.claims.length === 0) ? (
          <p className="mt-8 text-sm text-neutral-600">
            Nothing is visible in this preview. Add workspace items or re-enable
            a hidden section.
          </p>
        ) : null}
      </article>

      {hiddenForLength > 0 ? (
        <p className="no-print mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
          {hiddenForLength} more line{hiddenForLength === 1 ? "" : "s"} hidden by
          the {length === "one_page" ? "one-page" : "two-page"} setting. Choose
          “Two pages” to see everything.
        </p>
      ) : null}
    </div>
  );
}
