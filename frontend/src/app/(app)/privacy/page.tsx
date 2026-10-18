import { PrivacyContent } from "./privacy-content";

/**
 * `/privacy` (PRD §7.5). A server module so the route can carry the `instant`
 * opt-out: the consent card reads the mock session on the client, and `instant`
 * is a route segment config that throws if exported from a Client Component
 * (`(app)/privacy/privacy-content.tsx` holds the client code). See ADR-014.
 */
export const instant = false;

export default function PrivacyPage() {
  return <PrivacyContent />;
}
