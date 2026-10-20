"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, Label } from "@/components/ui/field";
import { Panel } from "@/components/domain/panel";
import { toast } from "@/features/ui/toast-store";
import { ConsentGate } from "./consent-gate";
import { useCreateTarget } from "./use-targets";
import { hasAiConsent, useConsent, useRecordConsent } from "@/lib/privacy/use-consent";
import {
  LENGTH_OPTIONS,
  TEMPLATE_OPTIONS,
  TargetCreateSchema,
  type ResumeTemplate,
  type TargetCreateValues,
  type TargetLength,
} from "@/lib/schemas";
import type { z } from "zod";
import { JOB_DESCRIPTION_FIXTURES } from "@/mocks/analysis-fixtures";
import { cn } from "@/lib/utils";

/** Form input type: fields with schema defaults are optional while editing. */
type TargetFormInput = z.input<typeof TargetCreateSchema>;

/**
 * Target intake (PRD §6.4 JD-1/JD-2).
 *
 * Everything the analysis needs is captured here and validated with the same
 * Zod contract the API uses. The AI-processing consent gate (PRD §6.9 EX-3)
 * stands between "create" and "analyse": pressing the analyse button without
 * consent surfaces the prompt instead of starting anything.
 */
export function TargetForm() {
  const router = useRouter();
  const createTarget = useCreateTarget();
  const consentQuery = useConsent();
  const recordConsent = useRecordConsent();
  const [skillDraft, setSkillDraft] = useState("");
  const [showGate, setShowGate] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Values waiting on the consent decision, so nothing is created twice. */
  const [pendingValues, setPendingValues] = useState<TargetCreateValues | null>(null);

  const form = useForm<TargetFormInput, unknown, TargetCreateValues>({
    resolver: zodResolver(TargetCreateSchema),
    defaultValues: {
      role: "",
      company: "",
      jobDescription: "",
      requiredSkills: [],
      template: "precision",
      length: "one_page",
    },
    mode: "onBlur",
  });
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = form;

  // `useWatch` (not `watch()`) keeps the React Compiler able to memoise this
  // component — `watch()` is explicitly incompatible with it.
  const skills = useWatch({ control, name: "requiredSkills" }) ?? [];
  const template = useWatch({ control, name: "template" }) ?? "precision";
  const length = useWatch({ control, name: "length" }) ?? "one_page";
  const jobDescription = useWatch({ control, name: "jobDescription" }) ?? "";
  const consentGranted = hasAiConsent(consentQuery.data?.consent);

  function addSkill() {
    const value = skillDraft.trim();
    if (!value) return;
    if (skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    setValue("requiredSkills", [...skills, value], { shouldValidate: true });
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    setValue(
      "requiredSkills",
      skills.filter((entry) => entry !== skill),
      { shouldValidate: true },
    );
  }

  function loadFixture(id: string) {
    const fixture = JOB_DESCRIPTION_FIXTURES.find((entry) => entry.id === id);
    if (!fixture) return;
    setValue("role", fixture.role, { shouldValidate: true });
    setValue("company", fixture.company, { shouldValidate: true });
    setValue("jobDescription", fixture.jobDescription, { shouldValidate: true });
    setValue("requiredSkills", fixture.requiredSkills, { shouldValidate: true });
    setValue("template", fixture.template);
    setValue("length", fixture.length);
  }

  function saveToTargets(values: TargetCreateValues, message: string) {
    createTarget.mutate(values, {
      onSuccess: (target) => {
        toast({ tone: "success", title: message, description: target.role });
        router.push(`/targets/${target.id}`);
      },
      onError: (error) => setSubmitError(error.message),
    });
  }

  function createAndAnalyse(values: TargetCreateValues) {
    setSubmitError(null);
    // The consent lookup can still be in flight. Opening the gate now would
    // ask for consent that may already be recorded (S-09).
    if (consentQuery.isLoading) {
      setSubmitError("We're still checking your AI-processing consent. Try again in a moment.");
      return;
    }
    if (consentQuery.isError) {
      setSubmitError(
        "We couldn't check your AI-processing consent. Check your connection and try again.",
      );
      return;
    }
    if (!consentGranted) {
      setPendingValues(values);
      setShowGate(true);
      return;
    }
    saveToTargets(values, "Target created — analysis starting");
  }

  const submitAnalyse = handleSubmit(createAndAnalyse);
  const submitSaveOnly = handleSubmit((values) => {
    setPendingValues(null);
    saveToTargets(values, "Target saved without analysing");
  });

  const busy = isSubmitting || createTarget.isPending;

  return (
    <form className="flex flex-col gap-5" onSubmit={submitAnalyse} noValidate>
      <Panel
        id="target-role-panel"
        title="The role"
        description="Who you're applying to. Everything else is optional — the posting text is what drives the analysis."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-role">Role</Label>
            <Input
              id="target-role"
              placeholder="Senior Frontend Engineer"
              aria-invalid={Boolean(errors.role)}
              aria-describedby={errors.role ? "target-role-error" : undefined}
              data-testid="target-role"
              {...register("role")}
            />
            <FieldError id="target-role-error" message={errors.role?.message} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-company">Company (optional)</Label>
            <Input
              id="target-company"
              placeholder="Halcyon Systems"
              aria-invalid={Boolean(errors.company)}
              aria-describedby={errors.company ? "target-company-error" : undefined}
              data-testid="target-company"
              {...register("company")}
            />
            <FieldError id="target-company-error" message={errors.company?.message} />
          </div>
        </div>
      </Panel>

      <Panel
        id="target-jd-panel"
        title="The job description"
        description="Paste it exactly as it was written. We quote its wording back to you, so we never rephrase what an employer asked for."
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="target-jd">Job description</Label>
            <span className="font-mono text-xs tabular-nums text-muted">
              {jobDescription.length} / 20,000
            </span>
          </div>
          <Textarea
            id="target-jd"
            rows={10}
            placeholder={"Responsibilities\n• …\n\nRequirements\n• …"}
            aria-invalid={Boolean(errors.jobDescription)}
            aria-describedby={errors.jobDescription ? "target-jd-error" : undefined}
            data-testid="target-jd"
            {...register("jobDescription")}
          />
          <FieldError id="target-jd-error" message={errors.jobDescription?.message} />
        </div>

        {process.env.NODE_ENV === "development" ? (
          <details className="rounded-sm border border-white/[0.08] p-3 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 text-muted">
              <Wand2 className="size-3.5 text-accent-cyan" aria-hidden="true" />
              Load a sample posting (development fixtures)
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Three fixed postings for testing: one that matches the mid-level
              workspace well, one that partly matches, and one that mostly
              doesn&apos;t. They are sample job ads — never claims about you.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {JOB_DESCRIPTION_FIXTURES.map((fixture) => (
                <Button
                  key={fixture.id}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="justify-start"
                  data-testid={`load-fixture-${fixture.id}`}
                  onClick={() => loadFixture(fixture.id)}
                >
                  {fixture.label}
                </Button>
              ))}
            </div>
          </details>
        ) : null}
      </Panel>

      <Panel
        id="target-skills-panel"
        title="Required skills"
        description="Optional. Add the skills you know the role demands — they're matched against your workspace like the ones we read from the posting."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {skills.length === 0 ? (
              <p className="text-xs text-muted">No skills added yet.</p>
            ) : (
              skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-1 text-xs text-text"
                >
                  {skill}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted hover:text-text"
                    aria-label={`Remove ${skill}`}
                    onClick={() => removeSkill(skill)}
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="target-skill">Add a skill</Label>
              <Input
                id="target-skill"
                value={skillDraft}
                placeholder="TypeScript"
                maxLength={40}
                data-testid="target-skill-input"
                onChange={(event) => setSkillDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={addSkill}
              disabled={skillDraft.trim().length === 0}
              data-testid="target-skill-add"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add
            </Button>
          </div>
          <FieldError id="target-skills-error" message={errors.requiredSkills?.message} />
        </div>
      </Panel>

      <Panel
        id="target-output-panel"
        title="Output shape"
        description="How the tailored resume should be laid out when the analysis is done."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceGroup
            legend="Template"
            name="template"
            value={template}
            options={TEMPLATE_OPTIONS}
            onChange={(value) => setValue("template", value as ResumeTemplate)}
          />
          <ChoiceGroup
            legend="Length"
            name="length"
            value={length}
            options={LENGTH_OPTIONS}
            onChange={(value) => setValue("length", value as TargetLength)}
          />
        </div>
      </Panel>

      {consentQuery.isSuccess && consentGranted ? (
        <p className="flex items-center gap-2 text-xs text-evidence-verified">
          <Sparkles className="size-3.5" aria-hidden="true" />
          AI-processing consent is recorded. You can change it on the Privacy page.
        </p>
      ) : null}

      {showGate && !consentGranted ? (
        <ConsentGate
          busy={recordConsent.isPending}
          error={recordConsent.isError ? recordConsent.error.message : null}
          onRecord={(accepted) => {
            const values = pendingValues;
            recordConsent.mutate(accepted, {
              onSuccess: () => {
                setPendingValues(null);
                setShowGate(false);
                if (!values) return;
                saveToTargets(
                  values,
                  accepted
                    ? "Target created — analysis starting"
                    : "Target saved without analysing",
                );
              },
              onError: () => setSubmitError("Couldn't record consent. Try again."),
            });
          }}
        />
      ) : null}

      {submitError ? (
        <p role="alert" className="text-sm text-evidence-missing">
          {submitError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy} data-testid="target-submit">
          <Sparkles className="size-3.5" aria-hidden="true" />
          {busy ? "Creating…" : "Create target and analyse"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          data-testid="target-save-only"
          onClick={submitSaveOnly}
        >
          Save without analysing
        </Button>
        {!consentGranted && consentQuery.isSuccess ? (
          <span className="text-xs text-muted">
            Consent is required to analyse — you&apos;ll be asked to confirm.
          </span>
        ) : null}
        {consentQuery.isLoading ? (
          <span role="status" className="text-xs text-muted" data-testid="consent-checking">
            Checking your AI-processing consent…
          </span>
        ) : null}
        {consentQuery.isError ? (
          <span className="text-xs text-evidence-missing">
            Couldn&apos;t check AI-processing consent. Try again in a moment.
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Accessible radio group rendered as segmented buttons (native radios). */
function ChoiceGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer rounded-sm border px-3 py-1.5 text-sm transition-colors",
                selected
                  ? "border-accent-cyan/60 bg-accent-cyan/[0.08] text-text"
                  : "border-white/[0.12] text-muted hover:text-text",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                className="sr-only"
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
