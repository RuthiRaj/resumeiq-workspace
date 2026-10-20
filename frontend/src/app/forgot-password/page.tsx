"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthPageProviders } from "@/features/auth/auth-page-providers";
import { AuthCard } from "@/features/auth/auth-card";
import { useAuth } from "@/lib/auth/context";
import { isLiveMode } from "@/lib/config/mode";
import { AuthError } from "@/lib/auth/types";
import { ForgotPasswordSchema, type ForgotPasswordInput } from "@/lib/auth/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError, Label } from "@/components/ui/field";
import { toast } from "@/features/ui/toast-store";

export function ForgotPasswordForm() {
  const { requestPasswordReset } = useAuth();
  const [sent, setSent] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(ForgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordInput) {
    try {
      const res = await requestPasswordReset(values.email);
      setSent(res.message);
      toast({ tone: "success", title: "Reset link sent", description: res.message });
    } catch (err) {
      const message = err instanceof AuthError ? err.message : "Something went wrong. Try again.";
      toast({ tone: "error", title: "Could not send reset link", description: message });
    }
  }

  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Forgot password?"
      description={
        isLiveMode()
          ? "Enter your account email and we'll send a reset link through Supabase Auth. Open it on this device to choose a new password."
          : "Enter your account email and we'll send a reset link. Mocked in this milestone — no email is actually sent."
      }
      footer={
        <>
          Remembered it?{" "}
          <Link href="/signin" className="text-accent-cyan underline underline-offset-4">
            Back to sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <div
          role="status"
          className="rounded-sm border border-evidence-verified/30 bg-evidence-verified/10 px-4 py-3 text-sm text-text"
        >
          {sent}
        </div>
      ) : (
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
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthPageProviders>
      <Suspense fallback={<div className="mx-auto max-w-md px-6 py-24 text-sm text-muted">Loading…</div>}>
        <ForgotPasswordForm />
      </Suspense>
    </AuthPageProviders>
  );
}
