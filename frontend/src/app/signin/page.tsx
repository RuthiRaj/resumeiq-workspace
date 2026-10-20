"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthPageProviders } from "@/features/auth/auth-page-providers";
import { AuthCard } from "@/features/auth/auth-card";
import { OAuthButtons } from "@/features/auth/oauth-buttons";
import { PasswordInput } from "@/features/auth/password-input";
import { useAuth } from "@/lib/auth/context";
import { isLiveMode } from "@/lib/config/mode";
import { AuthError } from "@/lib/auth/types";
import { SigninSchema, type OAuthProvider, type SigninInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/field";
import { toast } from "@/features/ui/toast-store";

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/workspace";
}

function SigninForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const { status, signIn, signInWithOAuth } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);

  // A signed-in visitor (e.g. after the mock worker takes control on a
  // first-visit deep link) goes straight to their intended page.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SigninInput>({ resolver: zodResolver(SigninSchema) });

  const busy = isSubmitting || oauthPending !== null;

  async function onSubmit(values: SigninInput) {
    setFormError(null);
    try {
      await signIn(values);
      toast({ tone: "success", title: "Signed in", description: "Welcome back." });
      router.replace(next);
      router.refresh();
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Something went wrong. Try again.";
      setFormError(message);
      toast({ tone: "error", title: "Sign in failed", description: message });
    }
  }

  async function onOAuth(provider: OAuthProvider) {
    setFormError(null);
    setOauthPending(provider);
    try {
      await signInWithOAuth(provider);
      toast({ tone: "success", title: "Signed in", description: `Mocked ${provider} account ready.` });
      router.replace(next);
      router.refresh();
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Something went wrong. Try again.";
      setFormError(message);
      toast({ tone: "error", title: "Sign in failed", description: message });
    } finally {
      setOauthPending(null);
    }
  }

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in"
      description="Your private Master Workspace is waiting — nothing here is shared or scored."
      footer={
        <>
          New to ResumeIQ?{" "}
          <Link href="/signup" className="text-accent-cyan underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {isLiveMode() ? null : (
          <>
            <OAuthButtons onOAuth={onOAuth} pending={oauthPending} mode="signin" />
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-white/[0.08]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">or email</span>
              <span className="h-px flex-1 bg-white/[0.08]" />
            </div>
          </>
        )}
        <form noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs text-accent-cyan underline underline-offset-4">
                Forgot password?
              </Link>
            </div>
            <PasswordInput aria-invalid={Boolean(errors.password)} {...register("password")} />
            <FieldError id="password-error" message={errors.password?.message} />
            <p id="password-hint" className="text-xs text-muted">
              Passwords are mock-only in this milestone and stay in your browser.
            </p>
          </div>
          {formError ? (
            <p role="alert" className="rounded-sm border border-evidence-missing/30 bg-evidence-missing/10 px-3 py-2 text-sm text-text">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={busy} aria-busy={busy}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}

export default function SigninPage() {
  return (
    <AuthPageProviders>
      <Suspense fallback={<div className="mx-auto max-w-md px-6 py-24 text-sm text-muted">Loading sign in…</div>}>
        <SigninForm />
      </Suspense>
    </AuthPageProviders>
  );
}
