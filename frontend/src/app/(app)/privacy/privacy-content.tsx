"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Download,
  FileDown,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/features/ui/toast-store";
import { api, apiErrorMessage } from "@/lib/api";
import { dataExportFilename, downloadJson } from "@/lib/export/download";
import { ErrorState } from "@/components/domain/error-state";
import {
  ACCOUNT_DELETION_PHRASE,
  ACCOUNT_DELETION_REMAINING,
  ACCOUNT_DELETION_SCOPE,
  deletionCountsSummary,
  describeDeletionResult,
  isDeletionPhraseConfirmed,
  type DeletionOutcome,
} from "@/lib/privacy/deletion";
import { useCapabilities } from "@/lib/privacy/use-capabilities";
import { useConsent, useRecordConsent } from "@/lib/privacy/use-consent";
import type { AccountDeletionResult } from "@/lib/schemas";

/**
 * `/privacy` (PRD §6.9 EX-2/EX-3, B6).
 *
 * Everything here is driven by the server: capabilities decide which controls
 * exist, the consent record decides whether AI work may run, and the deletion
 * result states honestly whether the auth identity was removed. No screen
 * claims a provider, retention period or deletion outcome the backend did not
 * report.
 */

function CapabilityRow({
  icon: Icon,
  title,
  state,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  state: "on" | "off" | "unknown";
  description: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-sm border border-white/[0.06] p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-accent-cyan" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-text">{title}</p>
          <Badge variant={state === "on" ? "verified" : "outline"}>
            {state === "on" ? "Available" : state === "off" ? "Unavailable" : "Not checked"}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
      </div>
    </li>
  );
}

