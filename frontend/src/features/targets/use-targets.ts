"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { JobTarget, TargetCreateValues } from "@/lib/schemas";

/**
 * Job-target and analysis hooks (PRD §6.4, §6.6). The analysis is polled while
 * it runs and stops on its own when the run succeeds or fails, so the theatre
 * never keeps a timer alive behind a finished report.
 */

export const targetKeys = {
  all: ["targets"] as const,
  list: () => [...targetKeys.all, "list"] as const,
  detail: (id: string) => [...targetKeys.all, "detail", id] as const,
  run: (id: string) => [...targetKeys.all, "run", id] as const,
  report: (id: string) => [...targetKeys.all, "report", id] as const,
};

export function useTargets() {
  return useQuery({
    queryKey: targetKeys.list(),
    queryFn: () => api.listTargets(),
  });
}

export function useTarget(targetId: string) {
  return useQuery({
    queryKey: targetKeys.detail(targetId),
    queryFn: () => api.getTarget(targetId),
    enabled: Boolean(targetId),
    retry: false,
  });
}

export function useCreateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TargetCreateValues) => api.createTarget(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: targetKeys.all });
    },
  });
}

/** Starts (or restarts) the staged analysis run. */
export function useStartAnalysis(targetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.startAnalysis(targetId),
    onSuccess: (data) => {
      queryClient.setQueryData(targetKeys.run(targetId), data);
      void queryClient.invalidateQueries({ queryKey: targetKeys.detail(targetId) });
    },
  });
}

/**
 * Polls the run every 300ms while it is running. The mock advances the run from
 * wall-clock time, so this is real progress, not a fake animation.
 */
export function useAnalysisRun(targetId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: targetKeys.run(targetId),
    queryFn: async () => {
      const data = await api.getAnalysisRun(targetId);
      if (data.run.status === "succeeded") {
        void queryClient.invalidateQueries({ queryKey: targetKeys.report(targetId) });
        void queryClient.invalidateQueries({ queryKey: targetKeys.detail(targetId) });
        void queryClient.invalidateQueries({ queryKey: targetKeys.list() });
      }
      return data;
    },
    enabled: enabled && Boolean(targetId),
    refetchInterval: (query) =>
      query.state.data?.run.status === "running" ? 300 : false,
    retry: false,
  });
}

export function useAnalysisReport(targetId: string, enabled: boolean) {
  return useQuery({
    queryKey: targetKeys.report(targetId),
    queryFn: () => api.getAnalysis(targetId),
    enabled: enabled && Boolean(targetId),
    retry: false,
  });
}

/** Dev-only: writes the three demo targets (PRD §8.5). */
export function useSampleTargets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.createSampleTargets(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: targetKeys.all });
    },
  });
}

export type { JobTarget };
