"use client";

import { useEffect, useState, type FormEvent, type FormHTMLAttributes } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useAuthFormReady } from "./auth-form-ready";

/**
 * A form that can never send its fields through the URL.
 *
 * `method="post"` and a static action are the no-JavaScript contract: if the
 * page ever renders before hydration (or fails to hydrate at all), the browser
 * would put email/password in the request body, never the query string. The
 * React handler always calls `preventDefault()` first, and does nothing until
 * hydration, so an accidental early submit cannot navigate at all.
 */
export function CredentialForm({
  onSubmit,
  children,
  ...props
}: Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "method" | "action" | "noValidate" | "onSubmit"
> & {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const hydrated = useHydrated();

  return (
    <form
      {...props}
      method="post"
      action="#"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!hydrated) return;
        onSubmit(event);
      }}
    >
      {children}
    </form>
  );
}

/**
 * Submit button for credential forms. It stays disabled in the server HTML and
 * during hydration; if hydration is unusually slow it says so after a moment
 * instead of looking like a dead control.
 */
export function CredentialSubmitButton({
  idleLabel,
  pendingLabel,
  pending = false,
  slowLabel = "Preparing a secure form…",
  slowAfterMs = 400,
  variant,
  size,
}: {
  idleLabel: string;
  pendingLabel: string;
  pending?: boolean;
  slowLabel?: string;
  slowAfterMs?: number;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const hydrated = useHydrated();
  const ready = useAuthFormReady();
  const [slow, setSlow] = useState(false);
  const waiting = !hydrated || !ready;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    return () => window.clearTimeout(timer);
  }, [waiting, slowAfterMs]);

  const preparing = waiting && slow;
  const busy = pending || preparing;
  const label = preparing ? slowLabel : pending ? pendingLabel : idleLabel;

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={waiting || pending}
      aria-busy={busy}
    >
      {label}
    </Button>
  );
}
