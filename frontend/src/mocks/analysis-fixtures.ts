import type { JobTarget, ResumeTemplate, TargetLength } from "@/lib/schemas";

/**
 * Demo job postings (PRD §8.5 fixtures, F4 item 5). Three sample targets are
 * written against the seeded workspaces so every report state is reachable:
 *
 *  - `strong`  — a senior frontend role the mid-level developer matches.
 *  - `partial` — a full-stack role with more unknowns than matches.
 *  - `poor`    — a machine-learning role the web developer does not match.
 *
 * These are *job descriptions*, not claims about the user: the postings are
 * invented sample content and every report assertion about the user comes from
 * their own workspace items. `expectation` records what each posting is meant
 * to demonstrate, and `analysis-fixtures.test.ts` asserts the three produce
 * distinct, ordered scores so a fixture can never silently rot.
 */

export type FixtureId = "strong" | "partial" | "poor";

export interface JobDescriptionFixture {
  id: FixtureId;
  /** Short label for the "load a sample posting" control. */
  label: string;
  /** What this posting is meant to demonstrate. */
  description: string;
  role: string;
  company: string;
  template: ResumeTemplate;
  length: TargetLength;
  requiredSkills: string[];
  jobDescription: string;
}

export const JOB_DESCRIPTION_FIXTURES: JobDescriptionFixture[] = [
  {
    id: "strong",
    label: "Senior Frontend Engineer (strong match)",
    description:
      "Every requirement in this posting is already evidenced in the mid-level workspace, so the report should read mostly Matched.",
    role: "Senior Frontend Engineer",
    company: "Halcyon Systems",
    template: "precision",
    length: "one_page",
    requiredSkills: ["TypeScript", "React"],
    jobDescription: [
      "Senior Frontend Engineer — Halcyon Systems",
      "",
      "Responsibilities",
      "• Build and maintain our customer dashboard in TypeScript and React.",
      "• Work with our PostgreSQL data layer and keep the queries fast.",
      "• Write integration tests for the flows you ship.",
      "",
      "Requirements",
      "• 3+ years of professional frontend experience.",
      "• Strong TypeScript and React skills.",
      "• Comfortable with PostgreSQL and SQL.",
      "• Bachelor's degree in Computer Science or a related field.",
    ].join("\n"),
  },
  {
    id: "partial",
    label: "Full-Stack Engineer (partial match)",
    description:
      "A mix of matches, weakly-evidenced mentions and genuine gaps, so the report should show all three requirement states plus both gap types.",
    role: "Full-Stack Engineer",
    company: "Blue Harbour Retail",
    template: "classic",
    length: "two_page",
    requiredSkills: ["TypeScript", "React", "PostgreSQL"],
    jobDescription: [
      "Full-Stack Engineer — Blue Harbour Retail",
      "",
      "Responsibilities",
      "• Ship features across a React and Node.js codebase.",
      "• Design and consume GraphQL APIs.",
      "• Package services with Docker and deploy them to Kubernetes.",
      "• Improve the observability and performance of the order pipeline.",
      "",
      "Requirements",
      "• 5+ years of software engineering experience.",
      "• Strong TypeScript, React and PostgreSQL skills.",
      "• Cloud experience, for example AWS or Google Cloud.",
      "• Nice to have: Kafka or another event streaming platform.",
    ].join("\n"),
  },
  {
    id: "poor",
    label: "Machine Learning Engineer (poor match)",
    description:
      "Almost nothing in the web-developer workspace answers this posting, so the report should be dominated by Unsupported with Genuinely missing gaps.",
    role: "Machine Learning Engineer",
    company: "Northwind Analytics",
    template: "compact",
    length: "two_page",
    requiredSkills: ["Python", "PyTorch"],
    jobDescription: [
      "Machine Learning Engineer — Northwind Analytics",
      "",
      "What you will do",
      "• Train and evaluate deep learning models in PyTorch.",
      "• Build data pipelines with pandas and NumPy.",
      "• Apply statistics to experiment design.",
      "• Own model deployment on Kubernetes with Docker.",
      "",
      "Requirements",
      "• 4+ years building machine learning systems in Python.",
      "• Experience with NLP and transformer models.",
      "• Master's degree or PhD in a quantitative field.",
    ].join("\n"),
  },
];

export function jobDescriptionFixture(id: FixtureId): JobDescriptionFixture {
  const fixture = JOB_DESCRIPTION_FIXTURES.find((entry) => entry.id === id);
  if (!fixture) throw new Error(`Unknown job description fixture: ${id}`);
  return fixture;
}

/**
 * Builds the three sample targets (dev-only helper, see
 * `POST /api/v1/targets/samples`). Timestamps are fixed so the generated
 * reports are identical for identical inputs (PRD §6.4 JD-5).
 */
export function sampleTargets(now: Date = new Date()): JobTarget[] {
  const createdAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0),
  ).toISOString();
  return JOB_DESCRIPTION_FIXTURES.map((fixture, index) => ({
    id: `sample-target-${fixture.id}`,
    role: fixture.role,
    company: fixture.company,
    jobDescription: fixture.jobDescription,
    requiredSkills: fixture.requiredSkills,
    template: fixture.template,
    length: fixture.length,
    status: "draft" as const,
    analysis: null,
    sample: true,
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + index * 1000).toISOString(),
  }));
}
