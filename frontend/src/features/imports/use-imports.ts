"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ImportReviewItem,
  ImportSession,
  ImportSummary,
  ImportSupport,
  WorkspaceItem,
} from "@/lib/schemas";
import { reviewItemToWorkspaceInputs } from "@/lib/schemas";
import { workspaceKeys } from "@/features/workspace/use-workspace";

/**
 * Import-session hooks (PRD §6.2). Uploading returns a *review*, and confirming
 * an item is what writes it to the workspace (`POST /workspace/items`), so the
 * "nothing enters the workspace until confirmed" rule is structural.
 */

export const importKeys = {
  all: ["imports"] as const,
  list: () => [...importKeys.all, "list"] as const,
  session: (id: string) => [...importKeys.all, "session", id] as const,
};

export function useImportSummaries() {
  return useQuery({
    queryKey: importKeys.list(),
    queryFn: () => api.listImports(),
  });
}

export function useImportSession(sessionId: string | null) {
  return useQuery({
    queryKey: importKeys.session(sessionId ?? "none"),
    queryFn: () => api.getImport(sessionId as string),
    enabled: Boolean(sessionId),
    retry: false,
  });
}

export function useUploadImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadImport(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importKeys.list() });
    },
  });
}

function invalidateSession(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
) {
  void queryClient.invalidateQueries({ queryKey: importKeys.session(sessionId) });
}

/** Saves edited values without changing the item's decision. */
export function useSaveImportValues(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: ImportReviewItem) =>
      api.updateImportItem(sessionId, item.id, {
        values: item.values,
        // Attaching a certificate goes through this mutation too (the card
        // hands `support` to `onSaveValues`). Sending it on every save is
        // idempotent and stops the edit from silently dropping the evidence —
        // without it a confirmed item would be attested although the UI showed
        // Verified.
        support: item.support,
      }),
    onSuccess: () => invalidateSession(queryClient, sessionId),
  });
}

/** Confirms or rejects an extracted item (IM-2). */
export function useDecideImportItem(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      item,
      status,
      support,
    }: {
      item: ImportReviewItem;
      status: "pending" | "confirmed" | "rejected";
      support?: ImportSupport | null;
    }) =>
      api.updateImportItem(sessionId, item.id, {
        status,
        values: item.values,
        ...(support === undefined ? {} : { support }),
      }),
    onSuccess: () => invalidateSession(queryClient, sessionId),
  });
}

/**
 * Confirm = create the workspace item(s), then mark the review item confirmed.
 * Order matters: if a create fails, the item stays pending and nothing
 * pretended to be saved. A skills card holds one chip per skill, so it creates
 * one workspace item per chip (see `reviewItemToWorkspaceInputs`).
 */
export function useConfirmImportItem(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: ImportReviewItem) => {
      const inputs = reviewItemToWorkspaceInputs(item);
      const created: WorkspaceItem[] = [];
      for (const input of inputs) {
        created.push(await api.createItem(input));
      }
      await api.updateImportItem(sessionId, item.id, {
        status: "confirmed",
        values: item.values,
        support: item.support,
      });
      return created;
    },
    onSuccess: () => {
      invalidateSession(queryClient, sessionId);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.root });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.standardResume() });
    },
  });
}

export type { ImportReviewItem, ImportSession, ImportSummary };
