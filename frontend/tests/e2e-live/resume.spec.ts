import { expect, test } from "@playwright/test";

import { liveE2eCredentials, liveE2eEnabled } from "./backend-env";

/**
 * Opt-in live B5 smoke for F5 (not part of `npm run e2e`).
 *
 * Requires `RUN_LIVE_E2E=1`, user A credentials in `backend/.env.test`, a live
 * backend with the B5 resume routes merged, and no real AI call. The spec is
 * deliberately read-only: it opens the standard resume and the history list,
 * proves `GET /api/v1/resumes` works and that the standard snapshot is present,
 * and never generates, edits, refreshes or restores anything.
 *
 * Before B5 merges, `master` has no `/api/v1/resumes` route and this spec fails
 * with the history error state. That is expected; see
 * `docs/api/f5-resume-contract-gaps.md`.
 */
const { email, password } = liveE2eCredentials();

async function signInAsUserA(page: import("@playwright/test").Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/workspace/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("live resume studio (B5)", () => {
  test.skip(
    !liveE2eEnabled() || !email || !password,
    "Set RUN_LIVE_E2E=1 and user A credentials in backend/.env.test to run the live resume smoke.",
  );

  test("standard resume and history list load through B5", async ({ page }) => {
    await signInAsUserA(page);

    // B1 alias still serves the derived standard resume.
    await page.goto("/resume");
    await expect(
      page.getByRole("heading", { name: "Standard resume", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // This is the first B5 read. A 404 (B5 not merged) renders the error state
    // instead of the heading, so the failure is unambiguous.
    await page.goto("/history");
    await expect(
      page.getByRole("heading", { name: "History", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("heading", { name: "Standard resume", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("resume-history")).toBeVisible();

    // The derived standard resume is always first in `GET /resumes`; tailored
    // snapshots (when this account has any) are listed below it. No writes.
    const isB5Error = await page
      .getByText("Resume history could not load")
      .isVisible();
    expect(isB5Error, "B5 resume routes are missing from the live backend").toBe(
      false,
    );
  });
});
