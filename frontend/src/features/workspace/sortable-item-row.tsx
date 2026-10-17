"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash } from "lucide-react";
import type { WorkspaceItem } from "@/lib/schemas";
import { EvidenceBadge } from "@/components/domain/evidence-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One sortable workspace row. The drag handle carries dnd-kit's keyboard
 * attributes, so it can be picked up with Space/Enter and moved with the arrow
 * keys (PRD §7.7). Explicit Move up/down buttons exist as a second, obvious
 * keyboard path and are what the E2E tests assert against.
 */
export function SortableItemRow({
  item,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragging = false,
}: {
  item: WorkspaceItem;
  onEdit: (item: WorkspaceItem) => void;
  onDelete: (item: WorkspaceItem) => void;
  onMoveUp: (item: WorkspaceItem) => void;
  onMoveDown: (item: WorkspaceItem) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const dates = [item.startDate, item.endDate].filter(Boolean).join(" – ");

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="workspace-item"
      data-item-id={item.id}
      className={cn(
        "glass flex items-start gap-3 rounded-md p-3 sm:p-4",
        (isDragging || dragging) && "relative z-10 opacity-90 ring-1 ring-accent-cyan/50",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${item.title}`}
        data-testid="drag-handle"
        className="mt-0.5 shrink-0 cursor-grab rounded p-1 text-muted hover:text-text active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-text">{item.title}</p>
          <EvidenceBadge state={item.evidence} />
        </div>
        {item.organization || dates || item.location ? (
          <p className="mt-1 text-xs text-muted">
            {[item.organization, dates, item.location].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {item.bullets.length > 0 ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
            {item.bullets[0]}
            {item.bullets.length > 1 ? ` (+${item.bullets.length - 1} more)` : ""}
          </p>
        ) : null}
        {item.attachments.length > 0 || item.links.length > 0 ? (
          <p className="mt-1.5 text-[11px] text-muted">
            {item.attachments.length > 0
              ? `${item.attachments.length} attachment${item.attachments.length === 1 ? "" : "s"}`
              : ""}
            {item.attachments.length > 0 && item.links.length > 0 ? " · " : ""}
            {item.links.length > 0
              ? `${item.links.length} link${item.links.length === 1 ? "" : "s"}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
        <div className="flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-1.5"
            aria-label={`Move ${item.title} up`}
            disabled={!canMoveUp}
            onClick={() => onMoveUp(item)}
          >
            <ChevronUp className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="px-1.5"
            aria-label={`Move ${item.title} down`}
            disabled={!canMoveDown}
            onClick={() => onMoveDown(item)}
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-1.5"
          aria-label={`Edit ${item.title}`}
          onClick={() => onEdit(item)}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-1.5"
          aria-label={`Delete ${item.title}`}
          onClick={() => onDelete(item)}
        >
          <Trash className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}
