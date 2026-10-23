"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useConsent } from "@/lib/privacy/use-consent";
import { aiRewordAvailability } from "@/lib/resume";
import type {
  Capabilities,
  Resume,
  ResumeDiff,
  ResumeGenerateRequest,
  ResumeRefreshRequest,
  ResumeRefreshResult,
  ResumeSectionEdit,
} from "@/lib/schemas";

/**
 * B5 resume hooks. Server state lives in TanStack Query; drafts stay in the
 * component so a background refetch can never overwrite text while the user is
 * typing.
 */

export const resumeKeys = {
  all: ["resume"] as const,
  list: () => [...resumeKeys.all, "list"] as const,
  detail: (resumeId: string) => [...resumeKeys.all, "detail", resumeId] as const,
  versions: (resumeId: string) =>
    [...resumeKeys.all, "versions", resumeId] as const,
  diff: (resumeId: string) => [...resumeKeys.all, "diff", resumeId] as const,
};

export function useResumeList() {
  return useQuery({
    queryKey: resumeKeys.list(),
    queryFn: () => api.listResumes(),
  });
}

export function useResume(resumeId: string | null | undefined) {
  return useQuery({
    queryKey: resumeKeys.detail(resumeId ?? ""),
    queryFn: () => api.getResume(resumeId as string),
    enabled: Boolean(resumeId),
  });
}

export function useResumeVersions(
  resumeId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: resumeKeys.versions(resumeId ?? ""),
    queryFn: () => api.listResumeVersions(resumeId as string),
    enabled: Boolean(resumeId) && enabled,
  });
}

export function useResumeDiff(
  resumeId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: resumeKeys.diff(resumeId ?? ""),
    queryFn: () => api.getResumeDiff(resumeId as string),
    enabled: Boolean(resumeId) && enabled,
  });
}

/**
 * Deliberately all-false: a failed capabilities read must never look like a
 * working feature, and `data` stays `null` so callers can tell "off" from
 * "could not check".
 */
const CAPABILITIES_UNAVAILABLE: Capabilities = {
  ai: { configured: false, analysisEnrichment: false, resumeRewording: false },
  pdfExport: false,
  dataExport: false,
  accountDeletion: { dataDeletion: false, authUserDeletion: false },
};

export const capabilitiesKeys = {
  all: ["capabilities"] as const,
};

/** `GET /capabilities` (B6 §9.1): the only source of truth for AI gating. */
export function useCapabilities() {
  const query = useQuery({
    queryKey: capabilitiesKeys.all,
    queryFn: () => api.getCapabilities(),
    staleTime: 60_000,
    retry: 1,
  });
  return {
    ...(query.data ?? CAPABILITIES_UNAVAILABLE),
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    query,
  };
}

function useInvalidateResume(resumeId?: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: resumeKeys.all });
    if (resumeId) {
      void queryClient.invalidateQueries({
        queryKey: resumeKeys.versions(resumeId),
      });
      void queryClient.invalidateQueries({ queryKey: resumeKeys.diff(resumeId) });
    }
  };
}

export function useGenerateResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      targetId,
      input,
    }: {
      targetId: string;
      input: ResumeGenerateRequest;
    }) => api.generateResume(targetId, input),
    onSuccess: (resume) => {
      queryClient.setQueryData(resumeKeys.detail(resume.id), resume);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.list() });
    },
  });
}

export function useEditResumeSection(resumeId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateResume(resumeId);
  return useMutation({
    mutationFn: ({
      sectionKey,
      input,
    }: {
      sectionKey: string;
      input: ResumeSectionEdit;
    }) => api.editResumeSection(resumeId, sectionKey, input),
    onSuccess: (resume) => {
      queryClient.setQueryData(resumeKeys.detail(resumeId), resume);
      invalidate();
    },
  });
}

export function useRefreshResume(resumeId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateResume(resumeId);
  return useMutation({
    mutationFn: (input: ResumeRefreshRequest) =>
      api.refreshResume(resumeId, input),
    onSuccess: (result: ResumeRefreshResult) => {
      queryClient.setQueryData(resumeKeys.detail(resumeId), result.resume);
      invalidate();
    },
  });
}

export function useRestoreResumeVersion(resumeId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateResume(resumeId);
  return useMutation({
    mutationFn: (versionId: string) =>
      api.restoreResumeVersion(resumeId, versionId),
    onSuccess: (resume: Resume) => {
      queryClient.setQueryData(resumeKeys.detail(resumeId), resume);
      invalidate();
    },
  });
}

export function useMarkResumeStale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (resumeId: string) => api.markResumeStale(resumeId),
    onSuccess: (resume) => {
      queryClient.setQueryData(resumeKeys.detail(resume.id), resume);
      void queryClient.invalidateQueries({ queryKey: resumeKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: resumeKeys.diff(resume.id),
      });
    },
  });
}

/** Most recent tailored resume for a target, from the list endpoint. */
export function useResumeForTarget(targetId: string) {
  const list = useResumeList();
  const matches = (list.data ?? [])
    .filter((resume) => resume.kind === "tailored" && resume.targetId === targetId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { ...list, resume: matches[0] ?? null, matches };
}

/** Both availability gates for the optional AI reworder. */
export function useAiRewordAvailability() {
  const consent = useConsent();
  const capabilities = useCapabilities();
  return {
    ...aiRewordAvailability(
      consent.data?.consent,
      capabilities.ai.resumeRewording,
    ),
    loading: consent.isLoading || capabilities.isLoading,
    query: consent,
    capabilities,
  };
}

export type ResumeDiffData = ResumeDiff;
