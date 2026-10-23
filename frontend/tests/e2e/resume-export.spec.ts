import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Sign-up + onboarding + a retried capabilities read + 500ms PDF latency.
test.setTimeout(180_000);

const NAV_TIMEOUT = 30_000;

/**
 * F6 E2E: server PDF export and its extraction-check refusal, against MSW.
 * The mocked route streams real PDF bytes and carries the `X-Export-*` headers,
 * so the download and the 502 path are both exercised end to end.
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
  await page.getByLabel("Full name").fill("F6 Export");
  await page.getByLabel("Email").fill(uniqueEmail("f6-export"));
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
  scope: "all" | "capabilities" | "export" = "all",
) {
  // The mock worker can still be booting on the first navigation after sign-up.
  // Retry instead of treating that transient 404 as a real answer.
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

test("downloads a PDF and shows the extraction-check result", async ({ page }) => {
  await signUp(page);
  await gotoReady(page, "/resume");
  await expect(
    page.getByRole("heading", { name: "Standard resume", exact: true }),
  ).toBeVisible();

  const exportButton = page.getByTestId("pdf-export-button");
  await expect(exportButton).toBeEnabled({ timeout: NAV_TIMEOUT });
  await expect(exportButton).toHaveText("Download PDF");

  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await expect(page.getByTestId("pdf-export-check")).toContainText(
    "Text extraction passed",
  );
  await expect(page.getByText("PDF downloaded")).toBeVisible();
});

test("a refused export explains the failed check and leaves the resume in place", async ({
  page,
}) => {
  await signUp(page);
  await gotoReady(page, "/resume");
  const exportButton = page.getByTestId("pdf-export-button");
  await expect(exportButton).toBeEnabled({ timeout: NAV_TIMEOUT });

  // Scope the failure to the PDF route so the page keeps its cached
  // capabilities and the button stays clickable — the real 502 path.
  await setFailures(page, true, "export");
  try {
    await exportButton.click();
    const error = page.getByTestId("pdf-export-error");
    await expect(error).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(error).toContainText("unchanged");
    await expect(error).toContainText("editable");
    await expect(page.getByTestId("pdf-export-check")).toContainText(
      "Text extraction failed",
    );
    await expect(page.getByText("PDF export refused")).toBeVisible();
    // The resume page is still rendered and the control is usable again; no
    // download was offered and nothing was removed.
    await expect(
      page.getByRole("heading", { name: "Standard resume", exact: true }),
    ).toBeVisible();
    await expect(exportButton).toBeEnabled();
  } finally {
    await setFailures(page, false).catch(() => {});
  }
});
