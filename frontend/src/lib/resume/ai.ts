import type { Consent } from "@/lib/privacy/consent";

/**
 * AI rewording availability (PRD §6.9 EX-3, B5 §6.7).
 *
 * Generation is deterministic and never needs AI. Rewording is optional and
 * only enabled when both gates pass:
 *  1. the user has recorded AI-processing consent;
 *  2. the server reports `ai.resumeRewording` through `GET /capabilities`.
 *
 * The capability read replaced the old build-time
 * `NEXT_PUBLIC_AI_REWORDING_CONFIGURED` flag once B6 merged the endpoint. A
 * missing or failed read is treated as "not configured", never as "yes".
 * See docs/DECISIONS.md ADR-044 and docs/api/f5-resume-contract-gaps.md.
 */

export interface AiRewordAvailability {
  enabled: boolean;
  consentGranted: boolean;
  providerConfigured: boolean;
  reason: string;
}

export function aiRewordAvailability(
  consent: Consent | null | undefined,
  providerConfigured: boolean,
): AiRewordAvailability {
  const consentGranted = Boolean(consent?.aiProcessing);
  if (!providerConfigured) {
    return {
      enabled: false,
      consentGranted,
      providerConfigured,
      reason:
        "AI rewording is off because this server has no AI provider configured. Your resume is generated deterministically without it.",
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
