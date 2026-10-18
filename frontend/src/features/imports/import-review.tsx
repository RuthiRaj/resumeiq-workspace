"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  FileText,
  FileWarning,
  FlaskConical,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/domain/empty-state";
import { ErrorState } from "@/components/domain/error-state";
import { StageProgress } from "@/components/domain/stage-progress";
import { UploadDropzone } from "@/components/domain/upload-dropzone";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/features/ui/toast-store";
import { LinkButton } from "@/components/ui/link-button";
import { ReviewItemCard } from "./review-item-card";
import {
  useConfirmImportItem,
  useDecideImportItem,
  useImportSession,
  useSaveImportValues,
  useUploadImport,
} from "./use-imports";
import {
  DEMO_MODE_COPY,
  IMPORT_LIMITS_COPY,
  UNCERTAIN_CONFIDENCE,
  reviewProgress,
  type ImportReviewItem,
  type ImportSession,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * `/workspace/import` (PRD §6.2 IM-1..IM-3, §7.5).
 *
 * Flow: upload (type + size gated) → staged extraction progress → side-by-side
 * review → per-item confirm/reject. Nothing reaches the workspace until the
 * user confirms an item, and a confirmed item is only *Verified* when a
 * certificate file or link is attached.
 */

const EXTRACTION_STAGES = [
  { key: "uploading", label: "Uploading the document", detail: "Sending the file to the extractor." },
  { key: "reading", label: "Reading the text", detail: "Turning pages into lines." },
  { key: "extracting", label: "Extracting fields", detail: "Pulling out roles, dates and skills." },
  { key: "checking", label: "Checking confidence", detail: "Flagging anything uncertain for you." },
];

export function ImportReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const session = useImportSession(sessionId);
  const upload = useUploadImport();
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const uploading = upload.isPending;

  function handleFile(file: File) {
    setRejectedReason(null);
    setLastFile(file);
    upload.mutate(file, {
      onSuccess: (data) => {
        router.replace(`/workspace/import?session=${data.import.id}`);
      },
    });
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-cyan">
          Import
        </p>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
          Review before anything is saved
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          Upload a resume or certificate and we&apos;ll show the review screen
          you&apos;ll use once extraction is real: the sample source text next to
          the extracted fields. Fields we are unsure about are highlighted, and
          each item is only added to your workspace when you confirm it.
        </p>
        <p className="max-w-prose text-xs text-muted">
          This build has no document parser yet, so the review below runs in
          demo mode — see the banner while a review is open.
        </p>
      </header>

      {uploading ? (
        <ExtractionProgress fileName={lastFile?.name ?? "Your document"} />
      ) : upload.isError ? (
        <ErrorState
          title="We couldn't read that document"
          description={upload.error.message}
          onRetry={lastFile ? () => handleFile(lastFile) : undefined}
          retrying={uploading}
        />
      ) : sessionId ? (
        session.isLoading ? (
          <div
            role="status"
            className="flex flex-col gap-3"
            aria-busy="true"
            aria-label="Loading import"
          >
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : session.isError || !session.data ? (
          <ErrorState
            title="That import isn't available any more"
            description="The review session may have expired. Upload the document again to start a fresh review."
            onRetry={() => router.replace("/workspace/import")}
          />
        ) : (
          <ReviewWorkspace session={session.data} />
        )
      ) : (
        <>
          <UploadDropzone
            onFile={handleFile}
            onReject={setRejectedReason}
            limits={IMPORT_LIMITS_COPY}
            busy={uploading}
          />
          {rejectedReason ? (
            <p role="alert" className="text-sm text-evidence-missing">
              {rejectedReason}
            </p>
          ) : null}
          <div className="glass flex flex-col gap-2 rounded-md p-4">
            <p className="text-sm font-medium">What happens next</p>
            <ol className="flex flex-col gap-1.5 text-sm text-muted">
              <li>
                1. Demo mode: the next screen is filled with clearly-labelled sample
                data — your file is not read in this build.
              </li>
              <li>2. You see the sample text and the extracted fields side by side.</li>
              <li>3. Uncertain fields are highlighted so you can correct them.</li>
              <li>
                4. Each item you confirm becomes User-attested — or Verified if
                you attach supporting evidence.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Staged upload progress. The stages advance on a timer while the upload is in
 * flight; the component only lives while the request is pending, so each upload
 * starts from stage one without any state juggling in the parent.
 */
function ExtractionProgress({ fileName }: { fileName: string }) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStageIndex((index) => Math.min(index + 1, EXTRACTION_STAGES.length - 1));
    }, 450);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section
      aria-label="Extracting your document"
      data-testid="import-extracting"
      className="glass flex flex-col gap-4 rounded-md p-6"
    >
      <div className="flex items-center gap-2 text-sm text-text">
        <FileText className="size-4 text-accent-cyan" aria-hidden="true" />
        {fileName}
      </div>
      <StageProgress
        stages={EXTRACTION_STAGES}
        activeIndex={stageIndex}
        progress={((stageIndex + 1) / EXTRACTION_STAGES.length) * 100}
        label="Extraction progress"
      />
      <p className="text-xs text-muted">
        This is a simulated extractor in this build — no file leaves your browser.
      </p>
    </section>
  );
}

function ReviewWorkspace({ session }: { session: ImportSession }) {
  const saveValues = useSaveImportValues(session.id);
  const decide = useDecideImportItem(session.id);
  const confirm = useConfirmImportItem(session.id);
  const [savedItemId, setSavedItemId] = useState<string | null>(null);

  const progress = reviewProgress(session.items);
  const busy = decide.isPending || confirm.isPending || saveValues.isPending;

  const uncertainLines = useMemo(() => {
    const lines = new Set<number>();
    for (const item of session.items) {
      if (item.status !== "pending") continue;
      for (const field of item.extraction.fields) {
        if (field.confidence < UNCERTAIN_CONFIDENCE) lines.add(field.sourceLine);
      }
    }
    return lines;
  }, [session.items]);

  function flashSaved(itemId: string) {
    setSavedItemId(itemId);
    window.setTimeout(() => setSavedItemId(null), 2000);
  }

  function handleSaveValues(item: ImportReviewItem) {
    saveValues.mutate(item, {
      onSuccess: () => flashSaved(item.id),
      onError: (error) =>
        toast({
          title: "Couldn't save that edit",
          description: error.message,
          tone: "error",
        }),
    });
  }

  function handleConfirm(item: ImportReviewItem) {
    confirm.mutate(item, {
      onSuccess: (created) => {
        const count = created.length;
        toast({
          title:
            count === 1
              ? `${created[0]?.title ?? "That item"} added to your workspace`
              : `${count} skills added to your workspace`,
          description: "Recorded as evidence you can use in a resume.",
          tone: "success",
        });
      },
      onError: (error) =>
        toast({
          title: "Couldn't add that item",
          description: error.message,
          tone: "error",
        }),
    });
  }

  function handleReject(item: ImportReviewItem) {
    decide.mutate(
      { item, status: "rejected" },
      {
        onSuccess: () =>
          toast({
            title: `${item.values.title || "That item"} wasn't imported`,
            description: "You can put it back for review at any time.",
            tone: "info",
          }),
        onError: (error) =>
          toast({ title: "Couldn't reject that item", description: error.message, tone: "error" }),
      },
    );
  }

  function handleUndo(item: ImportReviewItem) {
    decide.mutate({ item, status: "pending" });
  }

  const complete = progress.pending === 0 && progress.total > 0;

  return (
    <div className="flex flex-col gap-5" data-testid="import-review">
      <div
        role="status"
        data-testid="demo-mode-banner"
        className="flex items-start gap-3 rounded-md border border-evidence-related/50 bg-evidence-related/10 p-4"
      >
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-evidence-related" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-text">
            {DEMO_MODE_COPY}
          </p>
          <p className="text-xs text-muted">
            There is no parser in this build yet. Every card below is sample
            content, tagged “Sample”, so you can see how the review works. Nothing
            is taken from the document you selected, and nothing is saved until
            you confirm a card.
          </p>
        </div>
      </div>

      <section className="glass flex flex-col gap-3 rounded-md p-4" aria-labelledby="review-summary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="review-summary" className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4 text-accent-cyan" aria-hidden="true" />
              <span className="truncate">{session.fileName}</span>
            </h2>
            <p className="text-xs text-muted">
              {session.items.length} sample items · preview is simulated, not your file
            </p>
          </div>
          <div className="flex items-center gap-2" data-testid="review-progress">
            <Badge variant="verified">{progress.confirmed} confirmed</Badge>
            <Badge variant="outline">{progress.pending} pending</Badge>
            <Badge variant="missing">{progress.rejected} rejected</Badge>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Items reviewed"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.confirmed + progress.rejected}
          className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        >
          <div
            className="h-full rounded-full bg-accent-cyan transition-[width]"
            style={{
              width: `${progress.total === 0 ? 0 : ((progress.confirmed + progress.rejected) / progress.total) * 100}%`,
            }}
          />
        </div>
      </section>

      {complete ? (
        <section
          data-testid="import-complete"
          className="glass flex flex-col gap-3 rounded-md border-l-2 border-evidence-verified p-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="size-4 text-evidence-verified" aria-hidden="true" />
            Review finished
          </h2>
          <p className="text-sm text-muted">
            {progress.confirmed} item{progress.confirmed === 1 ? "" : "s"} added to
            your workspace
            {progress.rejected > 0
              ? `, ${progress.rejected} left out`
              : ""} — every added item is either User-attested or Verified.
          </p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/workspace" size="sm" variant="secondary">
              Open your workspace
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </LinkButton>
            <LinkButton href="/targets/new" size="sm" variant="secondary">
              Analyse a job next
            </LinkButton>
            <LinkButton href="/workspace/import" size="sm" variant="ghost">
              Import another document
            </LinkButton>
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        <SourcePreview session={session} uncertainLines={uncertainLines} />
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">
            Extracted items — nothing is saved until you confirm
          </h2>
          {session.items.length === 0 ? (
            <EmptyState
              icon={FileWarning}
              title="Nothing could be read from this document"
              description="The extractor found no text to work with. Scanned pages need OCR, which isn't part of this build yet."
            >
              <LinkButton href="/workspace/import" size="sm" variant="secondary">
                Try another file
              </LinkButton>
            </EmptyState>
          ) : (
            session.items.map((item) => (
              <ReviewItemCard
                key={item.id}
                item={item}
                busy={busy}
                savedMessage={savedItemId === item.id ? "Saved" : null}
                onSaveValues={handleSaveValues}
                onConfirm={handleConfirm}
                onReject={handleReject}
                onUndo={handleUndo}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SourcePreview({
  session,
  uncertainLines,
}: {
  session: ImportSession;
  uncertainLines: Set<number>;
}) {
  const lines = session.sourceText.split("\n");
  return (
    <section
      aria-labelledby="source-preview-title"
      className="glass flex h-fit flex-col gap-3 rounded-md p-4 lg:sticky lg:top-4"
      data-testid="source-preview"
    >
      <div className="flex flex-col gap-1">
        <h2 id="source-preview-title" className="text-sm font-medium">
          Sample source text
        </h2>
        <p className="text-xs text-muted">
          {session.fileType.toUpperCase()} · {session.pageCount} page · simulated
          sample text — not the contents of your file
        </p>
      </div>
      {session.previewAvailable ? (
        <pre className="max-h-[60vh] overflow-auto rounded-sm bg-black/30 p-3 text-xs leading-relaxed text-muted">
          <code>
            {lines.map((line, index) => {
              const number = index + 1;
              const flagged = uncertainLines.has(number);
              return (
                <span
                  key={number}
                  id={`preview-line-${number}`}
                  className={cn(
                    "flex gap-3 rounded-sm px-1",
                    flagged && "bg-evidence-related/10 text-text",
                  )}
                >
                  <span aria-hidden="true" className="w-5 shrink-0 text-right opacity-50">
                    {number}
                  </span>
                  <span className="whitespace-pre-wrap">{line || " "}</span>
                </span>
              );
            })}
          </code>
        </pre>
      ) : (
        <EmptyState
          icon={FileWarning}
          title="No preview for this format"
          description="The extracted fields are shown on the right; the visual preview is not available for this document."
        />
      )}
      <p className="text-xs text-muted">
        Highlighted lines contain a field we flagged as uncertain.
      </p>
    </section>
  );
}
