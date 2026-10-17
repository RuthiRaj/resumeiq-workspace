"use client";

import type { UseFormReturn } from "react-hook-form";
import { Link2, Plus, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { WorkspaceItemFormValues } from "@/lib/schemas";

/**
 * Links editor (PRD §6.1 WS-2/WS-3). A link is evidence: it can make an item
 * eligible for the Verified state. Same controlled-row approach as the bullets
 * editor, so focus survives typing.
 */
export function LinksEditor({ form }: { form: UseFormReturn<WorkspaceItemFormValues> }) {
  const links = form.watch("links");
  const error = form.formState.errors.links;

  /**
   * Links are evidence: adding or removing one can make the item eligible for
   * (or invalidate) the "Verified" state. That rule lives in a schema
   * refinement on `evidence`, so re-run it here to update the message live.
   */
  function commitLinks(next: string[]) {
    form.setValue("links", next, { shouldDirty: true, shouldValidate: true });
    void form.trigger("evidence");
  }

  function updateRow(index: number, value: string) {
    const next = [...links];
    next[index] = value;
    commitLinks(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text">
          <Link2 className="size-4 text-muted" aria-hidden="true" /> Links
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => commitLinks([...links, ""])}
        >
          <Plus className="size-4" aria-hidden="true" /> Add link
        </Button>
      </div>
      {links.length === 0 ? (
        <p className="text-xs text-muted">Add a repository, demo, publication or certificate URL.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((link, index) => {
            const rowError = (
              form.formState.errors.links as
                | ({ message?: string } | undefined)[]
                | undefined
            )?.[index];
            const errorId = `link-${index}-error`;
            return (
              <li key={`link-${index}`} className="flex items-start gap-2">
                <Input
                  value={link}
                  onChange={(event) => updateRow(index, event.target.value)}
                  data-field="link"
                  type="url"
                  inputMode="url"
                  aria-label={`Link ${index + 1}`}
                  aria-invalid={rowError ? true : undefined}
                  aria-describedby={rowError ? errorId : undefined}
                  placeholder="https://example.com"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 shrink-0 px-2"
                  aria-label={`Remove link ${index + 1}`}
                  onClick={() =>
                    commitLinks(links.filter((_, i) => i !== index))
                  }
                >
                  <Trash className="size-4" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <FieldError
        id="links-error"
        message={typeof error?.message === "string" ? error.message : undefined}
      />
    </div>
  );
}
