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
  // `exact` distinguishes the h1 from the brand-new-workspace empty-state
  // heading, and the generous timeout absorbs a slow first compile of
  // /workspace under parallel dev-server workers (see ADR-008).
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
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
  await expect(review.getByText("5 sample items")).toBeVisible();

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
    hasText: "Sample Recipe Box",
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
  // The dashboard section card now reports exactly one project. Located by its
  // stable test id: the card no longer carries an `aria-label` (axe
  // `label-content-name-mismatch` — the visible text must be part of the name).
  await expect(page.getByTestId("section-count-project")).toHaveText("1", {
    timeout: NAV_TIMEOUT,
  });
});

test("demo-mode banner, sample tags and per-section fields on review", async ({ page }) => {
  await signUpToWorkspace(page, "f4-import-demo");

  await gotoReady(page, "/workspace/import");
  await page
    .getByTestId("upload-input")
    .setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2048) });

  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible({ timeout: REVIEW_TIMEOUT });

  // Honesty: the whole review is labelled demo mode, verbatim.
  await expect(page.getByTestId("demo-mode-banner")).toContainText(
    "Demo mode: this preview is sample data. Your file was not read.",
  );

  // Every extracted card carries a Sample tag — none is presented as read.
  const cards = review.locator('[data-testid^="review-item-"]');
  await expect(cards).toHaveCount(5);
  await expect(review.locator('[data-testid^="sample-tag-"]')).toHaveCount(5);

  // Personal details: name and location only — no employer, dates or certificate.
  const personal = page.getByTestId("review-item-ext-personal");
  await expect(personal.getByLabel("Full name")).toBeVisible();
  await expect(personal.getByLabel("Location")).toBeVisible();
  await expect(personal.getByLabel("Employer")).toHaveCount(0);
  await expect(personal.getByLabel("Start (month)")).toHaveCount(0);
  await expect(personal.getByLabel("Supporting link")).toHaveCount(0);

  // Skills: one card of chips, no dates, no certificate.
  const skills = page.getByTestId("review-item-ext-skills");
  await expect(skills.getByRole("list", { name: "Extracted skills" })).toBeVisible();
  await expect(skills.getByText("TypeScript")).toBeVisible();
  await expect(skills.getByText("PostgreSQL")).toBeVisible();
  await expect(skills.getByLabel("Start (month)")).toHaveCount(0);
  await expect(skills.getByLabel("Supporting link")).toHaveCount(0);

  // Confirming the skills card creates one skill item per chip.
  await page.getByTestId("confirm-ext-skills").click();
  await expect(skills.getByText("In your workspace", { exact: true })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  const skillItems = await page.evaluate(async () => {
    const res = await fetch("/api/v1/workspace");
    const body = (await res.json()) as { items: { section: string; title: string }[] };
    return body.items.filter((item) => item.section === "skill").map((item) => item.title);
  });
  expect(skillItems.sort()).toEqual(["PostgreSQL", "React", "TypeScript"]);
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
