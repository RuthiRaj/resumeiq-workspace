"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage, ApiError } from "@/lib/api";
import type { Claim, Resume, ResumeSection, WorkspaceItem } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { sectionLabel } from "./resume-preferences";
import { EvidenceChip } from "./evidence-sheet";
import { useEditResumeSection } from "./use-resume";
import { toast } from "@/features/ui/toast-store";

interface DraftClaim {
  uid: string;
  text: string;
  evidenceIds: string[];
  confirmed: boolean;
  aiRewritten: boolean;
  removed: boolean;
}

function toDraft(sectionKey: string, claims: Claim[]): DraftClaim[] {
  return claims.map((claim, index) => ({
    uid: `${sectionKey}-${index}`,
    text: claim.text,
    evidenceIds: [...claim.evidenceIds],
    confirmed: claim.confirmed,
    aiRewritten: claim.aiRewritten,
    removed: claim.removed,
  }));
}

function sectionSignature(resume: Resume, section: ResumeSection): string {
  return JSON.stringify({
    updatedAt: resume.updatedAt,
    claims: section.claims.map((claim) => [
      claim.text,
      claim.evidenceIds,
      claim.removed,
      claim.aiRewritten,
    ]),
  });
}

function payload(drafts: DraftClaim[]) {
  return drafts.map((draft) => ({
    text: draft.text,
    evidenceIds: draft.evidenceIds,
  }));
}

function samePayload(drafts: DraftClaim[], claims: Claim[]): boolean {
  return JSON.stringify(payload(drafts)) === JSON.stringify(payload(toDraft("", claims)));
}

