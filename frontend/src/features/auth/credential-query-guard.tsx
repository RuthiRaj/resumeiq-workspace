"use client";

import { useEffect, useRef, useState } from "react";
import { CREDENTIAL_IN_URL_NOTICE, stripCredentialQuery } from "@/lib/auth/credential-query";

/**
 * Client-side second line of defence for the auth screens.
 *
 * The server proxy strips credentials before the first render, so this only
 * has work to do for client-side navigations (a router push with a crafted
 * query, a restored history entry, a manually edited URL). It never reads the
 * values into state: it only removes the keys and shows a warning.
 */
export function CredentialQueryGuard() {
  const [showNotice, setShowNotice] = useState(false);
  const foundRef = useRef(false);

  useEffect(() => {
    const { url, removed } = stripCredentialQuery(window.location.href);
    const marked = new URLSearchParams(window.location.search).get("notice") === "credentials";
    if (removed.length > 0 || marked) foundRef.current = true;

    if (foundRef.current) {
      const target = new URL(url, window.location.origin);
      if (marked) target.searchParams.delete("notice");
      const next = `${target.pathname}${target.search}${target.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) {
        window.history.replaceState(window.history.state, "", next);
      }
      // State update is deferred by a task: the URL is already clean, and the
      // react-hooks/set-state-in-effect rule forbids synchronous setState here.
      // `foundRef` survives React's development double-invocation of effects,
      // where the second run already sees a clean URL.
      const timer = window.setTimeout(() => setShowNotice(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  if (!showNotice) return null;

  return (
    <p
      role="alert"
      className="mt-4 rounded-sm border border-evidence-missing/30 bg-evidence-missing/10 px-3 py-2 text-sm text-text"
    >
      {CREDENTIAL_IN_URL_NOTICE}
    </p>
  );
}
