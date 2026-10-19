"use client";

import { Button } from "@/components/ui/button";
import type { OAuthProvider } from "@/lib/auth/schemas";

const PROVIDERS: { id: OAuthProvider; label: string; note: string }[] = [
  { id: "google", label: "Continue with Google", note: "Mocked in F2" },
  { id: "github", label: "Continue with GitHub", note: "Mocked in F2" },
];

export function OAuthButtons({
  onOAuth,
  pending,
  mode,
}: {
  onOAuth: (provider: OAuthProvider) => void;
  pending: OAuthProvider | null;
  mode: "signin" | "signup";
}) {
  return (
    <div className="flex flex-col gap-2">
      {PROVIDERS.map((p) => (
        <Button
          key={p.id}
          variant="secondary"
          disabled={pending !== null}
          onClick={() => onOAuth(p.id)}
        >
          {pending === p.id
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : p.label}
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {p.note}
          </span>
        </Button>
      ))}
    </div>
  );
}
