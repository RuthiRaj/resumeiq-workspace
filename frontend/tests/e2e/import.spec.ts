import { test, expect, type Page } from "@playwright/test";

// Dev-server compiles + the simulated extractor (~1.7s per upload) add latency.
test.setTimeout(120_000);

/**
 * F4 E2E: upload -> staged extraction -> side-by-side review (PRD §6.2
 * IM-1..IM-3). Nothing reaches the workspace until an item is confirmed, and a
 * rejected file always says why.
 */

const NAV_TIMEOUT = 30_000;
const REVIEW_TIMEOUT = 30_000;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Navigate and wait until the MSW worker controls the page. */
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

/** Sign up a fresh account and finish onboarding, ending on `/workspace`. */
async function signUpToWorkspace(page: Page, prefix: string) {
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F4 User");
  await page.getByLabel("Email").fill(uniqueEmail(prefix));
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: NAV_TIMEOUT });

  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  await page.getByRole("tab", { name: "Start manually" }).click();
  await page.getByRole("button", { name: "Start manually" }).last().click();
  await expect(page.getByRole("heading", { name: "One privacy promise first" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Consent and continue" }).click();

  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
}

test("upload -> extraction review -> confirmed item lands in the workspace", async ({ page }) => {
  await signUpToWorkspace(page, "f4-import");

  await gotoReady(page, "/workspace/import");
  await expect(page.getByTestId("upload-dropzone")).toBeVisible({ timeout: NAV_TIMEOUT });

  // The mock extractor only reads the file's name and size, so a small buffer
  // stands in for a real PDF; it must be over 1KB to count as readable.
  await page
    .getByTestId("upload-input")
    .setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2048) });

  // Staged extraction progress is real, not a spinner.
  await expect(page.getByTestId("import-extracting")).toBeVisible({ timeout: NAV_TIMEOUT });

  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible({ timeout: REVIEW_TIMEOUT });
  await expect(review.getByTestId("source-preview")).toBeVisible();
  await expect(review.getByTestId("review-progress")).toBeVisible();
  await expect(review.getByText("7 candidate items")).toBeVisible();

  // Extracted title sits next to its confidence and source line.
  const internship = review.locator('[data-testid^="review-item-"]').filter({
    hasText: "Backend Intern",
  });
  await expect(internship).toHaveCount(1);
  await expect(internship.getByText("% confidence", { exact: false }).first()).toBeVisible();

  // Reject one item, confirm another; neither changes anything silently.
  await internship.getByTestId(/reject-/).click();
  await expect(internship.getByText("Not imported")).toBeVisible({ timeout: NAV_TIMEOUT });

  const project = review.locator('[data-testid^="review-item-"]').filter({
    hasText: "Recipe box",
  });
  await expect(project).toHaveCount(1);
  await project.getByTestId(/confirm-/).click();
  // Exact text: this card also renders an "Open it in your workspace" link.
  await expect(project.getByText("In your workspace", { exact: true })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  await expect(review.getByText("1 confirmed")).toBeVisible();
  await expect(review.getByText("1 rejected")).toBeVisible();

  // Only the confirmed item exists outside the review. The "Open your
  // workspace" CTA only renders once *every* item is decided (see
  // import-review.tsx), and this test deliberately leaves items pending.
  await gotoReady(page, "/workspace");
  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
  await expect(
    page
      .getByRole("region", { name: "All sections" })
      .getByRole("link", { name: /Projects, 1 item/ }),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
});

test("an unsupported file type is rejected with a reason", async ({ page }) => {
  await signUpToWorkspace(page, "f4-import-reject");

  await gotoReady(page, "/workspace/import");
  await expect(page.getByTestId("upload-dropzone")).toBeVisible({ timeout: NAV_TIMEOUT });

  await page.getByTestId("upload-input").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(2048),
  });

  // Scope to the app's own alert; Next's route announcer is an empty
  // <div role="alert" id="__next-route-announcer__"> that getByRole also matched.
  await expect(page.locator('p[role="alert"]')).toContainText("Only PDF and DOCX files", {
    timeout: NAV_TIMEOUT,
  });
  // The dropzone stays usable for another attempt.
  await expect(page.getByTestId("upload-dropzone")).toBeVisible();
  await expect(page.getByTestId("import-review")).toHaveCount(0);
});
