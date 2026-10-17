import { TargetsList } from "@/features/targets/targets-list";

/** `/targets` (PRD §6.4). Client-rendered list of saved job targets. */
export const instant = false;

export default function TargetsPage() {
  return <TargetsList />;
}
