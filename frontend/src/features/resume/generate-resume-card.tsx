"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Label } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StaleBadge } from "@/components/domain/sync-indicator";
import { toast } from "@/features/ui/toast-store";
import { apiErrorMessage } from "@/lib/api";
import { useResumeForTarget, useGenerateResume, useAiRewordAvailability } from "./use-resume";
import type { JobTarget } from "@/lib/schemas";

/**
 * The finished-report call to action (F5). Generation is deterministic and
 * always available after an analysis of the current workspace. AI rewording is
 * a separate, opt-in switch that requires both recorded consent and a
 * configured provider; when either is missing the switch stays disabled and
 * says why, rather than failing after the click.
 */
export function GenerateResumeCard({
  target,
  stale,
}: {
  target: JobTarget;
  stale: boolean;
}) {
  const router = useRouter();
  const existing = useResumeForTarget(target.id);
  const generate = useGenerateResume();
  const ai = useAiRewordAvailability();
  const [open, setOpen] = useState(false);
  const [reword, setReword] = useState(false);
  const [title, setTitle] = useState(
    target.company ? `${target.role} at ${target.company}` : target.role,
  );

  const resume = existing.resume;

  function submit() {
    generate.mutate(
      {
        targetId: target.id,
        input: {
          title: title.trim() || undefined,
          rewordWithAi: reword,
        },
      },
      {
        onSuccess: (created) => {
          setOpen(false);
          toast({
            tone: "success",
            title: "Tailored resume generated",
            description:
              "Every line cites a workspace item. Review the evidence, then edit any wording you want to change.",
          });
          router.push(`/targets/${target.id}/resume?resume=${created.id}`);
        },
      },
    );
  }

  const error = generate.error;
  const errorText = error
    ? apiErrorMessage(
        error,
        "The resume could not be generated. Retry, or re-run the analysis.",
      )
    : null;

  return (
    <section
      className="glass flex flex-col gap-3 rounded-md border-l-2 border-accent-cyan/60 p-4 sm:flex-row sm:items-center sm:justify-between"
      aria-labelledby="tailored-resume-heading"
      data-testid="generate-resume-card"
    >
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-elevated">
          <FileText className="size-4 text-accent-cyan" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="tailored-resume-heading" className="text-sm font-medium text-text">
              {resume ? "Your tailored resume" : "Ready for a tailored resume"}
            </h2>
            {resume ? <Badge variant="outline">Saved snapshot</Badge> : null}
            {resume?.stale ? <StaleBadge /> : null}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {resume
              ? `“${resume.title ?? "Tailored resume"}” was generated from workspace version ${resume.workspaceVersion}. Open it to edit wording, review evidence, or refresh stale sections.`
              : "Selects and orders only the workspace items this posting asks for. It copies your own wording and cites every line; it never invents a role, date, metric or skill."}
          </p>
          {errorText && !open ? (
            <p className="mt-2 text-xs text-evidence-missing" role="alert">
              {errorText}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {resume ? (
          <Link
            href={`/targets/${target.id}/resume?resume=${resume.id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-white/[0.12] px-3 text-xs font-medium text-text hover:bg-white/[0.06] focus-visible:outline-accent-cyan"
          >
            Open tailored resume
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          disabled={stale}
          title={stale ? "Re-run the analysis first" : undefined}
          data-testid="generate-resume"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {resume ? "Generate a new version" : "Generate tailored resume"}
        </Button>
      </div>
      {stale ? (
        <p className="w-full text-xs text-evidence-related sm:text-right">
          Re-run the analysis above before generating; the report is out of date.
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) generate.reset();
        }}
      >
        <DialogContent data-testid="generate-resume-dialog">
          <DialogHeader>
            <DialogTitle>Generate a tailored resume</DialogTitle>
            <DialogDescription>
              Deterministic selection from your workspace, using this
              report&apos;s requirements. Nothing is invented and every line keeps
              its evidence link.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tailored-resume-title">Resume name</Label>
              <Input
                id="tailored-resume-title"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
              <p className="text-xs text-muted">
                Used in History to tell saved versions apart.
              </p>
            </div>

            <div className="rounded-sm border border-white/[0.08] bg-elevated/50 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="reword-with-ai"
                  checked={reword}
                  disabled={!ai.enabled || generate.isPending}
                  onCheckedChange={(checked) => setReword(checked === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label htmlFor="reword-with-ai" className="text-sm">
                    Reword bullets with AI (optional)
                  </Label>
                  <p
                    className="mt-1 text-xs leading-relaxed text-muted"
                    data-testid="ai-reword-explanation"
                  >
                    {ai.loading ? "Checking consent and provider availability…" : ai.reason}
                  </p>
                  {!ai.consentGranted && ai.providerConfigured ? (
                    <Link
                      href="/privacy"
                      className="mt-1 inline-flex text-xs text-accent-cyan underline-offset-4 hover:underline"
                    >
                      Review privacy settings
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>

            {errorText ? (
              <p
                className="rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-2.5 text-xs leading-relaxed text-text"
                role="alert"
                data-testid="generate-resume-error"
              >
                {errorText}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={generate.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={generate.isPending || !title.trim()}
              aria-busy={generate.isPending}
              data-testid="generate-resume-submit"
            >
              {generate.isPending ? "Generating…" : "Generate resume"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
