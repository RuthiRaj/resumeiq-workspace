"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/features/ui/toast-store";
import { useColdStartState } from "@/lib/api/use-cold-start";

/**
 * Listens for cold-start retry events and shows a "server is waking up" toast.
 * Only renders in live mode when the API base URL is not localhost.
 */
export function ColdStartToast() {
  const { isWakingUp, isExhausted, remainingMs } = useColdStartState();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(remainingMs);

  // Keep remainingMs ref updated
  useEffect(() => {
    remainingRef.current = remainingMs;
  }, [remainingMs]);

  useEffect(() => {
    if (!isWakingUp) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const id = "cold-start-wakeup";

    // Show initial toast
    toast({
      id,
      title: "Server is waking up…",
      description:
        "The free-tier API spins down after inactivity. This usually takes 30–60 seconds.",
      tone: "info",
      duration: 90000, // Keep visible until dismissed
    });

    // Update toast with countdown
    intervalRef.current = setInterval(() => {
      const remaining = remainingRef.current;
      if (remaining <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      const seconds = Math.ceil(remaining / 1000);
      toast({
        id,
        title: "Server is waking up…",
        description: `Retrying in ~${seconds}s… (free tier cold start)`,
        tone: "info",
        duration: 90000,
      });
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isWakingUp]);

  useEffect(() => {
    if (isExhausted) {
      toast({
        id: "cold-start-exhausted",
        title: "Couldn't reach the server",
        description:
          "The API didn't wake up in time. Please try again in a moment.",
        tone: "error",
      });
    }
  }, [isExhausted]);

  return null;
}