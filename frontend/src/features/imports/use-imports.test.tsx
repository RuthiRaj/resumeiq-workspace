import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportReviewItem } from "@/lib/schemas";
import { useSaveImportValues } from "./use-imports";

/**
 * Regression coverage for the import review save path (PRD §6.2 IM-2/IM-3).
 *
 * Attaching a certificate link or file goes through the same "save values"
 * mutation as editing a field, so that mutation must persist `support`. The
 * first cut sent only `values`: the card showed "Verified" while the server
 * still held `support: null`, and confirming recorded the item as
 * User-attested. The E2E caught it; this test keeps it caught locally.
 */

const mocks = vi.hoisted(() => ({
  updateImportItem: vi.fn<
    (
      importId: string,
      itemId: string,
      patch: Record<string, unknown>,
    ) => Promise<unknown>
  >(async () => ({})),
}));

vi.mock("@/lib/api", () => ({
  api: { updateImportItem: mocks.updateImportItem },
}));

const item: ImportReviewItem = {
  id: "ext-internship",
  extraction: {
    id: "ext-internship",
    section: "internship",
    fields: [
      {
        key: "title",
        label: "Role",
        value: "Backend Intern",
        confidence: 0.94,
        sourceLine: 5,
      },
    ],
    bullets: [],
    tags: [],
    confidence: 0.94,
  },
  values: {
    title: "Backend Intern",
    organization: "Example Payments Ltd",
    startDate: "2024-06",
    endDate: "2024-09",
    location: "",
    bullets: [],
    tags: [],
  },
  status: "pending",
  support: null,
  decidedAt: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSaveImportValues", () => {
  beforeEach(() => {
    mocks.updateImportItem.mockClear();
  });

  it("persists an attached certificate link with the reviewed values", async () => {
    const { result } = renderHook(() => useSaveImportValues("imp-1"), { wrapper });
    const support = {
      kind: "link" as const,
      url: "https://example.com/credentials/abc",
    };

    await result.current.mutateAsync({ ...item, support });

    expect(mocks.updateImportItem).toHaveBeenCalledWith(
      "imp-1",
      "ext-internship",
      { values: item.values, support },
    );
  });

  it("keeps a null support explicit instead of dropping the field", async () => {
    const { result } = renderHook(() => useSaveImportValues("imp-1"), { wrapper });

    await result.current.mutateAsync({
      ...item,
      values: { ...item.values, title: "Backend Engineer Intern" },
    });

    expect(mocks.updateImportItem).toHaveBeenCalledWith(
      "imp-1",
      "ext-internship",
      {
        values: { ...item.values, title: "Backend Engineer Intern" },
        support: null,
      },
    );
  });
});
