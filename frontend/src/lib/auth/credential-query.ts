/**
 * Credential-looking query / hash parameters.
 *
 * Auth screens must never render, prefill or forward a secret from a URL.
 * The matcher is deliberately broad: a false positive only drops a query
 * parameter, while a false negative leaks a password into the address bar,
 * browser history, logs and shared links.
 *
 * The marker used by the server redirect (`notice=credentials`) is outside
 * this matcher on purpose.
 */
const CREDENTIAL_KEY_PATTERN =
  /pass(word|wd|phrase)?|pwd|secret|token|credential|api[-_]?key|jwt|otp|session|(^|[_-])code($|[_-])|(^|[_-])e-?mail($|[_-])/i;

export const CREDENTIAL_IN_URL_NOTICE =
  "Never put your password in a link. Change it if you typed it into the address bar.";

export function isCredentialQueryKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key);
}

export interface CredentialQueryResult {
  /** Path + search + hash with credential-looking parameters removed. */
  url: string;
  /** Keys that were removed. Values are never returned, logged or stored. */
  removed: string[];
}

function stripParams(params: URLSearchParams, removed: string[]) {
  for (const key of Array.from(params.keys())) {
    if (!isCredentialQueryKey(key)) continue;
    params.delete(key);
    removed.push(key);
  }
}

/**
 * Remove credential-looking parameters from a URL. Works for absolute URLs,
 * app-relative paths and bare query strings. The returned URL is always
 * app-relative, which is what `history.replaceState` and redirects expect.
 */
export function stripCredentialQuery(
  input: string,
  base = "http://localhost",
): CredentialQueryResult {
  const parsed = new URL(input, base);
  const removed: string[] = [];

  stripParams(parsed.searchParams, removed);

  // Supabase-style implicit flows put tokens in the fragment. Strip those too;
  // a fragment never reaches the server but still lands in history and shares.
  if (parsed.hash.length > 1) {
    const hashParams = new URLSearchParams(parsed.hash.slice(1));
    stripParams(hashParams, removed);
    const hash = hashParams.toString();
    parsed.hash = hash ? `#${hash}` : "";
  }

  return { url: `${parsed.pathname}${parsed.search}${parsed.hash}`, removed };
}
