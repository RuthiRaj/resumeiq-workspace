"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  CornerUpLeft,
  Link2,
  Paperclip,
  Plus,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EvidenceBadge } from "@/components/domain/evidence-badge";
import { Label } from "@/components/ui/field";
import { sectionMeta } from "@/features/workspace/sections";
import { cn } from "@/lib/utils";
import {
  UNCERTAIN_CONFIDENCE,
  evidenceForReviewItem,
  reviewFieldPolicy,
  reviewItemProblem,
  uncertainFields,
  type ExtractedField,
  type ImportReviewItem,
} from "@/lib/schemas";

/**
 * One extracted item awaiting a decision (PRD §6.2 IM-2/IM-3).
 *
 * The card is honest about its own origin: it carries an unconditional
 * "Sample" tag, because in this build the extractor is simulated and the fields
 * shown are sample data — nothing was read from the user's file. Which fields
 * are editable is decided per section by `reviewFieldPolicy`: a personal detail
 * shows a name and a location, a skill shows nothing but its chips, and only
 * sections that can actually carry a document offer the certificate control.
 *
 * Every field the parser was unsure about (confidence below
 * `UNCERTAIN_CONFIDENCE`) is highlighted and linked to the line of the preview
 * it came from, and the card states what confirming will record: *User-attested*
 * by default, *Verified* once supporting evidence is attached.
 */
