import type { WorkspaceItem } from "@/lib/schemas";

/**
 * Mock fixtures (PRD §8.5). F0 ships the shape with one sample item per
 * persona; full workspaces (fresher + mid-level) and 3 sample JDs land in F4.
 * All fixture claims model evidence states — nothing here is fabricated as
 * verified unless it carries supporting evidence (PRD hard rule).
 */
export const fixtureWorkspaceVersion = 1;

export const fixtureItems: WorkspaceItem[] = [
  {
    id: "ws-item-ada-edu",
    section: "education",
    title: "B.Sc. Computer Science",
    organization: "Example State University",
    startDate: "2022-09",
    endDate: "2026-06",
    location: "Example City",
    bullets: ["Relevant coursework: data structures, databases, web development."],
    tags: ["databases", "web"],
    links: [],
    attachments: [],
    evidence: "attested",
    order: 0,
  },
  {
    id: "ws-item-ada-proj",
    section: "project",
    title: "Campus event tracker",
    organization: "Course project",
    startDate: "2025-01",
    endDate: "2025-04",
    bullets: ["Built a single-page event tracker used by two student clubs."],
    tags: ["typescript", "react"],
    links: [],
    attachments: [],
    evidence: "related",
    order: 1,
  },
];
