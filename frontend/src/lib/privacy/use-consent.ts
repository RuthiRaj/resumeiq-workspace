"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Consent } from "./consent";

/**
 * AI-processing consent hooks (PRD §6.9 EX-3). Any screen that is about to run
 * AI work reads `useConsent()` first: no recorded consent, no analysis.
 */

export const consentKeys = { all: ["consent"] as const };

export function useConsent() {
  return useQuery({
    queryKey: consentKeys.all,
    queryFn: () => api.getConsent(),
  });
}

export function useRecordConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (aiProcessing: boolean) => api.recordConsent({ aiProcessing }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: consentKeys.all });
    },
  });
}

/** True only when consent was recorded *and* granted. */
export function hasAiConsent(consent: Consent | null | undefined): boolean {
  return Boolean(consent?.aiProcessing);
}
