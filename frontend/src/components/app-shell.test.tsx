import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

/**
 * S-11: at 360px the fixed bottom navigation was drawn over page content
 * (`/resume` lost its only action, `/targets/new` covered the JD textarea).
 * The navigator must be a layout row below the scrolling content instead of an
 * overlay, so no fixed bar can sit on top of a control.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/resume",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/auth/context", () => ({
  useAuthOptional: () => ({
    user: { id: "user-1", name: "Test User", email: "test@example.com" },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/command-palette", () => ({
  CommandPalette: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("mobile navigation layout", () => {
  it("keeps the bottom navigation out of the content overlay", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(nav.className).not.toMatch(/\bfixed\b/);

    // The navigator and the scrolling region are siblings in the main column:
    // the page scrolls above the bar instead of underneath it.
    const column = nav.parentElement;
    const scrollRegion = nav.previousElementSibling;
    expect(column).not.toBeNull();
    expect(column?.className).toContain("flex-col");
    expect(scrollRegion?.className).toContain("overflow-y-auto");
    expect(scrollRegion).toContainElement(screen.getByRole("main"));
  });
});
