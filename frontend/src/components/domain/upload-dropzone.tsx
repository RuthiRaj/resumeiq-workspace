"use client";

import { useId, useRef, useState } from "react";
import { FileUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  IMPORT_ACCEPT,
  validateImportUpload,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Upload dropzone (PRD §7.6). Drag-and-drop *and* a real, keyboard-reachable
 * file input — the drop target never replaces the accessible control. Type and
 * size limits are checked here and again on the server; a rejected file always
 * says why.
 */
export function UploadDropzone({
  onFile,
  onReject,
  accept = IMPORT_ACCEPT,
  limits = "PDF or DOCX · up to 5 MB",
  busy = false,
  disabled = false,
  className,
}: {
  onFile: (file: File) => void;
  onReject?: (reason: string) => void;
  accept?: string;
  limits?: string;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function acceptFile(file: File | undefined | null) {
    if (!file) return;
    const check = validateImportUpload({ name: file.name, size: file.size });
    if (!check.ok) {
      onReject?.(check.reason);
      return;
    }
    onFile(file);
  }

  const blocked = busy || disabled;

  return (
    <div
      className={cn(
        "glass flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition-colors sm:p-8",
        dragging ? "border-accent-cyan/70 bg-accent-cyan/[0.06]" : "border-white/[0.12]",
        blocked && "opacity-70",
        className,
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (!blocked) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (blocked) return;
        acceptFile(event.dataTransfer.files?.[0]);
      }}
      data-testid="upload-dropzone"
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full border border-white/[0.12] bg-elevated"
      >
        <FileUp className="size-5 text-accent-cyan" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text">
          {busy ? "Working on your document…" : "Drop a document here"}
        </p>
        <p id={hintId} className="text-xs text-muted">
          {limits} · nothing is saved until you confirm each item
        </p>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        aria-describedby={hintId}
        disabled={blocked}
        data-testid="upload-input"
        onChange={(event) => {
          acceptFile(event.target.files?.[0]);
          // Allow re-selecting the same file after a failed attempt.
          event.target.value = "";
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={blocked}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-3.5" aria-hidden="true" />
        Choose a file
      </Button>
    </div>
  );
}
