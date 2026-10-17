"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Attachment } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.doc,.docx,.png,.jpg,.jpeg";
const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
]);

interface PendingUpload {
  id: string;
  name: string;
  type: string;
  progress: number;
  error?: string;
}

/** Human file type from MIME or extension (attachments carry no type field yet). */
function describeType(name: string, mime?: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime?.includes("wordprocessingml") || mime === "application/msword") return "DOCX";
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg") return "JPEG";
  const ext = name.split(".").pop()?.toUpperCase();
  return ext && ext.length <= 4 ? ext : "FILE";
}

/**
 * Attachments editor (PRD §6.1 WS-2). Mock upload with visible progress
 * (PRD §7.7: every action gives feedback). Files never leave the browser in
 * F3 — the real upload lands in B1/B7. Attaching a document is what makes an
 * item eligible for the Verified state.
 */
export function AttachmentsEditor({
  value,
  onChange,
}: {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<Attachment[]>(value);
  /** Live upload timers, keyed by upload id. */
  const timers = useRef<Map<string, number>>(new Map());
  /** Progress lives in a ref so the interval's state updater stays pure. */
  const progress = useRef<Map<string, number>>(new Map());
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => window.clearInterval(timer));
      activeTimers.clear();
    };
  }, []);

  function finish(upload: PendingUpload) {
    timers.current.delete(upload.id);
    progress.current.delete(upload.id);
    const attachment: Attachment = {
      id: upload.id,
      name: upload.name,
      url: `mock://${upload.id}`,
    };
    setPending((current) => current.filter((item) => item.id !== upload.id));
    // Never append the same upload twice (a re-entrant finish must be a no-op).
    if (valueRef.current.some((item) => item.id === attachment.id)) return;
    valueRef.current = [...valueRef.current, attachment];
    onChange(valueRef.current);
  }

  function startUpload(file: File) {
    const id = `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const upload: PendingUpload = {
      id,
      name: file.name,
      type: describeType(file.name, file.type),
      progress: 0,
    };
    progress.current.set(id, 0);
    setPending((current) => [...current, upload]);
    const timer = window.setInterval(() => {
      const next = Math.min(100, (progress.current.get(id) ?? 0) + 12);
      progress.current.set(id, next);
      if (next >= 100) {
        // Finish from the timer callback, never from inside a state updater:
        // StrictMode double-invokes updaters, which appended the file twice and
        // produced a duplicate-key warning.
        window.clearInterval(timer);
        finish({ ...upload, progress: 100 });
        return;
      }
      setPending((current) =>
        current.map((item) => (item.id === id ? { ...item, progress: next } : item)),
      );
    }, 90);
    timers.current.set(id, timer);
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setError(`“${file.name}” is larger than 10 MB.`);
        continue;
      }
      if (file.type && !ALLOWED.has(file.type)) {
        setError(`“${file.name}” is not a PDF, DOC/DOCX or image.`);
        continue;
      }
      startUpload(file);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-sm font-medium text-text">
        <Paperclip className="size-4 text-muted" aria-hidden="true" /> Attachments
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        data-testid="attachment-input"
        className="sr-only"
        aria-label="Attach a document"
        onChange={(event) => onFiles(event.target.files)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="self-start"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" aria-hidden="true" /> Attach document
      </Button>

      {pending.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Uploading attachments">
          {pending.map((upload) => (
            <li
              key={upload.id}
              data-testid="attachment-pending"
              className="rounded-sm border border-white/[0.08] bg-elevated p-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-text">{upload.name}</span>
                <span className="shrink-0 font-mono text-muted">{upload.progress}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={`Uploading ${upload.name}`}
                aria-valuenow={upload.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]"
              >
                <span
                  className="block h-full bg-accent-cyan transition-[width] duration-100"
                  style={{ width: `${upload.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {value.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Attached documents">
          {value.map((attachment) => (
            <li
              key={attachment.id}
              data-testid="attachment-item"
              className="flex items-center gap-2 rounded-sm border border-white/[0.08] bg-elevated px-2.5 py-1.5 text-xs"
            >
              <Paperclip className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-text">{attachment.name}</span>
              <span
                data-testid="attachment-type"
                className={cn(
                  "shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-muted",
                )}
              >
                {describeType(attachment.name)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                className="shrink-0 rounded p-0.5 text-muted hover:text-text"
                onClick={() => {
                  const next = valueRef.current.filter((item) => item.id !== attachment.id);
                  valueRef.current = next;
                  onChange(next);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : pending.length === 0 ? (
        <p className="text-xs text-muted">
          Attach the certificate, offer letter or transcript. Documents stay in your browser in this
          build.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-evidence-missing">
          <Trash className="size-3.5" aria-hidden="true" /> {error}
        </p>
      ) : null}
    </div>
  );
}
