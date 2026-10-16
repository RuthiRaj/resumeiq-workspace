import { z } from "zod";

/**
 * AI-processing consent (PRD §6.9 EX-3). Recorded before any future AI
 * feature runs; disclosed provider is informational until B3 picks one.
 */
export const AI_PROVIDER_DISCLOSURE =
  "Mock AI provider (development only). No content leaves your browser yet — " +
  "the real provider will be disclosed here before the first AI call.";

export const ConsentSchema = z.object({
  aiProcessing: z.boolean(),
  provider: z.string().min(1),
  recordedAt: z.string().min(1),
  /** Schema version so future consent text changes can re-prompt. */
  version: z.literal(1),
});
export type Consent = z.infer<typeof ConsentSchema>;

export const CURRENT_CONSENT_VERSION = 1 as const;

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CONSENT_KEY = "riq.consent";

export function loadConsent(storage: KeyValueStorage): Consent | null {
  try {
    const raw = storage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = ConsentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveConsent(
  storage: KeyValueStorage,
  input: { aiProcessing: boolean; provider?: string; recordedAt: string },
): Consent {
  const consent = ConsentSchema.parse({
    aiProcessing: input.aiProcessing,
    provider: input.provider ?? AI_PROVIDER_DISCLOSURE,
    recordedAt: input.recordedAt,
    version: CURRENT_CONSENT_VERSION,
  });
  storage.setItem(CONSENT_KEY, JSON.stringify(consent));
  return consent;
}

export function clearConsent(storage: KeyValueStorage): void {
  storage.removeItem(CONSENT_KEY);
}

/** Consent is granted only when explicitly recorded as granted. */
export function hasGrantedConsent(consent: Consent | null): boolean {
  return consent?.aiProcessing === true;
}
