"use client";

import Link from "next/link";
import { ExternalLink, Paperclip, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EVIDENCE_META } from "@/features/workspace/evidence";
import type { WorkspaceItem } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/** A clickable evidence chip; opens the cited workspace item in a sheet. */
export function EvidenceChip({
  label,
  state,
  removed = false,
  onClick,
}: {
  label: string;
  state?: WorkspaceItem["evidence"];
  removed?: boolean;
  onClick: () => void;
}) {
  const meta = state ? EVIDENCE_META[state] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-accent-cyan",
        removed
          ? "border-evidence-missing/40 bg-evidence-missing/10 text-evidence-missing hover:bg-evidence-missing/20"
          : "border-white/[0.12] bg-white/[0.04] text-muted hover:bg-white/[0.09] hover:text-text",
      )}
      title={removed ? "The source item was removed from the workspace" : label}
      data-testid="evidence-chip"
    >
      {removed ? (
        <XCircle className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", meta?.dot ?? "bg-muted")}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{label}</span>
      {removed ? <span className="shrink-0">· removed</span> : null}
    </button>
  );
}

/** Source item detail, including the evidence state and attachments. */
export function EvidenceSheet({
  open,
  onOpenChange,
  item,
  itemId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: WorkspaceItem | null;
  itemId?: string;
}) {
  const meta = item ? EVIDENCE_META[item.evidence] : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} data-testid="evidence-sheet">
        <SheetHeader>
          <SheetTitle>{item?.title ?? "Source item removed"}</SheetTitle>
          <SheetDescription>
            {item
              ? "The workspace item this line cites. Edit the item there to change its facts everywhere."
              : "This line cites an item that is no longer in your workspace. It stays visible until you edit or refresh the section, so nothing disappears silently."}
          </SheetDescription>
        </SheetHeader>

        {item ? (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {meta ? (
                <Badge variant={meta.badge}>{meta.label}</Badge>
              ) : null}
              <Badge variant="outline">{item.section}</Badge>
              {item.deletedAt ? <Badge variant="missing">Removed</Badge> : null}
            </div>
            <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              {item.organization ? (
                <>
                  <dt className="text-muted">Organisation</dt>
                  <dd className="text-text">{item.organization}</dd>
                </>
              ) : null}
              {item.startDate || item.endDate ? (
                <>
                  <dt className="text-muted">Dates</dt>
                  <dd className="text-text">
                    {[item.startDate, item.endDate].filter(Boolean).join(" – ")}
                  </dd>
                </>
              ) : null}
              {item.location ? (
                <>
                  <dt className="text-muted">Location</dt>
                  <dd className="text-text">{item.location}</dd>
                </>
              ) : null}
            </dl>

            {item.bullets.length > 0 ? (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Bullets
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {item.bullets.map((bullet, index) => (
                    <li key={`${bullet}-${index}`} className="text-sm leading-relaxed text-text">
                      {bullet}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {item.tags.length > 0 ? (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Tags
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            {item.links.length > 0 ? (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Links
                </h3>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {item.links.map((link) => (
                    <li key={link}>
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 break-all text-xs text-accent-cyan underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {item.attachments.length > 0 ? (
              <section>
                <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  Attachments
                </h3>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {item.attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center gap-1.5 text-xs text-text">
                      <Paperclip className="size-3" aria-hidden="true" />
                      {attachment.name}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Link
              href={`/workspace/${item.section}`}
              className="inline-flex h-9 w-fit items-center gap-1.5 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
            >
              Open this item in the workspace
            </Link>
          </div>
        ) : (
          <p className="mt-5 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-3 text-xs leading-relaxed text-text">
            {itemId ? `Source id: ${itemId}. ` : null}
            Removed information is never silently dropped. Refresh the section to
            rebuild it from the current workspace, or edit the line to cite
            another item.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
