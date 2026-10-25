import { describe, expect, it } from "vitest";
import type { Claim, ResumeSection } from "@/lib/schemas";
import {
  DEFAULT_DOCUMENT_ORDER,
  buildResumeDocument,
  documentControlSections,
  formatDateRange,
  parseResumeHeader,
} from "./resume-document-model";

function claim(
  text: string,
  evidenceIds: string[] = ["item-1"],
  overrides: Partial<Claim> = {},
): Claim {
  return {
    text,
    evidenceIds,
    confirmed: true,
    aiRewritten: false,
    removed: false,
    ...overrides,
  };
}

function section(key: string, claims: Claim[]): ResumeSection {
  return { key, claims };
}

const sections: ResumeSection[] = [
  section("personal", [
    claim("Ravi Menon · ravi@example.com | Example City | https://example.com/ravi"),
  ]),
  section("experience", [
    claim("Software Engineer · Northwind Labs · 2023-02", ["exp-1"]),
    claim("Cut p95 latency from 480ms to 120ms.", ["exp-1"]),
  ]),
  section("education", [
    claim("B.Sc. Computer Science · Example University · 2018-09 – 2021-06", [
      "edu-1",
    ]),
  ]),
  section("skill", [claim("TypeScript", ["skill-1"]), claim("PostgreSQL", ["skill-2"])]),
];

describe("resume document model", () => {
  it("formats month-year ranges consistently", () => {
    expect(formatDateRange("2021-01 – 2024-01")).toBe("Jan 2021 – Jan 2024");
    expect(formatDateRange("2023-02 - Present")).toBe("Feb 2023 – Present");
  });

  it("parses title, organisation and right-aligned dates", () => {
    expect(
      parseResumeHeader("Senior Frontend Engineer · Acme · 2021-01 – 2024-01"),
    ).toEqual({
      title: "Senior Frontend Engineer",
      organization: "Acme",
      dates: "Jan 2021 – Jan 2024",
    });
  });

  it("builds name, one contact line and the canonical section order", () => {
    const document = buildResumeDocument(
      { sections },
      { length: "one_page", order: [...DEFAULT_DOCUMENT_ORDER], hidden: [] },
    );

    expect(document.name).toBe("Ravi Menon");
    expect(document.contact).toBe(
      "ravi@example.com | Example City | https://example.com/ravi",
    );
    expect(document.sections.map((entry) => entry.label)).toEqual([
      "Education",
      "Experience",
      "Skills",
    ]);
    expect(document.sections[1]?.entries[0]).toMatchObject({
      title: "Software Engineer",
      organization: "Northwind Labs",
      dates: "Feb 2023",
      bullets: ["Cut p95 latency from 480ms to 120ms."],
    });
    expect(document.sections[2]?.entries.map((entry) => entry.title)).toEqual([
      "TypeScript, PostgreSQL",
    ]);
  });

  it("merges training into Certifications and lists each control once", () => {
    const resume = {
      sections: [
        ...sections,
        section("training", [
          claim("Advanced React Patterns workshop · Example Workshops · 2024-06", [
            "training-1",
          ]),
        ]),
        section("achievement", [
          claim("Cut latency 75% · Northwind Labs · 2025-05", ["achievement-1"]),
        ]),
        section("extracurricular", [
          claim("Mentored juniors · Example Org · 2024-01", ["extra-1"]),
        ]),
      ],
    };

    const document = buildResumeDocument(resume, {
      length: "one_page",
      order: [...DEFAULT_DOCUMENT_ORDER],
      hidden: [],
    });
    const certifications = document.sections.find(
      (entry) => entry.label === "Certifications",
    );
    expect(certifications?.entries.map((entry) => entry.title)).toContain(
      "Advanced React Patterns workshop",
    );
    expect(
      document.sections.filter((entry) => entry.label === "Training"),
    ).toHaveLength(0);

    const controls = documentControlSections(
      resume,
      [...DEFAULT_DOCUMENT_ORDER],
      [],
    );
    expect(new Set(controls.map((entry) => entry.id)).size).toBe(controls.length);
    expect(
      controls.filter((entry) => entry.label === "Achievements and awards"),
    ).toHaveLength(1);
    expect(controls.find((entry) => entry.id === "certificate")?.sourceKeys).toEqual(
      ["certificate", "training", "course"],
    );
  });

  it("honours hidden sections and custom order without deleting facts", () => {
    const document = buildResumeDocument(
      { sections },
      {
        length: "one_page",
        order: ["experience", "education", "skill"],
        hidden: ["skill"],
      },
    );

    expect(document.sections.map((entry) => entry.label)).toEqual([
      "Experience",
      "Education",
    ]);
    expect(document.sections.flatMap((entry) => entry.entries)).toHaveLength(2);
  });

  it("omits removed claims and counts unconfirmed lines outside the document", () => {
    const document = buildResumeDocument(
      {
        sections: [
          section("personal", [claim("Ravi Menon")]),
          section("experience", [
            claim("Software Engineer · Northwind Labs", ["exp-1"], {
              confirmed: false,
            }),
            claim("Deleted secret project", ["deleted"], { removed: true }),
          ]),
        ],
      },
      { length: "one_page", order: [...DEFAULT_DOCUMENT_ORDER], hidden: [] },
    );

    expect(document.unconfirmed).toBe(1);
    expect(document.removed).toBe(1);
    expect(
      document.sections.flatMap((entry) =>
        entry.entries.flatMap((item) => [item.title, ...item.bullets]),
      ),
    ).not.toContain("Deleted secret project");
  });

  it("counts claims hidden by the one-page setting", () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      claim(`Project ${index} · Example Org · 2020-01`, [`project-${index}`]),
    );
    const document = buildResumeDocument(
      {
        sections: [
          section("personal", [claim("Ravi Menon")]),
          section("project", many),
        ],
      },
      { length: "one_page", order: [...DEFAULT_DOCUMENT_ORDER], hidden: [] },
    );

    expect(document.hiddenForLength).toBeGreaterThan(0);
    expect(document.sections[0]?.entries.length).toBeLessThan(40);
  });
});
