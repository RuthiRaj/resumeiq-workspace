import { PlaceholderPage } from "@/components/placeholder-page";

// The parent app layout resolves the mock session on the client, so this
// segment cannot produce a static shell at navigation time (ADR-014).
export const instant = false;

export default function ResumePage() {
  return (
    <PlaceholderPage
      title="Standard resume"
      milestone="Coming in F5"
      description="Your standard resume is generated from the workspace and stays synchronized as you change it — it is the one place your career information lives, so wording is edited there, never invented here."
      capabilities={[
        "A live preview that updates whenever you add, edit, delete or reorder a workspace item",
        "A “Synced” indicator with the last sync time, so you can see it is current",
        "Template, length, section order and visibility controls",
        "A clear separation between your current standard resume and saved application versions",
        "Clean, ATS-safe PDF export",
      ]}
    />
  );
}
