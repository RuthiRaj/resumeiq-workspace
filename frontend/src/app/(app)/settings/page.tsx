import { PlaceholderPage } from "@/components/placeholder-page";

// The parent app layout resolves the mock session on the client, so this
// segment cannot produce a static shell at navigation time (ADR-014).
export const instant = false;

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      milestone="Coming in F6"
      description="Account and preference controls for the signed-in user. Nothing here is built yet."
      capabilities={[
        "Your profile: name, email and an optional display photo",
        "Resume preferences: default template, length and section order",
        "Security: change password and review signed-in sessions",
        "Notifications and accessibility preferences, including reduced motion",
      ]}
    />
  );
}
