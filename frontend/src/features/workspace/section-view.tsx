"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowLeft, Plus } from "lucide-react";
import type { WorkspaceItem, WorkspaceSection } from "@/lib/schemas";
import { sectionMeta } from "./sections";
import { EVIDENCE_META, EVIDENCE_ORDER } from "./evidence";
import { activeBySection, moveWithin, reorderIds } from "./workspace-utils";
import {
  useDeleteItem,
  useReorderItems,
  useRestoreItem,
  useWorkspace,
} from "./use-workspace";
import { SortableItemRow } from "./sortable-item-row";
import { ItemEditorSheet } from "./item-editor-sheet";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/features/ui/toast-store";
import { cn } from "@/lib/utils";

function SectionSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3" aria-busy="true" aria-label="Loading items">
      {[0, 1, 2].map((index) => (
        <div key={index} className="glass rounded-md p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Section list view at `/workspace/[section]` (PRD §6.1 WS-6, §7.5). Drag to
 * reorder with dnd-kit; the same order can be changed with the keyboard via
 * Space/arrow keys on the handle or the Move up/down buttons. Soft delete
 * offers an Undo toast.
 */
export function SectionView({ section }: { section: WorkspaceSection }) {
  const meta = sectionMeta(section);
  const { data, isLoading, isError, isFetching, refetch } = useWorkspace();
  const reorder = useReorderItems();
  const remove = useDeleteItem();
  const restore = useRestoreItem();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceItem | null>(null);

  const items = useMemo(
    () => activeBySection(data?.items ?? [], section),
    [data?.items, section],
  );
  const ids = items.map((item) => item.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function commitOrder(orderedIds: string[]) {
    reorder.mutate(
      { section, orderedIds },
      {
        onError: () =>
          toast({ tone: "error", title: "Couldn’t save the new order", description: "Try again." }),
      },
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    commitOrder(reorderIds(ids, String(active.id), String(over.id)));
  }

  function move(item: WorkspaceItem, delta: number) {
    const from = ids.indexOf(item.id);
    const to = from + delta;
    if (to < 0 || to >= ids.length) return;
    commitOrder(moveWithin(ids, from, to));
  }

  function onDelete(item: WorkspaceItem) {
    remove.mutate(item.id, {
      onSuccess: () => {
        toast({
          tone: "info",
          title: "Item deleted",
          description: `“${item.title}” was removed from your workspace.`,
          action: {
            label: "Undo",
            onAction: () =>
              restore.mutate(item.id, {
                onSuccess: () =>
                  toast({
                    tone: "success",
                    title: "Restored",
                    description: `“${item.title}” is back in your workspace.`,
                  }),
                onError: () =>
                  toast({ tone: "error", title: "Couldn’t undo", description: "Try again." }),
              }),
          },
        });
      },
      onError: () =>
        toast({ tone: "error", title: "Couldn’t delete", description: "Nothing was changed." }),
    });
  }

  const Icon = meta.icon;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/workspace"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Workspace
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-sm border border-white/[0.12] bg-elevated">
              <Icon className="size-5 text-accent-cyan" aria-hidden="true" />
            </span>
            <div>
              <h1 className="font-display text-3xl tracking-tight">{meta.label}</h1>
              <p className="mt-1 max-w-prose text-sm text-muted">{meta.description}</p>
            </div>
          </div>
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> Add {meta.singular}
          </Button>
        </div>
        {/* Evidence legend: every state, always explained (PRD §4.2). */}
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Evidence states">
          {EVIDENCE_ORDER.map((state) => (
            <li key={state} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span aria-hidden="true" className={cn("size-2 rounded-full", EVIDENCE_META[state].dot)} />
              <span className={EVIDENCE_META[state].text}>{EVIDENCE_META[state].label}</span>
            </li>
          ))}
        </ul>
      </div>

      {isLoading ? (
        <SectionSkeleton />
      ) : isError ? (
        <ErrorState
          title="Couldn’t load this section"
          description="The workspace didn’t respond. Your data is safe — try again."
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={`No ${meta.label.toLowerCase()} yet`}
          description={meta.emptyHint}
        >
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" /> Add {meta.singular}
          </Button>
        </EmptyState>
      ) : (
        <>
          <p className="text-xs text-muted">
            {items.length} {items.length === 1 ? "item" : "items"} · drag the handle, or use Move
            up/down, to change the order shown on your resume.
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-3" data-testid="workspace-list">
                {items.map((item, index) => (
                  <SortableItemRow
                    key={item.id}
                    item={item}
                    canMoveUp={index > 0}
                    canMoveDown={index < items.length - 1}
                    onMoveUp={(target) => move(target, -1)}
                    onMoveDown={(target) => move(target, 1)}
                    onEdit={(target) => {
                      setEditing(target);
                      setEditorOpen(true);
                    }}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      <ItemEditorSheet
        section={section}
        item={editing}
        open={editorOpen}
        onOpenChange={(next) => {
          setEditorOpen(next);
          if (!next) setEditing(null);
        }}
      />
    </div>
  );
}
