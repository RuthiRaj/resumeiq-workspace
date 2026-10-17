"use client";

import type { UseFormReturn } from "react-hook-form";
import { Plus, Trash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { WorkspaceItemFormValues } from "@/lib/schemas";

/**
 * Bullets editor (PRD §6.1 WS-3).
 *
 * Rows are controlled directly from the form value rather than
 * `useFieldArray`, because react-hook-form's `FieldArrayPath` only admits
 * arrays of objects — not `string[]`. Rows are keyed by index, so a keystroke
 * re-renders the same DOM node and focus is never lost (PRD §7.7).
 */
export function BulletsEditor({ form }: { form: UseFormReturn<WorkspaceItemFormValues> }) {
  const bullets = form.watch("bullets");
  const error = form.formState.errors.bullets;

  function updateRow(index: number, value: string) {
    const next = [...bullets];
    next[index] = value;
    form.setValue("bullets", next, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">Bullets</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            form.setValue("bullets", [...bullets, ""], { shouldDirty: true });
          }}
        >
          <Plus className="size-4" aria-hidden="true" /> Add bullet
        </Button>
      </div>
      {bullets.length === 0 ? (
        <p className="text-xs text-muted">
          Add one bullet per thing you did or result you can defend. No invented metrics.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bullets.map((bullet, index) => {
            const rowError = (
              form.formState.errors.bullets as
                | ({ message?: string } | undefined)[]
                | undefined
            )?.[index];
            const errorId = `bullet-${index}-error`;
            return (
              <li key={`bullet-${index}`} className="flex items-start gap-2">
                <Input
                  value={bullet}
                  onChange={(event) => updateRow(index, event.target.value)}
                  data-field="bullet"
                  aria-label={`Bullet ${index + 1}`}
                  aria-invalid={rowError ? true : undefined}
                  aria-describedby={rowError ? errorId : undefined}
                  placeholder="What you did, and the outcome if you can evidence it"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-0.5 shrink-0 px-2"
                  aria-label={`Remove bullet ${index + 1}`}
                  onClick={() =>
                    form.setValue(
                      "bullets",
                      bullets.filter((_, i) => i !== index),
                      { shouldDirty: true, shouldValidate: true },
                    )
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
        id="bullets-error"
        message={typeof error?.message === "string" ? error.message : undefined}
      />
    </div>
  );
}
