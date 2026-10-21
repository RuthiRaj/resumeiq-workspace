/**
 * Live AI-processing consent (I1).
 *
 * The backend enforces consent by reading `consent_records` with the caller's
 * JWT, but it exposes no consent endpoint yet. The browser therefore writes
 * the same table through the Supabase Data API: RLS restricts every row to the
 * signed-in user, and the publishable key is the only credential involved.
 * See ADR-033.
 *
 * Errors are re-thrown as fresh `Error`s with user-facing copy; Supabase
 * internals (and anything they may echo) never reach the UI or a log.
 */

import { getSupabaseClient } from "@/lib/auth/supabase";
import { withTimeout } from "@/lib/async/with-timeout";
import {
  AI_PROVIDER_DISCLOSURE,
  CURRENT_CONSENT_VERSION,
  type Consent,
} from "./consent";

const PURPOSE = "ai_processing";
const CONSENT_TIMEOUT_MS = 15_000;

interface ConsentRow {
  granted: boolean;
  provider: string | null;
  granted_at: string | null;
}

function toConsent(row: ConsentRow | undefined): Consent | null {
  if (!row || !row.granted) return null;
  return {
    aiProcessing: true,
    provider: row.provider ?? AI_PROVIDER_DISCLOSURE,
    recordedAt: row.granted_at ?? new Date().toISOString(),
    version: CURRENT_CONSENT_VERSION,
  };
}

async function currentUserId(): Promise<string> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sign in again to change consent.");
  return data.user.id;
}

export function getLiveConsent(): Promise<Consent | null> {
  return withTimeout(
    loadLiveConsent(),
    CONSENT_TIMEOUT_MS,
    "Checking your AI-processing consent took too long. Check your connection and try again.",
  );
}

async function loadLiveConsent(): Promise<Consent | null> {
  const supabase = await getSupabaseClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return null;
  const { data, error } = await supabase
    .from("consent_records")
    .select("granted,provider,granted_at")
    .eq("user_id", auth.user.id)
    .eq("purpose", PURPOSE)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error("We couldn't check your AI-processing consent. Try again.");
  }
  return toConsent((data?.[0] as ConsentRow | undefined) ?? undefined);
}

export function recordLiveConsent(aiProcessing: boolean): Promise<Consent> {
  return withTimeout(
    saveLiveConsent(aiProcessing),
    CONSENT_TIMEOUT_MS,
    "Saving your AI-processing consent took too long. Check your connection and try again.",
  );
}

async function saveLiveConsent(aiProcessing: boolean): Promise<Consent> {
  const supabase = await getSupabaseClient();
  const userId = await currentUserId();
  const now = new Date().toISOString();

  if (!aiProcessing) {
    // Revoke every open grant, otherwise a newer "denied" row would simply be
    // outvoted by the older grant the backend can still see.
    const { error: revokeError } = await supabase
      .from("consent_records")
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .eq("purpose", PURPOSE)
      .is("revoked_at", null);
    if (revokeError) throw new Error("We couldn't update your consent. Try again.");
    return {
      aiProcessing: false,
      provider: AI_PROVIDER_DISCLOSURE,
      recordedAt: now,
      version: CURRENT_CONSENT_VERSION,
    };
  }

  const { data, error } = await supabase
    .from("consent_records")
    .insert({
      user_id: userId,
      purpose: PURPOSE,
      provider: AI_PROVIDER_DISCLOSURE,
      granted: true,
      granted_at: now,
      revoked_at: null,
    })
    .select("granted,provider,granted_at")
    .single();
  if (error) throw new Error("We couldn't record your consent. Try again.");
  const consent = toConsent(data as ConsentRow);
  if (!consent) throw new Error("We couldn't record your consent. Try again.");
  return consent;
}
