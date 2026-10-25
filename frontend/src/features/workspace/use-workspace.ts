"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Workspace,
  WorkspaceItem,
  WorkspaceReorderInput,
} from "@/lib/schemas";

/**
 * Workspace data hooks (TanStack Query). Server state only — ephemeral UI
 * state stays in Zustand (PRD §8.3). Every mutation invalidates the workspace,
 * its change log and the derived standard resume, which is what drives the
 * "Synced" indicator (PRD §6.3 SYN-1).
 */

export const WORKSPACE_MUTATION_KEY = ["workspace-mutation"] as const;

export const workspaceKeys = {
  root: ["workspace"] as const,
  data: () => [...workspaceKeys.root, "data"] as const,
  changelog: () => [...workspaceKeys.root, "changelog"] as const,
  standardResume: () => ["resume", "standard"] as const,
};

export function useWorkspace() {
  return useQuery({
    queryKey: workspaceKeys.data(),
    queryFn: api.getWorkspace,
  });
}

export function useChangeLog() {
  return useQuery({
    queryKey: workspaceKeys.changelog(),
    queryFn: api.getChangeLog,
  });
}

export function useStandardResume() {
  return useQuery({
    queryKey: workspaceKeys.standardResume(),
    queryFn: api.getStandardResume,
  });
}

function useInvalidateWorkspace() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.root });
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.standardResume() });
    // Tailored resumes compute staleness against the workspace version, so a
    // workspace change must refresh their list/detail/diff too.
    void queryClient.invalidateQueries({ queryKey: ["resume"] });
  };
}

export function useCreateItem() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationKey: WORKSPACE_MUTATION_KEY,
    mutationFn: (input: Omit<WorkspaceItem, "id">) => api.createItem(input),
    onSettled: invalidate,
  });
}

export function useUpdateItem() {
  const invalidate = useInvalidateWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: WORKSPACE_MUTATION_KEY,
    mutationFn: ({ id, patch }: { id: string; patch: Partial<WorkspaceItem> }) =>
      api.updateItem(id, patch),
    // Paint the edit immediately; autosave must feel instant even at 350ms.
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: workspaceKeys.data() });
      const previous = queryClient.getQueryData<Workspace>(workspaceKeys.data());
      if (previous) {
        queryClient.setQueryData<Workspace>(workspaceKeys.data(), {
          ...previous,
          items: previous.items.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKeys.data(), context.previous);
      }
    },
    onSettled: invalidate,
  });
}

export function useDeleteItem() {
  const invalidate = useInvalidateWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: WORKSPACE_MUTATION_KEY,
    mutationFn: (id: string) => api.deleteItem(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: workspaceKeys.data() });
      const previous = queryClient.getQueryData<Workspace>(workspaceKeys.data());
      if (previous) {
        queryClient.setQueryData<Workspace>(workspaceKeys.data(), {
          ...previous,
          items: previous.items.filter((item) => item.id !== id),
        });
      }
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKeys.data(), context.previous);
      }
    },
    onSettled: invalidate,
  });
}

export function useRestoreItem() {
  const invalidate = useInvalidateWorkspace();
  return useMutation({
    mutationKey: WORKSPACE_MUTATION_KEY,
    mutationFn: (id: string) => api.restoreItem(id),
    onSettled: invalidate,
  });
}

export function useReorderItems() {
  const invalidate = useInvalidateWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: WORKSPACE_MUTATION_KEY,
    mutationFn: (input: WorkspaceReorderInput) => api.reorderItems(input),
    // Optimistic reorder keeps drag/keyboard moves snappy; rollback on error.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: workspaceKeys.data() });
      const previous = queryClient.getQueryData<Workspace>(workspaceKeys.data());
      if (previous) {
        const positions = new Map(input.orderedIds.map((id, index) => [id, index]));
        queryClient.setQueryData<Workspace>(workspaceKeys.data(), {
          ...previous,
          items: previous.items.map((item) =>
            positions.has(item.id)
              ? { ...item, order: positions.get(item.id) as number }
              : item,
          ),
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKeys.data(), context.previous);
      }
    },
    onSettled: invalidate,
  });
}

/**
 * Aggregated sync state for the "Synced" indicator: syncing while any
 * workspace mutation is in flight or a workspace/resume refetch is running,
 * otherwise the standard resume's last-updated timestamp (PRD §6.3 SYN-1).
 * Error state reflects the last failed read request.
 */
export function useSyncStatus() {
  const workspace = useWorkspace();
  const resume = useStandardResume();
  const mutating = useIsMutating({ mutationKey: WORKSPACE_MUTATION_KEY });
  const syncing = mutating > 0 || workspace.isFetching || resume.isFetching;
  const error = workspace.isError || resume.isError;
  return {
    syncing,
    error,
    version: workspace.data?.version,
    syncedAt: resume.data?.updatedAt ?? workspace.data?.updatedAt,
  };
}
