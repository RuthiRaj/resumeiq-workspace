"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, PencilLine, ShieldCheck } from "lucide-react";
import { AuthPageProviders } from "@/features/auth/auth-page-providers";
import { useAuth } from "@/lib/auth/context";
import { api } from "@/lib/api";
import { AI_PROVIDER_DISCLOSURE, type Consent } from "@/lib/privacy/consent";
import { Button } from "@/components/ui/button";
import { Checkbox, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/features/ui/toast-store";
import { cn } from "@/lib/utils";

const ONBOARDING_KEY = "riq.onboarding-choice";

type PathChoice = "import" | "manual";

function OnboardingFlow() {
  const router = useRouter();
  const { status, user } = useAuth();
  const [choice, setChoice] = useState<PathChoice>("import");
  const [step, setStep] = useState<1 | 2>(1);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/signin?next=/onboarding");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    api
      .getConsent()
      .then((res) => {
        if (!cancelled) {
          setConsent(res.consent);
          setAgreed(res.consent?.aiProcessing === true);
        }
      })
      .catch(() => {
        if (!cancelled) setConsentError("Could not load your consent settings. You can still continue — nothing AI-powered runs yet.");
      })
      .finally(() => {
        if (!cancelled) setConsentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-6 py-16" aria-busy="true" aria-label="Loading onboarding">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  function choosePath(next: PathChoice) {
    setChoice(next);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, next);
    } catch {
      // Non-fatal: choice simply won't persist.
    }
    setStep(2);
  }

  async function record(aiProcessing: boolean) {
    setSaving(true);
    setConsentError(null);
    try {
      const res = await api.recordConsent({ aiProcessing });
      setConsent(res.consent);
      toast({
        tone: "success",
        title: aiProcessing ? "AI consent recorded" : "Preference saved",
        description: aiProcessing
          ? "Future AI features may process your workspace content."
          : "AI features will stay off until you consent in Privacy.",
      });
      finish();
    } catch {
      const message = "Could not save your choice. Check your connection and try again.";
      setConsentError(message);
      toast({ tone: "error", title: "Could not save", description: message });
    } finally {
      setSaving(false);
    }
  }

  function finish() {
    router.replace(choice === "import" ? "/workspace/import" : "/workspace");
    router.refresh();
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-16">
      <div aria-hidden="true" className="glow-violet pointer-events-none absolute -top-24 left-1/2 size-96 -translate-x-1/2" />
      <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
        Step {step} of 2 · {user ? `for ${user.name}` : "Setup"}
      </p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">
        {step === 1 ? "How do you want to start?" : "One privacy promise first"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {step === 1
          ? "Import existing documents for review, or build your workspace by hand. Either way, nothing enters your workspace until you confirm it."
          : "Tailored resumes use AI on your workspace content. Your choice is recorded now and changeable anytime in Privacy — workspace editing always works without AI."}
      </p>

      {step === 1 ? (
        <Tabs value={choice} onValueChange={(v) => setChoice(v as PathChoice)} className="mt-6">
          <TabsList aria-label="Choose how to start">
            <TabsTrigger value="import">
              <FileUp className="size-4" aria-hidden="true" /> Import documents
            </TabsTrigger>
            <TabsTrigger value="manual">
              <PencilLine className="size-4" aria-hidden="true" /> Start manually
            </TabsTrigger>
          </TabsList>
          <TabsContent value="import" className="glass mt-4 rounded-md p-6">
            <h2 className="font-medium">Upload resumes & certificates</h2>
            <p className="mt-1 text-sm text-muted">
              We extract every field into a side-by-side review. Uncertain
              fields are flagged, and nothing is saved until you confirm each
              item. (Full review screen lands in F4.)
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => choosePath("import")}>Continue with import</Button>
              <Button variant="ghost" onClick={() => setStep(2)}>Skip for now</Button>
            </div>
          </TabsContent>
          <TabsContent value="manual" className="glass mt-4 rounded-md p-6">
            <h2 className="font-medium">Build section by section</h2>
            <p className="mt-1 text-sm text-muted">
              Education, experience, projects, skills and more — each item
              carries an evidence state from Verified to Missing. (Section
              editors land in F3.)
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => choosePath("manual")}>Start manually</Button>
              <Button variant="ghost" onClick={() => setStep(2)}>Skip for now</Button>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <section aria-labelledby="consent-title" className="glass mt-6 rounded-md p-6">
          <h2 id="consent-title" className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 text-evidence-verified" aria-hidden="true" />
            AI processing consent
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{AI_PROVIDER_DISCLOSURE}</p>
          {consentLoading ? (
            <div className="mt-4 flex flex-col gap-2" aria-busy="true" aria-label="Loading consent">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <div className="mt-4 flex items-start gap-3">
              <Checkbox
                id="ai-consent"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
              />
              <Label htmlFor="ai-consent" className="text-sm font-normal leading-relaxed">
                I understand and consent to AI processing of my workspace
                content for tailored resumes and job-match analysis.
              </Label>
            </div>
          )}
          {consentError ? (
            <p role="alert" className="mt-3 rounded-sm border border-evidence-related/30 bg-evidence-related/10 px-3 py-2 text-sm">
              {consentError}
            </p>
          ) : null}
          {consent ? (
            <p role="status" className={cn("mt-3 font-mono text-xs", consent.aiProcessing ? "text-evidence-verified" : "text-muted")}>
              Recorded {consent.recordedAt.slice(0, 10)} · {consent.aiProcessing ? "consented" : "declined"} · v{consent.version}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={saving || consentLoading || !agreed} onClick={() => record(true)} aria-busy={saving}>
              {saving && agreed ? "Saving…" : "Consent and continue"}
            </Button>
            <Button variant="secondary" disabled={saving || consentLoading} onClick={() => record(false)}>
              Continue without AI
            </Button>
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Change this anytime in <Link href="/privacy" className="text-accent-cyan underline underline-offset-4">Privacy</Link>.
          </p>
        </section>
      )}
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <AuthPageProviders>
      <Suspense fallback={<div className="mx-auto max-w-md px-6 py-24 text-sm text-muted">Loading onboarding…</div>}>
        <OnboardingFlow />
      </Suspense>
    </AuthPageProviders>
  );
}