/** One editable resume section. Drafts are local until Save succeeds. */
function EditableSection({
  resume,
  section,
  items,
  onOpenEvidence,
}: {
  resume: Resume;
  section: ResumeSection;
  items: WorkspaceItem[];
  onOpenEvidence: (itemId: string) => void;
}) {
  const edit = useEditResumeSection(resume.id);
  const signature = sectionSignature(resume, section);
  const [draftState, setDraftState] = useState(() => ({
    signature,
    drafts: toDraft(section.key, section.claims),
  }));
  const [errorState, setErrorState] = useState<{
    signature: string;
    error: ApiError | Error;
  } | null>(null);

  // Derive from the server copy when it changed, without a setState-in-effect
  // cascade. A background refetch with identical content keeps the local draft
  // (and the caret) exactly where it is.
  const drafts =
    draftState.signature === signature
      ? draftState.drafts
      : toDraft(section.key, section.claims);
  const error =
    errorState?.signature === signature ? errorState.error : null;

  function setDrafts(
    updater: DraftClaim[] | ((current: DraftClaim[]) => DraftClaim[]),
  ) {
    setDraftState((current) => {
      const base =
        current.signature === signature
          ? current.drafts
          : toDraft(section.key, section.claims);
      return {
        signature,
        drafts:
          typeof updater === "function" ? updater(base) : updater,
      };
    });
  }

  function setError(next: ApiError | Error | null) {
    setErrorState(next ? { signature, error: next } : null);
  }

  const itemsById = useMemo(
    () => new Map(items.filter((item) => !item.deletedAt).map((item) => [item.id, item])),
    [items],
  );
  const activeOptions = useMemo(
    () =>
      items
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.section.localeCompare(b.section) || a.order - b.order),
    [items],
  );
  const dirty = !samePayload(drafts, section.claims);
  const edited = resume.editedSections.includes(section.key);
  const errorCode = error instanceof ApiError ? error.code : undefined;
  const errorText = error
    ? apiErrorMessage(
        error,
        "The section could not be saved. Your text is still here.",
      )
    : null;

  function updateDraft(uid: string, patch: Partial<DraftClaim>) {
    setDrafts((current) =>
      current.map((draft) => (draft.uid === uid ? { ...draft, ...patch } : draft)),
    );
  }

  function addLine() {
    setDrafts((current) => [
      ...current,
      {
        uid: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text: "",
        evidenceIds: [],
        confirmed: false,
        aiRewritten: false,
        removed: false,
      },
    ]);
  }

  function save() {
    setError(null);
    edit.mutate(
      { sectionKey: section.key, input: { claims: payload(drafts) } },
      {
        onSuccess: () => {
          toast({
            tone: "success",
            title: `${sectionLabel(section.key)} saved`,
            description:
              "The section is now hand-edited. Refresh will leave it alone unless you explicitly choose to overwrite it.",
          });
        },
        onError: (cause) => setError(cause),
      },
    );
  }

  return (
    <section
      className="glass rounded-md p-4"
      aria-labelledby={`studio-section-${section.key}`}
      data-testid={`resume-section-${section.key}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id={`studio-section-${section.key}`}
            className="text-sm font-medium text-text"
          >
            {sectionLabel(section.key)}
          </h2>
          <Badge variant="outline">{section.claims.length} lines</Badge>
          {edited ? <Badge variant="related">Hand-edited</Badge> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={addLine}
            disabled={edit.isPending}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add line
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDrafts(toDraft(section.key, section.claims));
              setError(null);
            }}
            disabled={!dirty || edit.isPending}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || edit.isPending}
            aria-busy={edit.isPending}
            data-testid={`save-section-${section.key}`}
          >
            <Save className="size-3.5" aria-hidden="true" />
            {edit.isPending ? "Saving…" : "Save section"}
          </Button>
        </div>
      </div>

      {errorText ? (
        <div
          role="alert"
          className="mt-3 rounded-sm border-l-2 border-evidence-missing bg-evidence-missing/10 p-3 text-xs leading-relaxed text-text"
          data-testid="section-save-error"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 shrink-0 text-evidence-missing" aria-hidden="true" />
            {errorCode === "resume_claim_ungrounded"
              ? "This line is not grounded in its evidence"
              : errorCode === "resume_evidence_not_found"
                ? "A cited workspace item is gone"
                : "The section was not saved"}
          </div>
          <p className="mt-1">{errorText}</p>
          {errorCode ? (
            <p className="mt-1 font-mono text-[11px] text-muted">{errorCode}</p>
          ) : null}
          <p className="mt-1 text-muted">
            Your text has been kept. Fix the line or cite different evidence, then
            save again.
          </p>
        </div>
      ) : null}

      <ul className="mt-4 flex flex-col gap-3">
        {drafts.map((draft, index) => {
          const cited = draft.evidenceIds.map((id) => ({
            id,
            item: itemsById.get(id),
          }));
          const available = activeOptions.filter(
            (item) => !draft.evidenceIds.includes(item.id),
          );
          return (
            <li
              key={draft.uid}
              className="rounded-sm border border-white/[0.06] bg-elevated/30 p-2.5"
              data-testid={`resume-claim-${section.key}-${index}`}
            >
              <div className="flex items-start gap-2">
                <Textarea
                  aria-label={`${sectionLabel(section.key)} line ${index + 1}`}
                  rows={2}
                  value={draft.text}
                  onChange={(event) =>
                    updateDraft(draft.uid, { text: event.target.value })
                  }
                  className="min-h-14 resize-y"
                  disabled={edit.isPending}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 size-8 shrink-0 px-0 text-muted hover:text-evidence-missing"
                  aria-label={`Remove ${sectionLabel(section.key)} line ${index + 1}`}
                  onClick={() =>
                    setDrafts((current) =>
                      current.filter((entry) => entry.uid !== draft.uid),
                    )
                  }
                  disabled={drafts.length <= 1 || edit.isPending}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {cited.length === 0 ? (
                  <span className="text-[11px] text-evidence-missing">
                    No evidence cited — this line cannot save until it cites a workspace item.
                  </span>
                ) : (
                  cited.map(({ id, item }) => (
                    <EvidenceChip
                      key={id}
                      label={item?.title ?? "Removed source"}
                      state={item?.evidence}
                      removed={!item}
                      onClick={() => onOpenEvidence(id)}
                    />
                  ))
                )}
                {draft.aiRewritten ? (
                  <Badge variant="outline">AI rewording checked</Badge>
                ) : null}
              </div>

              {draft.removed ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-evidence-missing">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  The source item was removed. This line stays visible until you
                  edit or refresh the section.
                </p>
              ) : null}

              {available.length > 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <label
                    htmlFor={`evidence-picker-${draft.uid}`}
                    className="text-[11px] text-muted"
                  >
                    Cite another item
                  </label>
                  <select
                    id={`evidence-picker-${draft.uid}`}
                    aria-label={`Add evidence to ${sectionLabel(section.key)} line ${index + 1}`}
                    value=""
                    onChange={(event) => {
                      const itemId = event.target.value;
                      if (!itemId) return;
                      updateDraft(draft.uid, {
                        evidenceIds: [...draft.evidenceIds, itemId],
                      });
                    }}
                    disabled={edit.isPending}
                    className="h-8 min-w-0 max-w-full rounded-sm border border-white/[0.08] bg-elevated px-2 text-xs text-text focus-visible:outline-accent-cyan"
                  >
                    <option value="">Choose a workspace item…</option>
                    {available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title} · {sectionLabel(item.section)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p
        className={cn(
          "mt-3 text-[11px] leading-relaxed",
          dirty ? "text-evidence-related" : "text-muted",
        )}
      >
        {dirty
          ? "Unsaved changes. Saving records a new immutable version."
          : "Every line must cite an active workspace item; invented facts are rejected."}
      </p>
    </section>
  );
}

/** The editable tailored-resume canvas (one draft per section). */
export function ResumeCanvas({
  resume,
  items,
  onOpenEvidence,
}: {
  resume: Resume;
  items: WorkspaceItem[];
  onOpenEvidence: (itemId: string) => void;
}) {
  if (resume.sections.length === 0) {
    return (
      <p className="glass rounded-md p-4 text-sm text-muted">
        This resume has no sections. Refresh it from the current workspace or
        generate a new version from the report.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="resume-canvas">
      {resume.sections.map((section) => (
        <EditableSection
          key={section.key}
          resume={resume}
          section={section}
          items={items}
          onOpenEvidence={onOpenEvidence}
        />
      ))}
    </div>
  );
}
