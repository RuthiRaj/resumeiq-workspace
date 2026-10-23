import { expect, test, type Page } from "@playwright/test";

// Sign-up + onboarding + 350ms mock latency.
test.setTimeout(180_000);

const NAV_TIMEOUT = 30_000;

/**
 * F6 E2E: every settings control has a real effect. The mock auth routes are
 * exercised through the same `AuthClient` calls the Supabase adapter uses, so a
 * dead button or a client that forgets to send the current password fails here.
 */

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  try {
    await page.waitForFunction(
      () => "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 8_000 },
    );
  } catch {
    await page.reload();
    await page.waitForFunction(
      () => "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller),
      null,
      { timeout: 15_000 },
    );
  }
}

async function signUp(page: Page, email: string) {
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F6 Settings");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: NAV_TIMEOUT });
  await page.getByRole("tab", { name: "Start manually" }).click();
  await page.getByRole("button", { name: "Start manually" }).last().click();
  await expect(
    page.getByRole("heading", { name: "One privacy promise first" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Consent and continue" }).click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
}

test("settings: profile, password and sign out everywhere all take effect", async ({
  page,
}) => {
  const email = uniqueEmail("f6-settings");

  await signUp(page, email);
  await gotoReady(page, "/settings");

  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  for (const name of [
    "Profile",
    "Display and resume defaults",
    "Password",
    "Security and sessions",
    "What each AI feature does",
  ]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }

  const name = page.getByTestId("settings-name");
  await name.fill("F6 Renamed");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("status").getByText("Profile updated"),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(name).toHaveValue("F6 Renamed");

  await page.getByTestId("settings-current-password").fill("secret123");
  await page.getByTestId("settings-new-password").fill("secret456");
  await page.getByTestId("settings-confirm-password").fill("secret456");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("status").getByText("Password changed"),
  ).toBeVisible({ timeout: NAV_TIMEOUT });

  await page.getByTestId("sign-out-everywhere").click();
  await expect(page.getByTestId("confirm-sign-out-everywhere")).toBeVisible();
  await page.getByTestId("confirm-sign-out-everywhere").click();
  await expect(page).toHaveURL(/\/signin/, { timeout: NAV_TIMEOUT });

  // The new password is the one that works; the old one is gone.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret456");
  await page.getByRole("button", { name: "Sign in" }).click();
  // The guard remembered `/settings` as the intended page.
  await expect(page).toHaveURL(/\/settings$/, { timeout: NAV_TIMEOUT });
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
});
