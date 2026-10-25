import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Sign-up + onboarding + 350ms mock latency + retries on the capabilities read.
test.setTimeout(180_000);

const NAV_TIMEOUT = 30_000;

/**
 * F6 E2E: privacy centre driven by the B6 capabilities/deletion routes.
 * Everything runs against MSW; no real backend, AI provider or email exists.
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

async function signUp(page: Page) {
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F6 User");
  await page.getByLabel("Email").fill(uniqueEmail("f6"));
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

async function setFailures(
  page: Page,
  enabled: boolean,
  scope: "all" | "capabilities" = "all",
) {
  // The mock worker can still be booting on the first navigation after sign-up.
  // Retry a few times instead of treating that transient 404 as a real answer.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    lastStatus = await page.evaluate(
      async ({ on, selected }) => {
        const response = await fetch("/api/v1/dev/failures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: on, scope: selected }),
        });
        return response.status;
      },
      { on: enabled, selected: scope },
    );
    if (lastStatus >= 200 && lastStatus < 300) return;
    await page.waitForTimeout(300);
  }
  throw new Error(`failure toggle failed: ${lastStatus}`);
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
    return response.json();
  }, path);
}

test("downloads a JSON export that contains every category", async ({ page }) => {
  await signUp(page);
  await gotoReady(page, "/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy centre", exact: true }),
  ).toBeVisible();

  const exportButton = page.getByTestId("privacy-export-button");
  await expect(exportButton).toBeEnabled({ timeout: NAV_TIMEOUT });

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^resumeiq-data-export-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const path = await download.path();
  expect(path).toBeTruthy();
  const data = JSON.parse(await readFile(path!, "utf8")) as {
    format: string;
    userId: string;
    workspace: unknown[];
    resumeClaims: unknown[];
    consentRecords: unknown[];
  };

  expect(data.format).toBe("resumeiq.data-export.v1");
  expect(data.userId).toBeTruthy();
  expect(Array.isArray(data.workspace)).toBe(true);
  expect(Array.isArray(data.resumeClaims)).toBe(true);
  expect(Array.isArray(data.consentRecords)).toBe(true);
  await expect(page.getByText("Data export downloaded")).toBeVisible();
});

test("requires the typed phrase, then states the auth-identity step honestly", async ({
  page,
}) => {
  await signUp(page);
  await gotoReady(page, "/privacy");

  const deleteButton = page.getByTestId("privacy-delete-account");
  await expect(deleteButton).toBeEnabled({ timeout: NAV_TIMEOUT });
  await deleteButton.click();

  const dialog = page.getByTestId("delete-account-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("What is deleted now");
  await expect(dialog).toContainText("What is not deleted");

  const confirm = page.getByTestId("confirm-delete-account");
  await expect(confirm).toBeDisabled();

  const phrase = page.getByTestId("delete-account-confirmation");
  await phrase.fill("Delete my account");
  await expect(confirm).toBeDisabled();
  await phrase.fill("delete my account");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  const result = page.getByTestId("deletion-result");
  await expect(result).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(result).toContainText("Your data is deleted");
  await expect(result).toContainText("sign-in email");
  await expect(result).toContainText("operator");

  // The mock deletes data, not the sign-in identity: the workspace is empty
  // but the session still works, exactly like `authUserDeleted: false`.
  const workspace = await apiGet<{ items: unknown[] }>(page, "/api/v1/workspace");
  expect(workspace.items).toHaveLength(0);
});

test("a failed capabilities read disables AI, export and deletion", async ({
  page,
}) => {
  await signUp(page);
  await gotoReady(page, "/workspace");
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await setFailures(page, true, "capabilities");

  try {
    // Client-side navigation keeps the in-memory failure toggle alive; a full
    // reload deliberately resets it (ADR-024), so do not use gotoReady here.
    await page.getByRole("link", { name: "Privacy" }).first().click();
    await expect(page).toHaveURL(/\/privacy$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByTestId("capabilities-unavailable")).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId("privacy-export-button")).toBeDisabled();
    await expect(page.getByTestId("privacy-delete-account")).toBeDisabled();
    await expect(page.getByText(/treated as unavailable/).first()).toBeVisible();
  } finally {
    await setFailures(page, false).catch(() => {});
  }
});

test("a failed data export shows an error and does not claim success", async ({
  page,
}) => {
  await signUp(page);
  await gotoReady(page, "/privacy");
  const exportButton = page.getByTestId("privacy-export-button");
  await expect(exportButton).toBeEnabled({ timeout: NAV_TIMEOUT });

  // Capabilities are already cached, so this makes the export request fail
  // while the control stays clickable — the real failure path.
  await setFailures(page, true, "all");
  try {
    await exportButton.click();
    await expect(page.getByTestId("export-error")).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByTestId("export-error")).toContainText(
      "Nothing was changed",
    );
  } finally {
    await setFailures(page, false).catch(() => {});
  }
});
