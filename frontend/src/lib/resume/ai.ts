import type { Consent } from "@/lib/privacy/consent";
import type { AiCapabilities } from "@/lib/schemas";

/**
 * AI rewording availability (PRD §6.9 EX-3, B5 §6.7).
 *
 * Generation is deterministic and never needs AI. Rewording is optional and
 * only enabled when both gates pass:
 *  1. the user has recorded AI-processing consent;
 *  2. `GET /capabilities` says the server has AI and `resumeRewording` on.
 *
 * Capabilities are the source of truth (`NEXT_PUBLIC_AI_REWORDING_CONFIGURED`
 * is gone). While the call is loading, or if it fails, `capabilities` is null
 * and the safe answer is "AI unavailable" — never an optimistic guess.
 * See docs/DECISIONS.md ADR-046.
 */

export interface AiRewordAvailability {
  enabled: boolean;
  consentGranted: boolean;
  providerConfigured: boolean;
  reason: string;
}

export function aiRewordAvailability(
  consent: Consent | null | undefined,
  capabilities: AiCapabilities | null | undefined,
): AiRewordAvailability {
  const consentGranted = Boolean(consent?.aiProcessing);
  const providerConfigured = Boolean(
    capabilities?.configured && capabilities.resumeRewording,
  );
  if (!capabilities) {
    return {
      enabled: false,
      consentGranted,
      providerConfigured: false,
      reason:
        "AI availability couldn't be confirmed, so AI rewording is off. Your resume is generated deterministically without it.",
    };
  }
  if (!capabilities.configured) {
    return {
      enabled: false,
      consentGranted,
      providerConfigured: false,
      reason:
        "AI rewording is off because no AI provider is configured on the server. Your resume is generated deterministically without it.",
    };
  }
  if (!capabilities.resumeRewording) {
    return {
      enabled: false,
      consentGranted,
      providerConfigured: false,
      reason:
        "This server supports AI analysis but not AI rewording. Your resume is generated deterministically without it.",
    };
  }
  if (!consentGranted) {
    return {
      enabled: false,
      consentGranted,
      providerConfigured,
      reason:
        "AI rewording needs recorded AI-processing consent. Record it in Privacy settings, or keep the deterministic wording.",
    };
  }
  return {
    enabled: true,
    consentGranted,
    providerConfigured,
    reason:
      "Only bullet lines are sent to the provider, one at a time, with the cited workspace item as evidence. A rewrite that adds a fact is discarded.",
  };
}

/**
 * Mock provider: a tiny, fact-preserving presentation change. It never adds a
 * technology, metric, employer, title or date, and the caller re-validates the
 * result with the grounding checker exactly like the live path.
 */
export function simulateMockReword(text: string): string | null {
  const original = text.trim();
  let candidate = original
    .replace(/\s+/g, " ")
    .replace(/\bthat renders\b/gi, "rendering")
    .replace(/\bin order to\b/gi, "to");
  if (candidate === original) return null;
  candidate = candidate.charAt(0).toUpperCase() + candidate.slice(1);
  return candidate === original ? null : candidate;
}
