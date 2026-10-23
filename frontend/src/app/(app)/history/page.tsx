import { ResumeHistoryPage } from "@/features/resume/resume-history";

// The parent app layout resolves the mock session on the client, so this
// segment cannot produce a static shell at navigation time (ADR-014).
export const instant = false;

export default function HistoryPage() {
  return <ResumeHistoryPage />;
}
