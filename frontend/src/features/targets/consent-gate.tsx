"use client";

import { useState } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Label } from "@/components/ui/field";
import { LinkButton } from "@/components/ui/link-button";
import { AI_PROVIDER_DISCLOSURE } from "@/lib/privacy/consent";
import { cn } from "@/lib/utils";

/**
 * The AI-processing consent gate (PRD §6.9 EX-3).
 *
 * No analysis starts without recorded consent. When consent is missing (or was
 * declined) the gate is shown *instead of* the theatre, and it says exactly what
 * is being asked, who the provider is, and how to change the answer later.
 */
export function ConsentGate({
  onRecord,
  busy = false,
  error,
  className,
}: {
  onRecord: (aiProcessing: boolean) => void;
  busy?: boolean;
  error?: string | null;
  className?: string;
}) {
  const [accepted, setAccepted] = useState(false);

  return (
    <section
      aria-labelledby="consent-gate-title"
      data-testid="consent-gate"
      className={cn(
        "glass flex flex-col gap-4 rounded-md border-l-2 border-accent-cyan p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full border border-white/[0.12] bg-elevated"
        >
          <Lock className="size-4 text-accent-cyan" />
        </span>
        <div className="flex flex-col">
          <h2 id="consent-gate-title" className="text-sm font-medium text-text">
            Your consent is needed before we analyse
          </h2>
          <p className="text-xs text-muted">
            Job analysis sends the job description and your workspace
            information to the AI provider.
          </p>
        </div>
      </div>

      <p className="rounded-sm bg-white/[0.04] p-3 text-xs leading-relaxed text-muted">
        {AI_PROVIDER_DISCLOSURE}
      </p>

      <div className="flex items-start gap-3">
        <Checkbox
          id="consent-accept"
          checked={accepted}
          onCheckedChange={(value) => setAccepted(value === true)}
          data-testid="consent-checkbox"
        />
        <Label htmlFor="consent-accept" className="text-sm leading-relaxed">
          I understand my job description and workspace evidence will be
          processed by the AI provider, and I agree to that processing.
        </Label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!accepted || busy}
          aria-busy={busy}
          data-testid="consent-accept-button"
          onClick={() => onRecord(true)}
        >
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {busy ? "Recording…" : "Record consent and continue"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          data-testid="consent-decline-button"
          onClick={() => onRecord(false)}
        >
          Not now
        </Button>
        <LinkButton href="/privacy" variant="ghost" size="sm">
          Read the privacy page
        </LinkButton>
      </div>

      <p className="text-xs text-muted">
        You can change this at any time on the Privacy page. Declining keeps your
        workspace untouched — you just can&apos;t run an analysis.
      </p>

      {error ? (
        <p role="alert" className="text-xs text-evidence-missing">
          {error}
        </p>
      ) : null}
    </section>
  );
}
