/** FAQ copy (server-safe): headings and answers SSR as static HTML. */
export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "What is the workspace?",
    a: "Your private Master Workspace holds everything you can truthfully claim — education, skills, projects, internships, experience, achievements, certificates and more. You maintain it once; every resume is generated from it, so nothing drifts out of sync.",
  },
  {
    q: "How do resumes stay synced?",
    a: "Your standard resume regenerates automatically whenever you add, edit, delete or reorder workspace items, with a visible Synced indicator. Tailored resumes are snapshots: when the workspace changes they are marked Stale with a per-section diff, and your edits are never overwritten without your choice.",
  },
  {
    q: "What does the match score mean?",
    a: "A transparent weighted score (required skills 40%, preferred 15%, experience 20%, education 10%, projects 15%) showing how your evidenced background lines up with a job description. It is not a probability of being hired — the full factor breakdown is always shown.",
  },
  {
    q: "What does the ATS score mean?",
    a: "A deterministic readability check: standard headings, single-column layout, keyword coverage, consistent dates and titles, plus a text-extraction round trip on the exported file. It is based on defined checks, not a guarantee for any employer's ATS.",
  },
  {
    q: "How does AI use my data?",
    a: "AI only reads the text needed for the task — extraction, requirement parsing, section writing — after your explicit consent, and personal contact details are stripped before anything is sent. Scores and ATS checks run deterministically, without any model. Full provider disclosure lives in the privacy centre.",
  },
];
