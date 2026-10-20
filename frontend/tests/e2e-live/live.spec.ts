import { expect, test } from "@playwright/test";

/**
 * Live-mode smoke (I1), opt-in and skipped by default.
 *
 * Requires a real Supabase account plus the backend and frontend running in
 * live mode. See frontend/README.md ("Live mode") for the variable names and
 * commands. Never put credentials in this file.
 */
const email = process.env.LIVE_E2E_EMAIL;
const password = process.env.LIVE_E2E_PASSWORD;

test.describe("live mode", () => {
  test.skip(
    process.env.RUN_LIVE_E2E !== "1" || !email || !password,
    "Set RUN_LIVE_E2E=1, LIVE_E2E_EMAIL and LIVE_E2E_PASSWORD to run the live smoke test.",
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
    await expect(
      page.getByRole("heading", { name: "Your workspace" }),
    ).toBeVisible({ timeout: 60_000 });
  });
});
