import { TargetAnalysis } from "@/features/targets/target-analysis";

/**
 * `/targets/[id]` — consent gate → analysis theatre → full report (PRD §6.4–6.7,
 * §7.4.4). `instant = false` opts out of instant-navigation validation: the page
 * is a client component with no meaningful server shell (Next 16 `dist/docs`,
 * instant-navigation guide → Opting out).
 */
export const instant = false;

export default async function TargetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TargetAnalysis targetId={id} />;
}
