import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth-guard";

/**
 * S-06: the server always renders the guard while the session is unresolved,
 * but the client can resolve a persisted session before hydration finishes.
 * If the first client render already shows the authenticated shell, React
 * regenerates the tree and reports a hydration mismatch. The first client
 * render must therefore match the server: the skeleton, then the children.
 */
const auth = vi.hoisted(() => ({
  status: "loading" as "loading" | "authenticated" | "unauthenticated",
}));

vi.mock("@/lib/auth/context", () => ({
  useAuth: () => ({ status: auth.status }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/workspace/skill",
  useSearchParams: () => new URLSearchParams(),
}));

const tree = (
  <AuthGuard>
    <p>Signed-in workspace</p>
  </AuthGuard>
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthGuard hydration", () => {
  it("renders the server skeleton during hydration, then the session", async () => {
    auth.status = "loading";
    const serverHtml = renderToString(tree);
    expect(serverHtml).toContain("Checking your session");

    // Simulate Supabase resolving the persisted session before hydration.
    auth.status = "authenticated";

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    // React routes hydration mismatches through onRecoverableError. An empty
    // list means the first client render matched the server HTML.
    const recoverable: string[] = [];

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree, {
        onRecoverableError: (error) => recoverable.push(String(error)),
      });
    });

    expect(recoverable.join("\n")).not.toMatch(/hydrat/i);
    expect(container.textContent).toContain("Signed-in workspace");

    root?.unmount();
    container.remove();
  });
});
