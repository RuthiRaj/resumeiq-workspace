"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Error state with a working retry (PRD §7.7). No silent failures. */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  retrying = false,
  className,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "glass flex flex-col items-start gap-3 rounded-md border-l-2 border-evidence-missing p-4 sm:p-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="size-5 shrink-0 text-evidence-missing" aria-hidden="true" />
        <h2 className="text-sm font-medium text-text">{title}</h2>
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-muted">{description}</p>
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
        >
          <RefreshCw className={cn("size-4", retrying && "animate-spin")} aria-hidden="true" />
          {retrying ? "Retrying…" : "Try again"}
        </Button>
      ) : null}
    </div>
  );
}
