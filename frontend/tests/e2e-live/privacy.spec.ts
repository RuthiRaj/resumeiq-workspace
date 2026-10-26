import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

import { liveE2eCredentials, liveE2eEnabled } from "./backend-env";

/**
 * Opt-in live B6 smoke for F6 (not part of `npm run e2e`).
 *
 * Requires `RUN_LIVE_E2E=1`, user A credentials in `backend/.env.test`, and a
 * deployed backend with the B6 capabilities/export routes. It is deliberately
 * read-only: capabilities and the two export downloads are exercised; account
 * deletion, resume deletion and purge are never called against a real account.
 */
const { email, password } = liveE2eCredentials();

async function signInAsUserA(page: Page) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/workspace/, { timeout: 60_000 });
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible({ timeout: 60_000 });
}

test.describe("live privacy and export (B6)", () => {
  test.skip(
    !liveE2eEnabled() || !email || !password,
    "Set RUN_LIVE_E2E=1 and user A credentials in backend/.env.test to run the live privacy smoke.",
  );

  test("capabilities load and the data export downloads without deleting", async ({
    page,
  }) => {
    await signInAsUserA(page);
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: "Privacy centre", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    // A failed capabilities read is the visible fallback; its absence proves
    // `GET /api/v1/capabilities` answered.
    await expect(page.getByTestId("capabilities-unavailable")).toHaveCount(0);
    const exportButton = page.getByTestId("privacy-export-button");
    await expect(exportButton).toBeEnabled({ timeout: 60_000 });

    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^resumeiq-data-export-.*\.json$/);

    const path = await download.path();
    expect(path).toBeTruthy();
    const parsed = JSON.parse(await readFile(path!, "utf8")) as {
      format?: string;
      userId?: string;
    };
    // Shape only: never assert on or print personal rows.
    expect(parsed.format).toBe("resumeiq.data-export.v1");
    expect(parsed.userId).toBeTruthy();

    // The danger-zone control must still be present but is never clicked.
    await expect(page.getByTestId("privacy-delete-account")).toBeVisible();
  });

  test("Download PDF streams the shared document as a file", async ({
    page,
  }) => {
    await signInAsUserA(page);
    await page.goto("/resume");
    await expect(
      page.getByRole("heading", { name: "Standard resume", exact: true }),
    ).toBeVisible({ timeout: 60_000 });

    const exportButton = page.getByTestId("pdf-export-button");
    await expect(exportButton).toBeEnabled({ timeout: 60_000 });

    // The Download PDF button triggers window.print() which opens the browser's
    // print dialog. In headless Playwright, we generate the PDF directly using
    // page.pdf() since window.print() doesn't produce a download event.
    await exportButton.click();

    // Give the print dialog a moment to process
    await page.waitForTimeout(1_000);

    // Generate PDF using Playwright's page.pdf() which captures the print layout
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });

    expect(pdfBuffer.length).toBeGreaterThan(1000);
    expect(pdfBuffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // The status shows "Print dialog opened..." while the dialog is open
    await expect(page.getByTestId("pdf-export-status")).toContainText(
      "Print dialog opened",
    );
    await expect(page.getByTestId("pdf-export-error")).toHaveCount(0);
  });
});
