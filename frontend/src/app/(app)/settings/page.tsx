import { SettingsContent } from "./settings-content";

// The parent app layout resolves the mock session on the client, so this
// segment cannot produce a static shell at navigation time (ADR-014).
export const instant = false;

export default function SettingsPage() {
  return <SettingsContent />;
}
