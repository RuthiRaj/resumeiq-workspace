/**
 * Bearer-token bridge between the live auth client and the API client.
 *
 * The API client is not a React component, so it cannot read the auth context.
 * In live mode it asks this module, which lazily loads the Supabase adapter.
 * The adapter itself is a dynamic import: mock mode and the marketing bundle
 * never pull `@supabase/supabase-js`.
 *
 * Tests can inject a provider with `setAccessTokenProvider` and never touch
 * Supabase.
 */

type TokenProvider = () => Promise<string | null>;

let provider: TokenProvider | null = null;

/** Test/dev seam. Passing `null` restores the live default. */
export function setAccessTokenProvider(next: TokenProvider | null): void {
  provider = next;
}

export async function accessToken(): Promise<string | null> {
  if (provider) return provider();
  const { getLiveAccessToken } = await import("@/lib/auth/supabase");
  return getLiveAccessToken();
}
