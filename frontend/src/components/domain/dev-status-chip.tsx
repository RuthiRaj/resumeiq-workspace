"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiBaseUrl, isLiveMode } from "@/lib/config/mode";

/**
 * Development-only status chip showing API base host and health check result.
 * Hidden in production builds (dev-excluded check must pass).
 */
export function DevStatusChip() {
  const [health, setHealth] = useState<"checking" | "ok" | "error" | "offline">("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "development") return;
    if (isLiveMode()) return; // In live mode, the backend URL is configured

    let cancelled = false;

    async function checkHealth() {
      try {
        const base = apiBaseUrl();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${base}/health`, {
          method: "GET",
          signal: controller.signal,
          headers: { "Cache-Control": "no-cache" },
        });
        clearTimeout(timeout);
        if (!cancelled) {
          setHealth(response.ok ? "ok" : "error");
          setLastChecked(new Date());
        }
      } catch {
        if (!cancelled) {
          setHealth("offline");
          setLastChecked(new Date());
        }
      }
    }

    checkHealth();
    const interval = setInterval(checkHealth, 30_000); // Check every 30s

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // In production or live mode, render nothing
  if (process.env.NODE_ENV !== "development" || isLiveMode()) {
    return null;
  }

  const baseUrl = apiBaseUrl();
  const host = new URL(baseUrl).host;

  const statusConfig = {
    checking: { icon: Loader2, color: "text-muted", label: "Checking…" },
    ok: { icon: Wifi, color: "text-evidence-verified", label: "Healthy" },
    error: { icon: Server, color: "text-evidence-missing", label: "Error" },
    offline: { icon: WifiOff, color: "text-evidence-related", label: "Offline" },
  };

  const config = statusConfig[health];

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md bg-elevated/90 border border-white/[0.08] px-3 py-2 text-xs font-mono backdrop-blur supports-[backdrop-filter]:bg-elevated/80",
        "transition-opacity duration-200",
      )}
      title={`API: ${baseUrl} | Last checked: ${lastChecked?.toLocaleTimeString() ?? "Never"}`}
    >
      <config.icon className={cn("size-3.5", config.color)} aria-hidden="true" />
      <span className={cn("whitespace-nowrap", config.color)}>{host}</span>
      <span className={cn(config.color)}>· {config.label}</span>
      {lastChecked && (
        <span className="text-muted">({lastChecked.toLocaleTimeString()})</span>
      )}
    </div>
  );
}

// Simple loader icon since Loader2 isn't in lucide-react
import { Loader2 as Loader2Import } from "lucide-react";
const Loader2 = Loader2Import;