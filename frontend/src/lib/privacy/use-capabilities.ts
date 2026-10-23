"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Capabilities } from "@/lib/schemas";

/**
 * `GET /capabilities` (B6 §9.1). This is the only source of truth for whether
 * an optional AI/PDF/export/deletion feature exists. The returned object is
 * flattened for screens, while `data` stays null when the call failed so a
 * caller can tell "off" from "could not check". The fallback is deliberately
 * all-false: a failed capabilities read must never look like a working feature.
 */
export const capabilitiesKeys = {
  all: ["capabilities"] as const,
};

const UNAVAILABLE: Capabilities = {
  ai: { configured: false, analysisEnrichment: false, resumeRewording: false },
  pdfExport: false,
  dataExport: false,
  accountDeletion: { dataDeletion: false, authUserDeletion: false },
};

export function useCapabilities() {
  const query = useQuery({
    queryKey: capabilitiesKeys.all,
    queryFn: () => api.getCapabilities(),
    staleTime: 60_000,
    retry: 1,
  });

  return {
    ...(query.data ?? UNAVAILABLE),
    /** Null until a successful read; lets callers explain a failed check. */
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    query,
  };
}