function ConsentSection() {
  const consent = useConsent();
  const record = useRecordConsent();
  const value = consent.data?.consent ?? null;

  function update(aiProcessing: boolean) {
    record.mutate(aiProcessing, {
      onSuccess: (result) => {
        toast({
          tone: "success",
          title: aiProcessing ? "AI processing allowed" : "AI processing declined",
          description: aiProcessing
            ? "Optional AI features may now run. You can withdraw this at any time."
            : "No AI feature will run. Deterministic generation still works.",
        });
        if (!aiProcessing && result.consent.aiProcessing) {
          // Defensive: a declined choice must never read back as granted.
          toast({
            tone: "error",
            title: "Consent did not change",
            description: "Reload and try again before running any analysis.",
          });
        }
      },
      onError: (error) => {
        toast({
          tone: "error",
          title: "Consent was not saved",
          description: apiErrorMessage(
            error,
            "Nothing changed. Check your connection and try again.",
          ),
        });
      },
    });
  }

  return (
    <section
      aria-labelledby="consent-heading"
      className="glass flex flex-col gap-3 rounded-md p-4 sm:p-6"
      data-testid="privacy-consent"
    >
      <div>
        <h2 id="consent-heading" className="flex items-center gap-2 text-base font-medium">
          <ShieldCheck className="size-4 text-evidence-verified" aria-hidden="true" />
          AI-processing consent
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
          Optional AI features send only the text they need (a bullet line with
          its cited workspace item) to the configured provider. Nothing is sent
          until you allow it. Withdrawing consent stops every future AI call;
          deterministic generation and editing stay available.
        </p>
      </div>

      {consent.isLoading ? (
        <div role="status" aria-busy="true" aria-label="Loading consent" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : consent.isError ? (
        <ErrorState
          title="Your consent record could not be loaded"
          description="AI features stay off until it can be checked."
          onRetry={() => void consent.refetch()}
          retrying={consent.isFetching}
          method="GET"
          path="/api/v1/privacy/consent"
          error={consent.error}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs text-muted" role="status">
            {value
              ? `Recorded ${value.recordedAt.slice(0, 10)} · ${value.aiProcessing ? "allowed" : "declined"} · v${value.version}`
              : "No consent recorded yet."}
          </p>
          {value ? (
            <p className="text-xs leading-relaxed text-muted">
              Provider recorded with your consent:{" "}
              <span className="text-text">{value.provider}</span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => update(true)}
              disabled={record.isPending}
              aria-busy={record.isPending && record.variables === true}
              data-testid="consent-allow"
            >
              {record.isPending && record.variables === true ? "Saving…" : "Allow AI processing"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => update(false)}
              disabled={record.isPending}
              aria-busy={record.isPending && record.variables === false}
              data-testid="consent-decline"
            >
              {record.isPending && record.variables === false ? "Saving…" : "Decline / withdraw"}
            </Button>
          </div>
          {record.isError ? (
            <ErrorState
              title="Your consent choice was not saved"
              description={apiErrorMessage(record.error, "Please try again.")}
              onRetry={() => void record.mutate(record.variables as boolean)}
              retrying={record.isPending}
              method="POST"
              path="/api/v1/privacy/consent"
              error={record.error}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function AiDisclosureSection() {
  const capabilities = useCapabilities();
  const { ai } = capabilities;

  return (
    <section aria-labelledby="ai-disclosure-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="ai-disclosure-heading" className="flex items-center gap-2 text-base font-medium">
        <Bot className="size-4 text-accent-violet" aria-hidden="true" />
        AI features and provider disclosure
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        The server publishes feature switches only. It never sends a provider
        name, model, endpoint or key to this page, so we show exactly what it
        reports instead of guessing.
      </p>
      {capabilities.isLoading ? (
        <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          <CapabilityRow
            icon={Bot}
            title="AI provider configured"
            state={ai.configured ? "on" : "off"}
            description={
              ai.configured
                ? "An AI provider is configured for this deployment. The server does not disclose which one through capabilities; ask the operator for the provider and its data-handling terms."
                : "No AI provider is configured. AI-derived wording and enrichment are unavailable."
            }
          />
          <CapabilityRow
            icon={Bot}
            title="Resume rewording"
            state={ai.resumeRewording && ai.configured ? "on" : "off"}
            description="Optional presentation-only rewording of individual bullets, checked against the cited evidence."
          />
          <CapabilityRow
            icon={Bot}
            title="Analysis enrichment"
            state={ai.analysisEnrichment && ai.configured ? "on" : "off"}
            description="Optional AI notes on a finished analysis report. Scores and evidence never depend on it."
          />
        </ul>
      )}
      {capabilities.isError ? (
        <ErrorState
          title="Capabilities could not be checked"
          description="Every optional feature is treated as unavailable. Retry to check again."
          onRetry={() => void capabilities.refetch()}
          retrying={capabilities.isFetching}
          method="GET"
          path="/api/v1/capabilities"
          error={capabilities.error}
        />
      ) : null}
    </section>
  );
}

function DataExportSection() {
  const capabilities = useCapabilities();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState<string | null>(null);

  async function exportData() {
    setWorking(true);
    setError(null);
    try {
      const data = await api.exportData();
      downloadJson(data, dataExportFilename(data.exportedAt));
      setExportedAt(data.exportedAt);
      toast({
        tone: "success",
        title: "Data export downloaded",
        description: "The JSON file contains every stored record this account owns.",
      });
    } catch (cause) {
      setError(
        apiErrorMessage(
          cause,
          "Your data export could not be read right now. Nothing was changed; try again.",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section aria-labelledby="export-heading" className="glass rounded-md p-4 sm:p-6">
      <h2 id="export-heading" className="flex items-center gap-2 text-base font-medium">
        <FileDown className="size-4 text-accent-cyan" aria-hidden="true" />
        Export my data
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        Download one JSON file with your workspace items, change log, job
        targets, analyses, resumes, versions, claims, imports and consent
        records as stored. The file is generated on the server and is never
        emailed or shared.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => void exportData()}
          disabled={working || capabilities.isLoading || !capabilities.dataExport}
          aria-busy={working}
          data-testid="privacy-export-button"
        >
          {working ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          {working ? "Preparing export…" : "Download JSON export"}
        </Button>
        {!capabilities.isLoading && !capabilities.dataExport ? (
          <p className="text-xs text-muted">
            {capabilities.isError
              ? "Capabilities could not be checked, so export is treated as unavailable."
              : "This server does not offer a data export yet."}
          </p>
        ) : null}
      </div>
      {exportedAt ? (
        <p role="status" className="mt-3 text-xs text-evidence-verified">
          Export generated at {new Date(exportedAt).toLocaleString()}. Check your
          downloads folder.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs text-evidence-missing" data-testid="export-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function AccountDeletionSection() {
  const capabilities = useCapabilities();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);
  const outcome: DeletionOutcome | null = useMemo(
    () => (result ? describeDeletionResult(result) : null),
    [result],
  );

  const canDelete = capabilities.accountDeletion.dataDeletion;
  const confirmed = isDeletionPhraseConfirmed(phrase);

  async function remove() {
    if (!confirmed || working) return;
    setWorking(true);
    setError(null);
    try {
      const deleted = await api.deleteAccount(ACCOUNT_DELETION_PHRASE);
      setResult(deleted);
      setPhrase("");
      setOpen(false);
      const described = describeDeletionResult(deleted);
      toast({
        tone: described.authPending ? "info" : "success",
        title: described.title,
        description: described.description,
      });
    } catch (cause) {
      setError(
        apiErrorMessage(
          cause,
          "Account data deletion is unavailable right now. Nothing was deleted.",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      aria-labelledby="delete-account-heading"
      className="glass rounded-md border-l-2 border-evidence-missing/60 p-4 sm:p-6"
      data-testid="privacy-account"
    >
      <h2 id="delete-account-heading" className="flex items-center gap-2 text-base font-medium">
        <Trash2 className="size-4 text-evidence-missing" aria-hidden="true" />
        Delete my account data
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
        This permanently deletes the data this account owns. It does not remove
        your sign-in identity: Supabase has no self-service auth-user deletion
        for a normal access token, so the operator completes that step. You stay
        signed in with an empty workspace.
      </p>

      {result && outcome ? (
        <div
          className="mt-4 rounded-sm border border-white/[0.08] p-3"
          data-testid="deletion-result"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-text">
            <CheckCircle2 className="size-4 text-evidence-verified" aria-hidden="true" />
            {outcome.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{outcome.description}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {deletionCountsSummary(result.deletedCounts)}
          </p>
          {outcome.authPending ? (
            <p className="mt-2 text-xs leading-relaxed text-evidence-related">
              Remaining step: {ACCOUNT_DELETION_REMAINING[0]}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="danger"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={!canDelete || capabilities.isLoading || working}
          data-testid="privacy-delete-account"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete account data…
        </Button>
        {!capabilities.isLoading && !canDelete ? (
          <p className="text-xs text-muted">
            {capabilities.isError
              ? "Capabilities could not be checked, so deletion is treated as unavailable."
              : "This server does not offer account-data deletion yet."}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-evidence-missing">
          {error}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (working) return;
          setOpen(next);
          if (!next) setPhrase("");
        }}
      >
        <DialogContent data-testid="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>Delete every stored record?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Type the phrase below to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-text">What is deleted now</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-muted">
              {ACCOUNT_DELETION_SCOPE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs font-medium text-text">What is not deleted</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-relaxed text-muted">
              {ACCOUNT_DELETION_REMAINING.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-account-confirmation">
              Type <span className="font-mono">{ACCOUNT_DELETION_PHRASE}</span> to confirm
            </Label>
            <Input
              id="delete-account-confirmation"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={working}
              aria-describedby="delete-account-hint"
              data-testid="delete-account-confirmation"
            />
            <p id="delete-account-hint" className="text-[11px] text-muted">
              The phrase is case-sensitive here so a stray autocapitalised paste
              cannot arm the button.
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-evidence-missing">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setPhrase("");
              }}
              disabled={working}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => void remove()}
              disabled={!confirmed || working}
              aria-busy={working}
              data-testid="confirm-delete-account"
            >
              {working ? "Deleting…" : "Delete my data permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function PrivacyContent() {
  return (
    <div className="flex flex-col gap-5" data-testid="privacy-centre">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Your data</p>
        <h1 className="font-display text-3xl tracking-tight">Privacy centre</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          What leaves this browser, what the server can do, and how to take your
          data with you or remove it. Every statement below comes from the
          server&apos;s own capabilities and deletion responses.
        </p>
      </header>

      <ConsentSection />
      <AiDisclosureSection />
      <DataExportSection />
      <AccountDeletionSection />

      <section aria-labelledby="retention-heading" className="glass rounded-md p-4 sm:p-6">
        <h2 id="retention-heading" className="text-base font-medium">
          What is kept, and for how long
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Workspace items, targets, analyses, resumes, versions, claims and
            imports stay until you delete them. Nothing expires or is pruned on a
            timer.
          </li>
          <li>
            A workspace item you delete is soft-deleted: it leaves the resume and
            analysis inputs immediately but remains restorable until you remove it
            permanently. Resumes that cited it are flagged and can be purged.
          </li>
          <li>
            A purge rewrites every version in place to drop claims whose source is
            gone. Surviving wording is copied verbatim; no new fact is invented.
          </li>
          <li>
            Account-data deletion removes every public row immediately. The
            sign-in identity (email and password hash) is a separate operator step;
            this page says so rather than claiming a complete account deletion.
          </li>
          <li>
            Resume presentation preferences are stored in this browser only and
            are removed when you clear site data or use the reset control.
          </li>
        </ul>
      </section>
    </div>
  );
}
