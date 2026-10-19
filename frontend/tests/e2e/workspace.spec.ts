import { test, expect, type Locator, type Page } from "@playwright/test";

// Dev-server compiles + 350ms mock latency make the full flows slow.
test.setTimeout(120_000);

/**
 * F3 E2E: workspace dashboard + section editors (PRD §6.1 WS-1..WS-6, §7.5).
 * The mock API (MSW) persists in `localStorage`, so reload-persistence is real.
 */

const NAV_TIMEOUT = 30_000;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * Navigate and wait until the MSW worker controls the page (see
 * `src/mocks/start.ts`): the first visit registers the worker and reloads once.
 */
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
async function signUpToWorkspace(page: Page) {
  const email = uniqueEmail("f3");
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F3 User");
  await page.getByLabel("Email").fill(email);
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
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
}

/** Arrange: create items directly through the mock API so tests stay focused. */
async function seedItems(page: Page, section: string, titles: string[]) {
  await page.evaluate(
    async ({ section, titles }) => {
      for (const title of titles) {
        const res = await fetch("/api/v1/workspace/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            section,
            title,
            bullets: [],
            tags: [],
            links: [],
            attachments: [],
            evidence: "attested",
            order: 0,
          }),
        });
        if (!res.ok) throw new Error(`Seeding "${title}" failed: ${res.status}`);
      }
    },
    { section, titles },
  );
}

/** Titles of the workspace rows, in display order. */
async function rowTitles(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="workspace-item"]')
    .evaluateAll((rows) => rows.map((row) => (row.querySelector("p")?.textContent ?? "").trim()));
}

/**
 * Titles of a section's items as the mock API has actually *stored* them.
 *
 * Reorder is optimistic in the UI (`useReorderItems`), so a reload fired the
 * moment the rows look right can cancel the still-in-flight POST and lose the
 * move. Awaiting the persisted order is what makes a "persists across reload"
 * assertion test persistence instead of timing.
 */
async function persistedTitles(page: Page, section: string): Promise<string[]> {
  return page.evaluate(async (target) => {
    const res = await fetch("/api/v1/workspace");
    const body = (await res.json()) as {
      items: { section: string; title: string; order: number; deletedAt?: string | null }[];
    };
    return body.items
      .filter((item) => item.section === target && !item.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.title);
  }, section);
}

test("adds an item from the dashboard and shows it in its section", async ({ page }) => {
  await signUpToWorkspace(page);

  // Brand-new workspace: the designed empty state is the entry point.
  await expect(page.getByText("Your workspace is empty — let’s start it right")).toBeVisible();
  await page.getByRole("button", { name: "Add project", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: "Add project" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Title").fill("Campus event tracker");
  await sheet.getByRole("button", { name: "Save item" }).click();

  await expect(page.getByText("Project added")).toBeVisible();
  // The dashboard section card now reports one item (stable test id; the card
  // no longer carries an aria-label — see section-card.tsx).
  await expect(page.getByTestId("section-count-project")).toHaveText("1", {
    timeout: NAV_TIMEOUT,
  });

  // And the item is really on its section page.
  await gotoReady(page, "/workspace/project");
  await expect(page.getByTestId("workspace-item").first()).toContainText("Campus event tracker");
});

test("edits an item, autosaves, and never loses focus while typing", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "project", ["Focus test item"]);
  await gotoReady(page, "/workspace/project");
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });

  await page.getByRole("button", { name: "Edit Focus test item" }).click();
  await expect(page.getByRole("dialog", { name: "Edit project" })).toBeVisible();

  const longTitle = "A very long project title ".repeat(5).trim();

  async function expectFocus(locator: Locator, label: string) {
    const focused = await locator.evaluate((el) => el === document.activeElement);
    expect(focused, `caret left the ${label} field while typing`).toBe(true);
  }

  // Type a long string into every field and assert the caret never leaves it.
  const title = page.locator('input[data-field="title"]');
  await title.click();
  await title.pressSequentially(longTitle);
  await expectFocus(title, "title");

  const organisation = page.locator('input[data-field="organization"]');
  await organisation.click();
  await organisation.pressSequentially("Northwind Labs and a very long organisation name");
  await expectFocus(organisation, "organisation");

  await page.getByRole("button", { name: "Add bullet" }).click();
  const bullet = page.locator('input[data-field="bullet"]').first();
  await bullet.click();
  await bullet.pressSequentially("Owned the read path and cut p95 latency dramatically.");
  await expectFocus(bullet, "bullet");

  await page.getByRole("button", { name: "Add link" }).click();
  const link = page.locator('input[data-field="link"]').first();
  await link.click();
  await link.pressSequentially("https://example.com/a/long/url/that/keeps/typing");
  await expectFocus(link, "link");

  const tag = page.locator('input[data-field="tag"]');
  await tag.click();
  await tag.pressSequentially("performance-engineering");
  await expectFocus(tag, "tag");
  // Tags commit on Enter; this also marks the form dirty for autosave.
  await tag.press("Enter");
  await expectFocus(tag, "tag after Enter");

  // Autosave fires after the edit pause; the indicator must tell the truth.
  await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByTestId("workspace-item").first()).toContainText(longTitle);
});

