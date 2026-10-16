import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Live sync pulse for the standard resume (PRD §6.3 SYN-1). */
export function SyncIndicator({
  syncedAt,
  syncing = false,
  className,
}: {
  syncedAt?: string;
  syncing?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted", className)}>
      <span className="relative flex size-2" aria-hidden="true">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full bg-evidence-verified opacity-60",
            syncing ? "animate-ping" : "animate-none",
          )}
        />
        <span className="relative inline-flex size-2 rounded-full bg-evidence-verified" />
      </span>
      {syncing ? (
        "Syncing…"
      ) : (
        <>
          Synced
          {syncedAt ? (
            <time dateTime={syncedAt} className="font-mono tabular-nums">
              {new Date(syncedAt).toLocaleTimeString()}
            </time>
          ) : null}
        </>
      )}
    </span>
  );
}

/** Staleness marker for tailored resumes (PRD §6.8). */
export function StaleBadge({ className }: { className?: string }) {
  return (
    <Badge variant="related" className={cn(className)} aria-label="Resume is stale">
      Stale — workspace changed
    </Badge>
  );
}
