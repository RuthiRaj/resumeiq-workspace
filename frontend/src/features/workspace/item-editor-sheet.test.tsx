import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkspaceItem } from "@/lib/schemas";
import { ItemEditorSheet } from "./item-editor-sheet";

/**
 * Regression coverage for the autosave trigger (PRD §7.7 "Saving…" → "Saved at").
 *
 * Only the plain inputs (`title`, `organization`, dates…) are `register`ed with
 * React Hook Form. The bullet, link, tag, attachment and evidence editors commit
 * through `form.setValue`, and RHF notifies watchers of those *without* an event
 * `type`. The editor therefore has to diff values rather than look at the event
 * type, otherwise a setValue-driven edit never schedules an autosave at all.
 */

const mocks = vi.hoisted(() => ({
  update: vi.fn<
    (input: { id: string; patch: Partial<WorkspaceItem> }) => Promise<unknown>
  >(async () => ({})),
  create: vi.fn<(input: Omit<WorkspaceItem, "id">) => Promise<unknown>>(
    async () => ({}),
  ),
}));

vi.mock("./use-workspace", () => ({
  useCreateItem: () => ({ mutateAsync: mocks.create }),
  useUpdateItem: () => ({ mutateAsync: mocks.update }),
}));

vi.mock("@/features/ui/toast-store", () => ({ toast: vi.fn() }));

const item: WorkspaceItem = {
  id: "ws-item-project-2-focus-test-item",
  section: "project",
  title: "Focus test item",
  bullets: [],
  tags: [],
  links: [],
  attachments: [],
  evidence: "attested",
  order: 0,
};

function renderSheet() {
  return render(
    <ItemEditorSheet section="project" item={item} open onOpenChange={() => {}} />,
  );
}

/** Let the 700ms autosave debounce elapse and the save promise settle. */
async function settleAutosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900);
  });
}

describe("ItemEditorSheet autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.update.mockClear();
    mocks.create.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not save merely because the sheet opened", async () => {
    renderSheet();
    await settleAutosave();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("autosaves an edit committed through setValue (link editor)", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Link 1"), {
      target: { value: "https://example.com/evidence" },
    });
    await settleAutosave();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).toMatchObject({
      id: item.id,
      patch: { links: ["https://example.com/evidence"] },
    });
  });

  it("autosaves an edit committed through setValue (tag editor)", async () => {
    renderSheet();
    const tag = screen.getByLabelText("Add a tag");
    fireEvent.change(tag, { target: { value: "performance-engineering" } });
    fireEvent.keyDown(tag, { key: "Enter" });
    await settleAutosave();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(/Saved at/);
  });

  it("recovers when an invalid intermediate value is corrected", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const link = screen.getByLabelText("Link 1");

    // A half-typed URL must not strand the editor in its error state.
    fireEvent.change(link, { target: { value: "https:/" } });
    await settleAutosave();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/Fix the highlighted fields/);

    fireEvent.change(link, { target: { value: "https://example.com/a/b" } });
    await settleAutosave();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(/Saved at/);
  });
});
