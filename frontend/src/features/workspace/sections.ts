import {
  Award,
  BookOpen,
  Briefcase,
  Code,
  FileText,
  GraduationCap,
  Medal,
  Presentation,
  Rocket,
  User,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { WORKSPACE_SECTION_ORDER, type WorkspaceSection } from "@/lib/schemas";

/**
 * UI metadata for the workspace sections (PRD §6.1 WS-1). PRD WS-1 lists eleven
 * groups; "certificates and courses" is two schema sections (`certificate`,
 * `course`), so there are 12 routable sections — see ADR-012.
 */
export interface WorkspaceSectionMeta {
  key: WorkspaceSection;
  /** Plural, used for navigation and card headings. */
  label: string;
  /** Singular, used for calls to action ("Add a project"). */
  singular: string;
  description: string;
  emptyHint: string;
  icon: LucideIcon;
}

const META: Record<WorkspaceSection, Omit<WorkspaceSectionMeta, "key">> = {
  personal: {
    label: "Personal details",
    singular: "personal detail",
    description: "Name, contact details and profile links used across every resume.",
    emptyHint: "Add your name and the links you want recruiters to reach you on.",
    icon: User,
  },
  education: {
    label: "Education",
    singular: "education entry",
    description: "Degrees, institutions, dates and relevant coursework.",
    emptyHint: "Add your degree or most recent qualification.",
    icon: GraduationCap,
  },
  experience: {
    label: "Experience",
    singular: "experience",
    description: "Roles you have held, with the responsibilities and results you can defend.",
    emptyHint: "Add a role and one bullet describing what you owned.",
    icon: Briefcase,
  },
  internship: {
    label: "Internships",
    singular: "internship",
    description: "Internships kept separate from full-time experience.",
    emptyHint: "Add an internship with the team and what you worked on.",
    icon: Rocket,
  },
  project: {
    label: "Projects",
    singular: "project",
    description: "Things you built — personal, academic or open source.",
    emptyHint: "Add a project and a link to the code or a live demo.",
    icon: Code,
  },
  skill: {
    label: "Skills",
    singular: "skill",
    description: "Technologies and abilities. Related skills are never treated as equivalent.",
    emptyHint: "Add your strongest technologies first.",
    icon: Wrench,
  },
  achievement: {
    label: "Achievements & awards",
    singular: "achievement",
    description: "Recognitions, awards and measurable results.",
    emptyHint: "Add an award, ranking or result you can evidence.",
    icon: Medal,
  },
  extracurricular: {
    label: "Extracurricular activities",
    singular: "activity",
    description: "Clubs, volunteering, sports and leadership outside work.",
    emptyHint: "Add an activity and the role you played.",
    icon: Users,
  },
  certificate: {
    label: "Certificates",
    singular: "certificate",
    description: "Certifications you have earned. Attach the certificate to mark it verified.",
    emptyHint: "Add a certificate and attach the document to verify it.",
    icon: Award,
  },
  course: {
    label: "Courses",
    singular: "course",
    description: "Courses and structured learning, separate from formal certificates.",
    emptyHint: "Add a course and what it covered.",
    icon: BookOpen,
  },
  publication: {
    label: "Publications",
    singular: "publication",
    description: "Papers, articles and posts you authored.",
    emptyHint: "Add a publication and link to it.",
    icon: FileText,
  },
  training: {
    label: "Training",
    singular: "training",
    description: "Workshops and professional training.",
    emptyHint: "Add a workshop or training programme.",
    icon: Presentation,
  },
};

/** All sections in canonical order. */
export const WORKSPACE_SECTIONS: WorkspaceSectionMeta[] = WORKSPACE_SECTION_ORDER.map(
  (key) => ({ key, ...META[key] }),
);

const BY_KEY = new Map(WORKSPACE_SECTIONS.map((meta) => [meta.key, meta]));

export function sectionMeta(key: WorkspaceSection): WorkspaceSectionMeta {
  const meta = BY_KEY.get(key);
  if (!meta) throw new Error(`Unknown workspace section: ${key}`);
  return meta;
}

export function isWorkspaceSection(value: string): value is WorkspaceSection {
  return BY_KEY.has(value as WorkspaceSection);
}
