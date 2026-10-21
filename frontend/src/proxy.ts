import { NextResponse, type NextRequest } from "next/server";
import { stripCredentialQuery } from "@/lib/auth/credential-query";

/**
 * Server-side credential scrubber for the auth screens.
 *
 * The RSC payload of the first response serialises the request URL, so a
 * client-only `history.replaceState` cannot keep `?password=…` out of the
 * rendered document. Redirecting before the route renders means the secret is
 * never part of the HTML, the flight data or the DOM.
 *
 * `notice=credentials` is a safe marker (it is not matched by the scrubber) so
 * the client can explain what happened after the redirect.
 */
export function proxy(request: NextRequest) {
  const { url, removed } = stripCredentialQuery(request.url);
  if (removed.length === 0) return NextResponse.next();

  const target = new URL(url, request.url);
  target.searchParams.set("notice", "credentials");
  // 303 turns a no-JavaScript POST fallback into a GET, so a request body that
  // ever held credentials is not replayed to another URL.
  return NextResponse.redirect(target, 303);
}

export const config = {
  matcher: ["/signin", "/signup", "/forgot-password", "/reset-password"],
};
