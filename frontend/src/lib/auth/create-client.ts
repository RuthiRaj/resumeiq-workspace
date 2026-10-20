import { isLiveMode } from "@/lib/config/mode";
import { createMockAuthClient } from "./client";
import { createSupabaseAuthClient } from "./supabase";
import type { AuthClient } from "./types";

/**
 * Auth transport for the current deployment mode. The mock stays the default;
 * live mode swaps in Supabase Auth without touching a single screen.
 */
export function createAuthClient(): AuthClient {
  return isLiveMode() ? createSupabaseAuthClient() : createMockAuthClient();
}
