"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { PlaceholderPage } from "@/components/placeholder-page";
import { api } from "@/lib/api";
import { AI_PROVIDER_DISCLOSURE, type Consent } from "@/lib/privacy/consent";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/features/ui/toast-store";

/**
 * F2 slice of the Privacy centre (full centre lands in F6): the live AI
 * consent record created during onboarding, readable and changeable here.
 */
function ConsentCard() {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getConsent()
      .then((res) => {
        if (!cancelled) setConsent(res.consent);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your consent record. Try reloading.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(aiProcessing: boolean) {
    setSaving(true);
    try {
      const res = await api.recordConsent({ aiProcessing });
      setConsent(res.consent);
      toast({
        tone: "success",
        title: "Preference saved",
        description: aiProcessing ? "AI features are on." : "AI features are off.",
      });
    } catch {
      toast({ tone: "error", title: "Could not save", description: "Try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="consent-heading" className="glass mt-6 max-w-xl rounded-md p-6">
      <h2 id="consent-heading" className="flex items-center gap-2 text-base font-medium">
        <ShieldCheck className="size-4 text-evidence-verified" aria-hidden="true" />
        AI processing consent
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{AI_PROVIDER_DISCLOSURE}</p>
      {loading ? (
        <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading consent">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error ? (
        <p role="alert" className="mt-4 text-sm text-evidence-missing">{error}</p>
      ) : (
        <p role="status" className="mt-4 font-mono text-xs text-muted">
          {consent
            ? `Recorded ${consent.recordedAt.slice(0, 10)} · ${consent.aiProcessing ? "consented" : "declined"} · v${consent.version}`
            : "No consent recorded yet — visit onboarding to record one."}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={loading || saving} onClick={() => update(true)} aria-busy={saving}>
          Consent to AI processing
        </Button>
        <Button size="sm" variant="secondary" disabled={loading || saving} onClick={() => update(false)}>
          Decline
        </Button>
        <Link href="/onboarding">
          <Button size="sm" variant="ghost">
            Revisit onboarding
          </Button>
        </Link>
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <PlaceholderPage
        title="Privacy"
        milestone="Coming in F6"
        description="Full data export (JSON) and permanent account deletion land in F6. Your AI consent below is live today."
      />
      <ConsentCard />
    </>
  );
}
