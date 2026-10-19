import { PlaceholderPage } from "@/components/placeholder-page";

// The parent app layout resolves the mock session on the client, so this
// segment cannot produce a static shell at navigation time (ADR-014).
export const instant = false;

export default function HistoryPage() {
  return (
    <PlaceholderPage
      title="History"
      milestone="Coming in F5"
      description="Saved tailored resumes are snapshots of the workspace at the moment you generated them. This page will let you keep, compare and prune those versions."
      capabilities={[
        "Your current standard resume versus every saved tailored version",
        "A “Stale” badge and a per-section diff when the workspace has changed since a version was saved",
        "A warning when a saved version contains information you have since removed",
        "One-click restore of an older version and one-click purge of a saved version",
      ]}
    />
  );
}
