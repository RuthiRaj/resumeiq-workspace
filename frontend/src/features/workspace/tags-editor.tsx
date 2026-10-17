"use client";

import { useState, type KeyboardEvent } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { WorkspaceItemFormValues } from "@/lib/schemas";

/**
 * Tags editor (PRD §6.1 WS-3). The text input keeps its own local state, so
 * each keystroke re-renders only this component — an important part of "typing
 * never loses focus" (PRD §7.7).
 */
export function TagsEditor({ form }: { form: UseFormReturn<WorkspaceItemFormValues> }) {
  const tags = form.watch("tags");
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const exists = tags.some((tag) => tag.toLowerCase() === value.toLowerCase());
    if (!exists) {
      form.setValue("tags", [...tags, value], { shouldDirty: true, shouldValidate: true });
    }
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      form.setValue("tags", tags.slice(0, -1), { shouldDirty: true, shouldValidate: true });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Tag className="size-4 text-muted" aria-hidden="true" /> Tags
      </span>
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Current tags">
          {tags.map((tag, index) => (
            <li key={`${tag}-${index}`}>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs text-text">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="rounded-full p-0.5 text-muted hover:text-text"
                  onClick={() =>
                    form.setValue(
                      "tags",
                      tags.filter((_, i) => i !== index),
                      { shouldDirty: true, shouldValidate: true },
                    )
                  }
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        data-field="tag"
        aria-label="Add a tag"
        placeholder="Type a tag and press Enter"
      />
      <p className="text-xs text-muted">Separate keywords like “typescript”, “react”, “open source”.</p>
    </div>
  );
}
