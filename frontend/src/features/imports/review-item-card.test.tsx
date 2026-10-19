import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImportReviewItem } from "@/lib/schemas";
import { buildImportSession } from "@/mocks/import-fixtures";
import { ReviewItemCard } from "./review-item-card";

/**
 * Per-section review fields (PRD §6.1 WS-3, §6.2 IM-2).
 *
 * The review screen must only offer the fields a section can actually hold: a
 * personal detail has no organisation, no dates and no certificate control; a
 * skills card is nothing but chips. Showing the full field set everywhere would
 * invite users to type information that cannot be stored or evidenced.
 */

afterEach(cleanup);

function session(fileName = "resume.pdf") {
  return buildImportSession({
    id: "imp-1",
    fileName,
    fileType: fileName.endsWith(".docx") ? "docx" : "pdf",
    fileSize: 200_000,
    now: "2026-10-18T09:00:00.000Z",
  });
}

function card(
  section: ImportReviewItem["extraction"]["section"],
  fileName = "resume.pdf",
) {
  const item = session(fileName).items.find(
    (entry) => entry.extraction.section === section,
  );
  if (!item) throw new Error(`No sample item for section ${section}`);
  const onSaveValues = vi.fn();
  render(
    <ReviewItemCard
      item={item}
      onSaveValues={onSaveValues}
      onConfirm={vi.fn()}
      onReject={vi.fn()}
      onUndo={vi.fn()}
    />,
  );
  return { item, onSaveValues };
}

describe("ReviewItemCard — sample honesty", () => {
  it("tags every card and every field group as sample data", () => {
    card("personal");
    expect(screen.getByTestId("sample-tag-ext-personal")).toHaveTextContent("Sample");
  });
});

describe("ReviewItemCard — fields per section", () => {
  it("shows only name and location on personal details", () => {
    card("personal");
    expect(screen.getByLabelText("Full name")).toBeTruthy();
    expect(screen.getByLabelText("Location")).toBeTruthy();
    expect(screen.queryByLabelText("Organisation")).toBeNull();
    expect(screen.queryByLabelText("Institution")).toBeNull();
    expect(screen.queryByLabelText("Start (month)")).toBeNull();
    expect(screen.queryByLabelText("End (month)")).toBeNull();
    expect(screen.queryByLabelText("Issued (month)")).toBeNull();
    // No certificate control on a personal detail.
    expect(screen.queryByLabelText("Supporting link")).toBeNull();
    expect(screen.queryByText(/Verified/)).toBeNull();
  });

  it("shows a skills card as chips, with no organisation, dates or certificate", () => {
    const { item } = card("skill");
    expect(screen.getByRole("list", { name: "Extracted skills" })).toBeTruthy();
    for (const skill of item.values.tags) {
      expect(screen.getByText(skill)).toBeTruthy();
    }
    expect(screen.queryByLabelText("Full name")).toBeNull();
    expect(screen.queryByLabelText("Start (month)")).toBeNull();
    expect(screen.queryByLabelText("Supporting link")).toBeNull();
    expect(screen.queryByRole("button", { name: /Attach file/ })).toBeNull();
  });

  it("keeps employer and dates on an internship", () => {
    card("internship");
    expect(screen.getByLabelText("Role")).toBeTruthy();
    expect(screen.getByLabelText("Employer")).toBeTruthy();
    expect(screen.getByLabelText("Start (month)")).toBeTruthy();
    expect(screen.getByLabelText("End (month)")).toBeTruthy();
    expect(screen.getByLabelText("Supporting link")).toBeTruthy();
  });

  it("gives a certificate a single issued date instead of a range", () => {
    card("certificate", "my-certificate.pdf");
    expect(screen.getByLabelText("Issued (month)")).toBeTruthy();
    expect(screen.queryByLabelText("Start (month)")).toBeNull();
    expect(screen.queryByLabelText("End (month)")).toBeNull();
  });

  it("adds a skill chip without losing the others", () => {
    const { onSaveValues } = card("skill");
    const input = screen.getByTestId("skill-input");
    fireEvent.change(input, { target: { value: "Node.js" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSaveValues).toHaveBeenCalled();
    const saved = onSaveValues.mock.calls.at(-1)?.[0] as ImportReviewItem;
    expect(saved.values.tags).toContain("Node.js");
  });
});
