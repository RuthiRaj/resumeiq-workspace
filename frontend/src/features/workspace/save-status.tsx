"use client";

import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, Loader } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const subscribeToHydration = () => () => {};

/**
 * `true` only after hydration. We format the saved-at time during render so no
 * effect is needed, but keep it `null` on the server and first paint so the
 * markup can't drift from the client timestamp.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}

/** Autosave indicator on editors (PRD §7.7). Always tells the truth. */
export function SaveStatusIndicator({
  status,
  savedAt,
  errorMessage,
  className,
}: {
  status: SaveStatus;
  savedAt?: string;
  errorMessage?: string;
  className?: string;
}) {
  const hydrated = useHydrated();
  const time = hydrated && savedAt ? new Date(savedAt).toLocaleTimeString() : null;

  const label: Record<SaveStatus, string> = {
    idle: "No changes yet",
    dirty: "Unsaved changes",
    saving: "Saving…",
    saved: time ? `Saved at ${time}` : "Saved",
    error: errorMessage ?? "Couldn’t save",
  };

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-1.5 text-xs", className)}
    >
      {status === "saving" ? (
        <Loader className="size-3.5 animate-spin text-muted" aria-hidden="true" />
      ) : status === "saved" ? (
        <CircleCheck className="size-3.5 text-evidence-verified" aria-hidden="true" />
      ) : status === "error" ? (
        <CircleAlert className="size-3.5 text-evidence-missing" aria-hidden="true" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            status === "dirty" ? "bg-evidence-related" : "bg-muted/50",
          )}
        />
      )}
      <span
        className={cn(
          "tabular-nums",
          status === "error" ? "text-evidence-missing" : "text-muted",
        )}
      >
        {label[status]}
      </span>
    </span>
  );
}
