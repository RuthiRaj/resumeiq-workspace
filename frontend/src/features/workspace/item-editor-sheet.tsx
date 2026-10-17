"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  WorkspaceItemFormSchema,
  type WorkspaceItem,
  type WorkspaceItemFormValues,
  type WorkspaceSection,
} from "@/lib/schemas";
import { sectionMeta } from "./sections";
import {
  toCreatePayload,
  toItemPatch,
} from "./workspace-utils";
import { useCreateItem, useUpdateItem } from "./use-workspace";
import { BulletsEditor } from "./bullets-editor";
import { LinksEditor } from "./links-editor";
import { TagsEditor } from "./tags-editor";
import { AttachmentsEditor } from "./attachments-editor";
import { EvidenceSelector } from "./evidence-selector";
import { SaveStatusIndicator, type SaveStatus } from "./save-status";
import { Button } from "@/components/ui/button";
import { FieldError, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/features/ui/toast-store";

const AUTOSAVE_DELAY = 700;

function emptyValues(): WorkspaceItemFormValues {
  return {
    title: "",
    organization: "",
    startDate: "",
    endDate: "",
    location: "",
    bullets: [""],
    tags: [],
    links: [],
    attachments: [],
    evidence: "attested",
  };
}

function toFormValues(item: WorkspaceItem): WorkspaceItemFormValues {
  return {
    title: item.title,
    organization: item.organization ?? "",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    location: item.location ?? "",
    bullets: item.bullets,
    tags: item.tags,
    links: item.links,
    attachments: item.attachments,
    evidence: item.evidence,
  };
}

/**
 * Add/edit an item in a bottom-sheet (mobile) / side-sheet (desktop).
 *
 *  - React Hook Form + Zod (`WorkspaceItemFormSchema`) with inline validation.
 *  - Editing an existing item autosaves after a short pause and shows a live
 *    status ("Unsaved changes" → "Saving…" → "Saved at 10:24:03").
 *  - Creating uses an explicit Save (so we don't create an item mid-keystroke).
 *  - Closing with unsaved changes asks before discarding.
 *  - Inputs are registered (uncontrolled), so focus is never lost while typing.
 */
export function ItemEditorSheet({
  section,
  item,
  open,
  onOpenChange,
}: {
  section: WorkspaceSection;
  item: WorkspaceItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = sectionMeta(section);
  const mode: "create" | "edit" = item ? "edit" : "create";
  const createItem = useCreateItem();
  const updateItem = useUpdateItem();

  const form = useForm<WorkspaceItemFormValues>({
    resolver: zodResolver(WorkspaceItemFormSchema),
    defaultValues: emptyValues(),
    mode: "onBlur",
  });

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const modeRef = useRef(mode);
  const itemIdRef = useRef<string | null>(item?.id ?? null);
  modeRef.current = mode;
  itemIdRef.current = item?.id ?? null;
  const saveTimer = useRef<number | undefined>(undefined);
  /**
   * Serialised values as last persisted (or as loaded). The autosave watcher
   * compares against it instead of RHF's `isDirty` flag, because RHF has no
   * "saved" concept: after a successful save the form is still dirty relative
   * to its original defaults, which would re-save the same values forever.
   */
  const savedSnapshot = useRef<string | null>(null);

  // (Re)initialise the form whenever the sheet opens or a different item loads.
  useEffect(() => {
    if (!open) return;
    form.reset(item ? toFormValues(item) : emptyValues());
    savedSnapshot.current = JSON.stringify(form.getValues());
    setStatus(item ? "saved" : "idle");
    setSavedAt(undefined);
    setErrorMessage(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  const save = useRef<() => Promise<void>>(async () => {});
  save.current = async () => {
    const valid = await form.trigger();
    if (!valid) {
      setStatus("error");
      setErrorMessage("Fix the highlighted fields, then it saves automatically.");
      return;
    }
    const values = form.getValues();
    const sent = JSON.stringify(values);
    setErrorMessage(undefined);
    setStatus("saving");
    try {
      if (modeRef.current === "create") {
        await createItem.mutateAsync(toCreatePayload(section, values));
        toast({
          tone: "success",
          title: `${meta.singular.charAt(0).toUpperCase()}${meta.singular.slice(1)} added`,
          description: `“${values.title.trim()}” is in your workspace.`,
        });
        onOpenChange(false);
        return;
      }
      await updateItem.mutateAsync({
        id: itemIdRef.current as string,
        patch: toItemPatch(values),
      });
      // Only clear the unsaved flag if nothing changed while the save was in flight.
      savedSnapshot.current = sent;
      if (JSON.stringify(form.getValues()) === sent) {
        setStatus("saved");
        setSavedAt(new Date().toISOString());
      } else {
        setStatus("dirty");
        void save.current();
      }
    } catch {
      setStatus("error");
      setErrorMessage(
        "Couldn’t save your changes. They’re still here — try Save now.",
      );
    }
  };

  // Subscribe (without re-rendering) to edits; debounce an autosave in edit mode.
  useEffect(() => {
    if (!open) return;
    // React Compiler can't memoize RHF's `watch` subscription API; that's the
    // documented way to react to field changes without re-rendering the form.
    // eslint-disable-next-line react-hooks/incompatible-library
    const subscription = form.watch((values) => {
      // Compare by value, not by event type: `setValue` — used by the bullet,
      // link, tag, attachment and evidence editors — notifies watchers without
      // a `type`, so filtering on `type === "change"` never autosaved those
      // edits and one invalid intermediate value (a half-typed URL, say) would
      // strand the editor in its error state with no further retry.
      if (JSON.stringify(values) === savedSnapshot.current) return;
      setStatus("dirty");
      setErrorMessage(undefined);
      if (modeRef.current !== "edit") return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void save.current();
      }, AUTOSAVE_DELAY);
    });
    return () => {
      subscription.unsubscribe();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [form, open]);

  function requestOpenChange(next: boolean) {
    if (!next && (status === "dirty" || status === "saving" || status === "error")) {
      setConfirmOpen(true);
      return;
    }
    onOpenChange(next);
  }

  const evidenceError = form.formState.errors.evidence?.message;

  return (
    <>
      <Sheet open={open} onOpenChange={requestOpenChange}>
        <SheetContent
          aria-label={`${mode === "create" ? "Add" : "Edit"} ${meta.singular}`}
          className="flex flex-col sm:w-[32rem]"
        >
          <SheetHeader>
            <SheetTitle>
              {mode === "create" ? `Add ${meta.singular}` : `Edit ${meta.singular}`}
            </SheetTitle>
            <SheetDescription>{meta.description}</SheetDescription>
          </SheetHeader>

          <form
            className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save.current();
            }}
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="item-title">Title</Label>
              <Input
                id="item-title"
                data-field="title"
                {...form.register("title")}
                aria-invalid={form.formState.errors.title ? true : undefined}
                aria-describedby={form.formState.errors.title ? "title-error" : undefined}
                placeholder={meta.singular === "skill" ? "e.g. TypeScript" : "e.g. your role or project name"}
              />
              <FieldError id="title-error" message={form.formState.errors.title?.message} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-organization">Organisation</Label>
                <Input
                  id="item-organization"
                  data-field="organization"
                  {...form.register("organization")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-location">Location</Label>
                <Input id="item-location" data-field="location" {...form.register("location")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-start">Start date</Label>
                <Input id="item-start" data-field="startDate" type="month" {...form.register("startDate")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="item-end">End date</Label>
                <Input id="item-end" data-field="endDate" type="month" {...form.register("endDate")} />
                <FieldError id="end-error" message={form.formState.errors.endDate?.message} />
              </div>
            </div>

            <EvidenceSelector
              value={form.watch("evidence")}
              onChange={(next) =>
                form.setValue("evidence", next, { shouldDirty: true, shouldValidate: true })
              }
              error={evidenceError}
              invalid={Boolean(evidenceError)}
            />

            <BulletsEditor form={form} />

            <TagsEditor form={form} />

            <LinksEditor form={form} />

            <AttachmentsEditor
              value={form.watch("attachments")}
              onChange={(next) => {
                form.setValue("attachments", next, { shouldDirty: true, shouldValidate: true });
                // Attachment presence also governs the "Verified" rule.
                void form.trigger("evidence");
              }}
            />

            <div className="mt-auto flex flex-col gap-3 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center sm:justify-between">
              <SaveStatusIndicator
                status={status}
                savedAt={savedAt}
                errorMessage={errorMessage}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => requestOpenChange(false)}
                >
                  Close
                </Button>
                <Button type="submit" size="sm" disabled={status === "saving"} aria-busy={status === "saving"}>
                  {mode === "create" ? "Save item" : "Save now"}
                </Button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent aria-label="Discard unsaved changes">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This item has changes that haven’t been saved yet. Discarding keeps the last saved
              version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
