import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDashboard } from "./workspace-dashboard";

/**
 * S-07: the workspace error state pointed at the mock failure toggle in the
 * dev bar. That control does not exist in live mode, so the copy has to tell a
 * live user to check the connection instead.
 */
vi.mock("./use-workspace", () => ({
  useWorkspace: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useChangeLog: () => ({ data: undefined, isLoading: false }),
  useSyncStatus: () => ({ syncing: false, syncedAt: undefined }),
}));

// The sheet and the dev bar need a QueryClient; the error copy does not.
vi.mock("./item-editor-sheet", () => ({
  ItemEditorSheet: () => null,
}));
vi.mock("./dev-bar", () => ({
  WorkspaceDevBar: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("workspace error copy", () => {
  it("does not point live users at the mock dev bar", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    render(<WorkspaceDashboard />);

    expect(screen.getByText("Couldn’t load your workspace")).toBeInTheDocument();
    expect(screen.queryByText(/mock failure toggle/i)).not.toBeInTheDocument();
    expect(screen.getByText(/check your connection/i)).toBeInTheDocument();
  });

  it("keeps the dev-bar hint in mock mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    render(<WorkspaceDashboard />);

    expect(screen.getByText(/mock failure toggle/i)).toBeInTheDocument();
  });
});
