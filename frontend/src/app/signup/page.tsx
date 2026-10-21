"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthFormProviders } from "@/features/auth/auth-form-providers";
import { AuthCard } from "@/features/auth/auth-card";
import { CredentialForm, CredentialSubmitButton } from "@/features/auth/credential-form";
import { OAuthButtons } from "@/features/auth/oauth-buttons";
import { PasswordInput } from "@/features/auth/password-input";
import { useAuth } from "@/lib/auth/context";
import { isLiveMode } from "@/lib/config/mode";
import { AuthError } from "@/lib/auth/types";
import { SignupSchema, type OAuthProvider, type SignupInput } from "@/lib/auth/schemas";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/field";
import { toast } from "@/features/ui/toast-store";

function SignupForm() {
  const router = useRouter();
  const { status, signUp, signInWithOAuth } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);

  // Already signed in (e.g. returning session) — continue to onboarding.
  useEffect(() => {
    if (status === "authenticated") router.replace("/onboarding");
  }, [status, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(SignupSchema) });

  const busy = isSubmitting || oauthPending !== null;

  async function onSubmit(values: SignupInput) {
    setFormError(null);
    try {
      await signUp(values);
      toast({ tone: "success", title: "Account created", description: "Let's set up your workspace." });
      router.replace("/onboarding");
      router.refresh();
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Something went wrong. Try again.";
      setFormError(message);
      toast({ tone: "error", title: "Sign up failed", description: message });
    }
  }

  async function onOAuth(provider: OAuthProvider) {
    setFormError(null);
    setOauthPending(provider);
    try {
      await signInWithOAuth(provider);
      toast({ tone: "success", title: "Account created", description: `Mocked ${provider} account ready.` });
      router.replace("/onboarding");
      router.refresh();
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Something went wrong. Try again.";
      setFormError(message);
      toast({ tone: "error", title: "Sign up failed", description: message });
    } finally {
      setOauthPending(null);
    }
  }

  return (
    <AuthCard
      eyebrow="Free forever"
      title="Create your account"
      description="One private workspace for everything you can truthfully claim. No billing, no paywalls — ever."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/signin" className="text-accent-cyan underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {isLiveMode() ? null : (
          <>
            <OAuthButtons onOAuth={onOAuth} pending={oauthPending} mode="signup" />
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">or email</span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>
          </>
        )}
        <CredentialForm onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              placeholder="Ada Example"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "name-error" : undefined}
              {...register("name")}
            />
            <FieldError id="name-error" message={errors.name?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "email-error" : undefined}
              {...register("email")}
            />
            <FieldError id="email-error" message={errors.email?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              {...register("password")}
            />
            <FieldError id="password-error" message={errors.password?.message} />
            <p id="password-hint" className="text-xs text-muted">
              At least 8 characters with a letter and a number.
            </p>
          </div>
          {formError ? (
            <p role="alert" className="rounded-sm border border-evidence-missing/30 bg-evidence-missing/10 px-3 py-2 text-sm text-text">
              {formError}
            </p>
          ) : null}
          <CredentialSubmitButton
            pending={busy}
            idleLabel="Create account"
            pendingLabel="Creating account…"
          />
        </CredentialForm>
      </div>
    </AuthCard>
  );
}

export default function SignupPage() {
  return (
    <AuthFormProviders>
      <Suspense fallback={<div className="mx-auto max-w-md px-6 py-24 text-sm text-muted">Loading sign up…</div>}>
        <SignupForm />
      </Suspense>
    </AuthFormProviders>
  );
}
