"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox, FieldError, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/features/ui/toast-store";
import { useAuth } from "@/lib/auth/context";
import { AuthError } from "@/lib/auth/types";
import { useCapabilities } from "@/lib/privacy/use-capabilities";
import { TEMPLATE_OPTIONS, TARGET_LENGTHS } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { useResumePreferences } from "@/features/resume/use-resume-preferences";

/**
 * `/settings` (F6). Profile, display defaults, security and a plain-language
 * list of what each AI feature does. Every control has a real effect: profile
 * and password go through the auth client (Supabase in live mode), session
 * sign-out goes through the same client, and display defaults are the same
 * localStorage preferences `/resume` reads.
 */

function ProfileSection() {
  const { user, updateDisplayName } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = name.trim() !== (user?.name ?? "") && name.trim().length > 0;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(name.trim());
      toast({
        tone: "success",
        title: "Profile updated",
        description: "Your display name changed for this account.",
      });
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : "Your profile could not be updated. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="profile-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="profile-heading" className="flex items-center gap-2 text-base font-medium">
        <UserRound className="size-4 text-accent-cyan" aria-hidden="true" />
        Profile
      </h2>
      <form
        className="mt-4 flex max-w-md flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">Display name</Label>
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoComplete="name"
            required
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "profile-error" : undefined}
            data-testid="settings-name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">Email</Label>
          <Input
            id="profile-email"
            value={user?.email ?? ""}
            readOnly
            aria-describedby="profile-email-hint"
            className="text-muted"
          />
          <p id="profile-email-hint" className="text-[11px] text-muted">
            Changing the sign-in email is not supported here. It stays the same
            until the operator removes the identity after an account deletion.
          </p>
        </div>
        <FieldError id="profile-error" message={error ?? undefined} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!dirty || saving} aria-busy={saving}>
            {saving ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            {saving ? "Saving…" : "Save profile"}
          </Button>
          {!dirty && !saving ? (
            <p className="text-[11px] text-muted">No unsaved changes.</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function DisplaySection() {
  const { preferences, update, reset } = useResumePreferences();
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);

  return (
    <section aria-labelledby="display-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="display-heading" className="flex items-center gap-2 text-base font-medium">
        <Laptop className="size-4 text-accent-cyan" aria-hidden="true" />
        Display and resume defaults
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        These are presentation defaults for the standard resume. They never
        change wording or facts, and they are stored in this browser only.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-text">Default template</p>
          <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Default template">
            {TEMPLATE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preferences.template === option.value}
                onClick={() => update({ template: option.value })}
                className={cn(
                  "rounded-sm border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-accent-cyan",
                  preferences.template === option.value
                    ? "border-accent-cyan/50 bg-accent-cyan/10 text-text"
                    : "border-white/[0.08] text-muted hover:bg-white/[0.06] hover:text-text",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-text">Default length</p>
          <div className="mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Default length">
            {TARGET_LENGTHS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={preferences.length === value}
                onClick={() => update({ length: value })}
                className={cn(
                  "rounded-sm border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-accent-cyan",
                  preferences.length === value
                    ? "border-accent-cyan/50 bg-accent-cyan/10 text-text"
                    : "border-white/[0.08] text-muted hover:bg-white/[0.06] hover:text-text",
                )}
              >
                {value === "one_page" ? "One page" : "Two pages"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Checkbox
          id="settings-reduced-motion"
          checked={reducedMotion}
          disabled
          aria-describedby="settings-motion-hint"
        />
        <Label htmlFor="settings-reduced-motion" className="text-xs font-normal text-muted">
          Reduced motion (controlled by your operating system)
        </Label>
        <p id="settings-motion-hint" className="text-[11px] leading-relaxed text-muted">
          {reducedMotion
            ? "Your system asks for reduced motion; this app already honours it."
            : "Turn it on in your system settings. This app has no separate override, so there is no dead switch here."}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-4"
        onClick={() => {
          reset();
          toast({
            tone: "success",
            title: "Display defaults reset",
            description: "The standard resume is back to its original presentation.",
          });
        }}
      >
        Reset display defaults
      </Button>
    </section>
  );
}

function PasswordSection() {
  const { user, changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user?.provider !== "password") {
    return (
      <section aria-labelledby="password-heading" className="glass rounded-md p-4 sm:p-6">
        <h2 id="password-heading" className="flex items-center gap-2 text-base font-medium">
          <KeyRound className="size-4 text-accent-cyan" aria-hidden="true" />
          Password
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You sign in with {user?.provider === "google" ? "Google" : "GitHub"}, so
          this account has no ResumeIQ password to change. Manage the password
          with that provider.
        </p>
      </section>
    );
  }

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirmation.length > 0 && confirmation !== next;
  const ready =
    current.length > 0 && next.length >= 8 && confirmation === next && !saving;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirmation("");
      toast({
        tone: "success",
        title: "Password changed",
        description: "Use the new password the next time you sign in.",
      });
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : "Your password could not be changed. Nothing was updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="password-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="password-heading" className="flex items-center gap-2 text-base font-medium">
        <KeyRound className="size-4 text-accent-cyan" aria-hidden="true" />
        Password
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Confirm your current password, then choose a new one of at least 8
        characters.
      </p>
      <form className="mt-4 flex max-w-md flex-col gap-3" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            required
            data-testid="settings-current-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            aria-invalid={tooShort}
            aria-describedby="new-password-hint"
            data-testid="settings-new-password"
          />
          <p id="new-password-hint" className="text-[11px] text-muted">
            At least 8 characters. Letters, numbers and symbols all work.
          </p>
          {tooShort ? <p className="text-xs text-evidence-missing">Use at least 8 characters.</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            data-testid="settings-confirm-password"
          />
          {mismatch ? (
            <p className="text-xs text-evidence-missing">The two new passwords do not match.</p>
          ) : null}
        </div>
        <FieldError id="password-error" message={error ?? undefined} />
        <Button type="submit" size="sm" disabled={!ready} aria-busy={saving}>
          {saving ? "Changing…" : "Change password"}
        </Button>
      </form>
    </section>
  );
}

function SecuritySection() {
  const { signOutEverywhere } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOutAll() {
    setWorking(true);
    setError(null);
    try {
      await signOutEverywhere();
      router.push("/signin");
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : "Sessions could not be ended. Try again.",
      );
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="security-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="security-heading" className="flex items-center gap-2 text-base font-medium">
        <MonitorSmartphone className="size-4 text-accent-cyan" aria-hidden="true" />
        Security and sessions
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        Ending every session signs out this browser and every other device that
        is currently signed in. You will need to sign in again.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
        data-testid="sign-out-everywhere"
      >
        <LogOut className="size-4" aria-hidden="true" />
        Sign out everywhere
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-evidence-missing">
          {error}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!working) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out everywhere?</DialogTitle>
            <DialogDescription>
              This ends every active session for your account, including this
              one. Your data is not deleted and nothing in the workspace changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void signOutAll()}
              disabled={working}
              aria-busy={working}
              data-testid="confirm-sign-out-everywhere"
            >
              {working ? "Signing out…" : "Sign out everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AiFeaturesSection() {
  const capabilities = useCapabilities();
  const rows = [
    {
      title: "Analysis enrichment",
      available: capabilities.ai.analysisEnrichment && capabilities.ai.configured,
      description:
        "Adds optional narrative notes to a finished report. It never changes the score, the requirement match or the evidence states.",
    },
    {
      title: "Resume rewording",
      available: capabilities.ai.resumeRewording && capabilities.ai.configured,
      description:
        "Rewords one bullet at a time using only the cited workspace item. A rewrite that adds a fact is discarded and the original line stays.",
    },
  ];

  return (
    <section aria-labelledby="ai-features-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="ai-features-heading" className="flex items-center gap-2 text-base font-medium">
        <Sparkles className="size-4 text-accent-violet" aria-hidden="true" />
        What each AI feature does
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.title} className="rounded-sm border border-white/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-text">{row.title}</p>
              <Badge variant={row.available ? "verified" : "outline"}>
                {capabilities.isLoading
                  ? "Checking…"
                  : row.available
                    ? "Available"
                    : "Unavailable"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{row.description}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Both features are off unless an AI provider is configured and you have
        recorded AI-processing consent.{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-text">
          Review consent and privacy
        </Link>
        .
      </p>
      {capabilities.isError ? (
        <p role="alert" className="mt-2 text-xs text-evidence-related">
          Capabilities could not be checked, so both features are treated as
          unavailable. Retry from the Privacy centre.
        </p>
      ) : null}
    </section>
  );
}

export function SettingsContent() {
  return (
    <div className="flex flex-col gap-5" data-testid="settings">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Account</p>
        <h1 className="font-display text-3xl tracking-tight">Settings</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          Your profile, how the resume looks, and how to make your account safer.
          Data export and deletion live in the Privacy centre.
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <BadgeCheck className="size-3.5 text-evidence-verified" aria-hidden="true" />
          Signed in as{" "}
          <span className="text-text" data-testid="settings-email">
            <EmailLabel />
          </span>
        </p>
      </header>
      <ProfileSection />
      <DisplaySection />
      <PasswordSection />
      <SecuritySection />
      <AiFeaturesSection />
      <p className="text-xs text-muted">
        Looking for export or deletion?{" "}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-text">
          Open the Privacy centre
        </Link>
        .
      </p>
    </div>
  );
}

function EmailLabel() {
  const { user } = useAuth();
  return <>{user?.email ?? "…"}</>;
}
