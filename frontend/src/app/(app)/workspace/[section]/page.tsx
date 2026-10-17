import { notFound } from "next/navigation";
import { SectionView } from "@/features/workspace/section-view";
import { isWorkspaceSection } from "@/features/workspace/sections";
import { WORKSPACE_SECTION_ORDER } from "@/lib/schemas";

/**
 * `/workspace/[section]` list + editor (PRD §7.5). Params are enumerated with
 * `generateStaticParams` so every section is known at build time (Next 16
 * Cache Components: param access without this would need a Suspense fallback);
 * unknown segments 404 instead of rendering an empty editor.
 *
 * `instant = false` opts the segment out of instant-navigation validation: the
 * editor is a client component with no meaningful server shell (Next 16
 * `dist/docs`, instant-navigation guide → Opting out).
 */
export const instant = false;

export function generateStaticParams() {
  return WORKSPACE_SECTION_ORDER.map((section) => ({ section }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isWorkspaceSection(section)) notFound();
  return <SectionView section={section} />;
}