test("reorders with the Move buttons and persists the order across reload", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "skill", ["Alpha", "Beta", "Gamma"]);
  await gotoReady(page, "/workspace/skill");
  await expect(page.getByTestId("workspace-item")).toHaveCount(3, { timeout: NAV_TIMEOUT });
  expect(await rowTitles(page)).toEqual(["Alpha", "Beta", "Gamma"]);

  await page.getByRole("button", { name: "Move Alpha down" }).click();
  await expect.poll(() => rowTitles(page)).toEqual(["Beta", "Alpha", "Gamma"]);
  // The reorder is optimistic: wait until the API has the new order before the
  // reload, which would otherwise cancel the in-flight POST.
  await expect.poll(() => persistedTitles(page, "skill")).toEqual([
    "Beta",
    "Alpha",
    "Gamma",
  ]);

  // The order is stored, not just optimistic UI state.
  await gotoReady(page, "/workspace/skill");
  await expect(page.getByTestId("workspace-item")).toHaveCount(3, { timeout: NAV_TIMEOUT });
  expect(await rowTitles(page)).toEqual(["Beta", "Alpha", "Gamma"]);
});

test("soft-deletes with an Undo toast and restores the item", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "project", ["Temporary item"]);
  await gotoReady(page, "/workspace/project");
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });

  await page.getByRole("button", { name: "Delete Temporary item" }).click();
  await expect(page.getByText("Item deleted")).toBeVisible();
  await expect(page.getByTestId("workspace-item")).toHaveCount(0, { timeout: NAV_TIMEOUT });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Restored")).toBeVisible();
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });
  await expect(page.getByTestId("workspace-item")).toContainText("Temporary item");
});

test("requires a document or link before an item can be Verified", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "certificate", ["Cloud Practitioner"]);
  await gotoReady(page, "/workspace/certificate");
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });

  await page.getByRole("button", { name: "Edit Cloud Practitioner" }).click();
  await expect(page.getByRole("dialog", { name: "Edit certificate" })).toBeVisible();

  await page.getByRole("radio", { name: /Verified/ }).click();
  await expect(page.getByText(/Verified needs a supporting document or link/)).toBeVisible();

  await page.getByRole("button", { name: "Add link" }).click();
  await page.locator('input[data-field="link"]').first().fill("https://example.com/certificate");
  await expect(page.getByText(/Verified needs a supporting document or link/)).toBeHidden();

  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await expect(page.getByLabel("Evidence: Verified")).toBeVisible();
});

test.describe("mobile 360px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("adds, edits and deletes an item at 360px", async ({ page }) => {
    await signUpToWorkspace(page);

    await page.getByRole("button", { name: "Add experience", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add experience" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Title").fill("Mobile Engineer");
    await sheet.getByRole("button", { name: "Save item" }).click();
    await expect(page.getByText("Experience added")).toBeVisible();

    await gotoReady(page, "/workspace/experience");
    await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });

    await page.getByRole("button", { name: "Edit Mobile Engineer" }).click();
    await expect(page.getByRole("dialog", { name: "Edit experience" })).toBeVisible();
    await page.locator('input[data-field="title"]').fill("Mobile Engineer II");
    await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: NAV_TIMEOUT });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("workspace-item")).toContainText("Mobile Engineer II");

    await page.getByRole("button", { name: "Delete Mobile Engineer II" }).click();
    await expect(page.getByText("Item deleted")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });
  });
});
