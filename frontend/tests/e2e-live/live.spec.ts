import { expect, test } from "@playwright/test";

import { liveE2eCredentials, liveE2eEnabled } from "./backend-env";

/**
 * Live-mode smoke (I1), opt-in and skipped by default.
 *
 * Requires a real Supabase account plus the backend and frontend running in
 * live mode. The gate and user A credentials are read from
 * `backend/.env.test` (`RUN_LIVE_E2E`, `SUPABASE_TEST_EMAIL_A`,
 * `SUPABASE_TEST_PASSWORD_A`); exported `LIVE_E2E_*` values still override
 * them. See frontend/README.md ("Live mode"). Never put credentials in this
 * file.
 */
const { email, password } = liveE2eCredentials();

test.describe("live mode", () => {
  test.skip(
    !liveE2eEnabled() || !email || !password,
    "Set RUN_LIVE_E2E=1 and user A credentials in backend/.env.test to run the live smoke test.",
  );

  test("signs in with Supabase and loads the workspace from FastAPI", async ({
    page,
  }) => {
    await page.goto("/signin");
    // Mock-only OAuth buttons must not appear in live mode.
    await expect(page.getByRole("button", { name: /continue with google/i })).toHaveCount(0);

    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/workspace/, { timeout: 60_000 });
    // `exact` matters: the empty-state heading also starts with "Your workspace".
    await expect(
      page.getByRole("heading", { name: "Your workspace", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
