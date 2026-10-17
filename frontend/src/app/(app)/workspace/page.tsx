import { WorkspaceDashboard } from "@/features/workspace/workspace-dashboard";

/**
 * `/workspace` dashboard (PRD §7.5). Client-rendered against the mock API.
 *
 * `instant = false` opts this segment out of Cache Components'
 * instant-navigation validation: the server shell is a placeholder for a
 * client-rendered dashboard, so the segment cannot render meaningfully at
 * navigation time (Next 16 `dist/docs`, instant-navigation guide → Opting out).
 * Otherwise the dev overlay flags it on every load.
 */
export const instant = false;

export default function WorkspacePage() {
  return <WorkspaceDashboard />;
}