export function ReviewItemCard({
  item,
  busy = false,
  savedMessage,
  error,
  onSaveValues,
  onConfirm,
  onReject,
  onUndo,
}: {
  item: ImportReviewItem;
  busy?: boolean;
  savedMessage?: string | null;
  error?: string | null;
  onSaveValues: (item: ImportReviewItem) => void;
  onConfirm: (item: ImportReviewItem) => void;
  onReject: (item: ImportReviewItem) => void;
  onUndo: (item: ImportReviewItem) => void;
}) {
  // Local state owns the inputs, so a server round trip never steals focus
  // mid-keystroke (the parent keys this card by item id).
  const [values, setValues] = useState(item.values);
  const [linkDraft, setLinkDraft] = useState(
    item.support?.kind === "link" ? item.support.url : "",
  );

  const meta = sectionMeta(item.extraction.section);
  const policy = reviewFieldPolicy(item.extraction.section);
  const uncertain = uncertainFields(item);
  const uncertainKeys = new Set(uncertain.map((field: ExtractedField) => field.key));
  const evidence = evidenceForReviewItem(item);
  const problem = reviewItemProblem({ ...item, values });
  const decided = item.status !== "pending";

  function commit(next: typeof values) {
    setValues(next);
    onSaveValues({ ...item, values: next });
  }

  function attachLink() {
    const url = linkDraft.trim();
    if (!url) return;
    applySupport({ kind: "link", url });
  }

  /** Attaching evidence never confirms the item — it only changes the state. */
  function applySupport(support: ImportReviewItem["support"]) {
    onSaveValues({ ...item, values, support });
  }

  const sourceLineOf = (key: ExtractedField["key"]) =>
    item.extraction.fields.find((field) => field.key === key)?.sourceLine;

  return (
    <article
      aria-labelledby={`review-${item.id}-title`}
      data-testid={`review-item-${item.id}`}
      data-section={item.extraction.section}
      data-status={item.status}
      className={cn(
        "glass flex flex-col gap-4 rounded-md p-4",
        item.status === "confirmed" && "border-l-2 border-evidence-verified",
        item.status === "rejected" && "border-l-2 border-evidence-missing opacity-70",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{meta.label}</Badge>
            {/* Unconditional: this field never came from the user's file. */}
            <Badge variant="related" data-testid={`sample-tag-${item.id}`}>
              Sample
            </Badge>
            <Badge
              variant={item.extraction.confidence < UNCERTAIN_CONFIDENCE ? "related" : "default"}
            >
              {Math.round(item.extraction.confidence * 100)}% confidence
            </Badge>
            <EvidenceBadge state={evidence} />
          </div>
          <h3
            id={`review-${item.id}-title`}
            className="truncate text-sm font-medium text-text"
          >
            {values.title || "Untitled extraction"}
          </h3>
        </div>
        {item.status === "confirmed" ? (
          <Badge variant="verified">
            <Check className="size-3" aria-hidden="true" />
            In your workspace
          </Badge>
        ) : item.status === "rejected" ? (
          <Badge variant="missing">
            <X className="size-3" aria-hidden="true" />
            Not imported
          </Badge>
        ) : null}
      </header>

      {uncertain.length > 0 ? (
        <p className="flex items-start gap-2 rounded-sm bg-evidence-related/10 px-2 py-1.5 text-xs text-evidence-related">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {uncertain.length} field{uncertain.length === 1 ? "" : "s"} below{" "}
            {Math.round(UNCERTAIN_CONFIDENCE * 100)}% confidence — check{" "}
            {uncertain.map((field) => `“${field.label}”`).join(", ")} against the
            document before confirming.
          </span>
        </p>
      ) : null}

      {policy.skillChips ? (
        <SkillChips
          id={`${item.id}-skills`}
          chips={values.tags}
          disabled={decided}
          onChange={(chips) => commit({ ...values, tags: chips })}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {policy.titleLabel ? (
            <FieldRow
              id={`${item.id}-title`}
              label={policy.titleLabel}
              uncertain={uncertainKeys.has("title")}
              sourceLine={sourceLineOf("title")}
            >
              <Input
                id={`${item.id}-title`}
                value={values.title}
                disabled={decided}
                data-testid={`value-title-${item.id}`}
                onChange={(event) => setValues({ ...values, title: event.target.value })}
                onBlur={() => commit(values)}
              />
            </FieldRow>
          ) : null}

          {policy.organizationLabel ? (
            <FieldRow
              id={`${item.id}-organization`}
              label={policy.organizationLabel}
              uncertain={uncertainKeys.has("organization")}
              sourceLine={sourceLineOf("organization")}
            >
              <Input
                id={`${item.id}-organization`}
                value={values.organization}
                disabled={decided}
                onChange={(event) =>
                  setValues({ ...values, organization: event.target.value })
                }
                onBlur={() => commit(values)}
              />
            </FieldRow>
          ) : null}

          {policy.dateMode === "range" ? (
            <>
              <FieldRow
                id={`${item.id}-startDate`}
                label="Start (month)"
                uncertain={uncertainKeys.has("startDate")}
                sourceLine={sourceLineOf("startDate")}
              >
                <Input
                  id={`${item.id}-startDate`}
                  type="month"
                  value={values.startDate}
                  disabled={decided}
                  onChange={(event) =>
                    setValues({ ...values, startDate: event.target.value })
                  }
                  onBlur={() => commit(values)}
                />
              </FieldRow>
              <FieldRow
                id={`${item.id}-endDate`}
                label="End (month)"
                uncertain={uncertainKeys.has("endDate")}
                sourceLine={sourceLineOf("endDate")}
              >
                <Input
                  id={`${item.id}-endDate`}
                  type="month"
                  value={values.endDate}
                  disabled={decided}
                  onChange={(event) =>
                    setValues({ ...values, endDate: event.target.value })
                  }
                  onBlur={() => commit(values)}
                />
              </FieldRow>
            </>
          ) : null}

          {policy.dateMode === "issued" ? (
            <FieldRow
              id={`${item.id}-endDate`}
              label="Issued (month)"
              uncertain={uncertainKeys.has("endDate")}
              sourceLine={sourceLineOf("endDate")}
            >
              <Input
                id={`${item.id}-endDate`}
                type="month"
                value={values.endDate}
                disabled={decided}
                onChange={(event) =>
                  setValues({ ...values, endDate: event.target.value })
                }
                onBlur={() => commit(values)}
              />
            </FieldRow>
          ) : null}

          {policy.location ? (
            <FieldRow
              id={`${item.id}-location`}
              label="Location"
              uncertain={uncertainKeys.has("location")}
              sourceLine={sourceLineOf("location")}
            >
              <Input
                id={`${item.id}-location`}
                value={values.location}
                disabled={decided}
                onChange={(event) => setValues({ ...values, location: event.target.value })}
                onBlur={() => commit(values)}
              />
            </FieldRow>
          ) : null}
        </div>
      )}

      {policy.bullets && item.extraction.bullets.length > 0 ? (
        <FieldRow id={`${item.id}-bullets`} label="Detail lines">
          <textarea
            id={`${item.id}-bullets`}
            rows={Math.min(6, item.extraction.bullets.length + 1)}
            value={values.bullets.join("\n")}
            disabled={decided}
            className="w-full rounded-sm border border-white/[0.08] bg-elevated px-3 py-2 text-sm text-text focus-visible:outline-accent-cyan disabled:opacity-50"
            onChange={(event) =>
              setValues({ ...values, bullets: event.target.value.split("\n") })
            }
            onBlur={() => commit(values)}
          />
        </FieldRow>
      ) : null}

      {policy.keywords && item.extraction.tags.length > 0 ? (
        <FieldRow id={`${item.id}-tags`} label="Detected keywords">
          <Input
            id={`${item.id}-tags`}
            value={values.tags.join(", ")}
            disabled={decided}
            onChange={(event) =>
              setValues({
                ...values,
                tags: event.target.value.split(",").map((tag) => tag.trim()),
              })
            }
            onBlur={() => commit(values)}
          />
        </FieldRow>
      ) : null}

      {/* IM-3: a supporting document or link upgrades the confirm to Verified. */}
      {policy.supportLabel ? (
        <div className="flex flex-col gap-2 rounded-sm border border-white/[0.08] p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="size-3.5 text-accent-cyan" aria-hidden="true" />
            {evidence === "verified"
              ? `Supporting evidence is attached, so confirming records this as Verified.`
              : `Attach a ${policy.supportLabel} to record this as Verified — without one it is User-attested.`}
          </p>
          {item.support ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="verified">
                {item.support.kind === "file" ? item.support.name : item.support.url}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                disabled={decided || busy}
                onClick={() => applySupport(null)}
              >
                Remove evidence
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${item.id}-link`} className="text-xs">
                  Supporting link
                </Label>
                <Input
                  id={`${item.id}-link`}
                  value={linkDraft}
                  placeholder="https://…"
                  disabled={decided}
                  data-testid={`support-link-${item.id}`}
                  onChange={(event) => setLinkDraft(event.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={decided || busy || linkDraft.trim().length === 0}
                data-testid={`attach-link-${item.id}`}
                onClick={attachLink}
              >
                <Link2 className="size-3.5" aria-hidden="true" />
                Attach link
              </Button>
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-xs text-text hover:bg-white/[0.06]">
                <Paperclip className="size-3.5" aria-hidden="true" />
                Attach file
                <input
                  type="file"
                  className="sr-only"
                  disabled={decided}
                  data-testid={`support-file-${item.id}`}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) applySupport({ kind: "file", name: file.name });
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2">
        {item.status === "pending" ? (
          <>
            <Button
              size="sm"
              disabled={busy || problem !== null}
              aria-describedby={problem ? `review-${item.id}-problem` : undefined}
              data-testid={`confirm-${item.id}`}
              onClick={() => onConfirm({ ...item, values })}
            >
              <Check className="size-3.5" aria-hidden="true" />
              Confirm and add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              data-testid={`reject-${item.id}`}
              onClick={() => onReject({ ...item, values })}
            >
              <X className="size-3.5" aria-hidden="true" />
              Reject
            </Button>
            <Link
              href={`/workspace/${item.extraction.section}`}
              className="text-xs text-muted underline-offset-4 hover:text-text hover:underline"
            >
              Add manually instead
            </Link>
          </>
        ) : item.status === "rejected" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            data-testid={`undo-${item.id}`}
            onClick={() => onUndo({ ...item, values })}
          >
            <CornerUpLeft className="size-3.5" aria-hidden="true" />
            Put back for review
          </Button>
        ) : (
          <Link
            href={`/workspace/${item.extraction.section}`}
            className="text-xs text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Open it in your workspace
          </Link>
        )}

        {problem ? (
          <p
            id={`review-${item.id}-problem`}
            role="alert"
            className="text-xs text-evidence-missing"
          >
            {problem}
          </p>
        ) : null}
        {savedMessage ? (
          <span role="status" className="text-xs text-evidence-verified">
            {savedMessage}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-evidence-missing">
            {error}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * Skills are reviewed as removable chips rather than a comma-separated string:
 * each chip is one skill, Enter or comma adds one, Backspace removes the last,
 * and every change is saved. Local draft state keeps the input focused while
 * typing (PRD §7.7).
 */
function SkillChips({
  id,
  chips,
  disabled,
  onChange,
}: {
  id: string;
  chips: string[];
  disabled?: boolean;
  onChange: (chips: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const exists = chips.some((chip) => chip.toLowerCase() === value.toLowerCase());
    if (!exists) onChange([...chips, value]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && chips.length > 0) {
      onChange(chips.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`skills-${id}`}>
      <Label htmlFor={id} className="text-xs">
        Skills
      </Label>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Extracted skills">
          {chips.map((chip, index) => (
            <li key={`${chip}-${index}`}>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs text-text">
                {chip}
                <button
                  type="button"
                  aria-label={`Remove skill ${chip}`}
                  disabled={disabled}
                  className="rounded-full p-0.5 text-muted hover:text-text disabled:opacity-50"
                  onClick={() => onChange(chips.filter((_, i) => i !== index))}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-evidence-related">
          No skills left — add at least one before confirming.
        </p>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder="Add a skill and press Enter"
          aria-label="Add a skill"
          data-testid="skill-input"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || draft.trim().length === 0}
          onClick={() => add(draft)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  id,
  label,
  uncertain = false,
  sourceLine,
  children,
}: {
  id: string;
  label: string;
  uncertain?: boolean;
  sourceLine?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-sm",
        uncertain && "bg-evidence-related/[0.06] p-1.5 ring-1 ring-evidence-related/30",
      )}
      data-uncertain={uncertain ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {uncertain ? (
          <span className="flex items-center gap-1 text-[11px] text-evidence-related">
            <TriangleAlert className="size-3" aria-hidden="true" />
            Check this
          </span>
        ) : null}
        {sourceLine ? (
          <a
            href={`#preview-line-${sourceLine}`}
            className="text-[11px] text-muted underline-offset-4 hover:text-text hover:underline"
          >
            from line {sourceLine}
          </a>
        ) : null}
      </div>
      {children}
    </div>
  );
}
