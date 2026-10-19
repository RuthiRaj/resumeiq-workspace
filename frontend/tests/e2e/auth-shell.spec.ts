import { test, expect } from "@playwright/test";

// Dev-server compiles + 350ms mock latency make the full flows slow.
test.setTimeout(120_000);

/**
 * F2 E2E: signup -> onboarding -> dashboard, route protection, command
 * palette, and mobile navigation. Mock API runs via MSW in `next dev`.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * Mock round-trips (350ms) plus first-hit route compiles in `next dev` make
 * post-mutation navigations slow under parallel workers — allow 30s.
 */
const NAV_TIMEOUT = 30_000;

async function expectUrl(page: import("@playwright/test").Page, pattern: RegExp) {
  await expect(page).toHaveURL(pattern, { timeout: NAV_TIMEOUT });
}

/**
 * Navigate and wait until the MSW worker controls the page. The first visit
 * registers the worker and reloads once (see `src/mocks/start.ts`), so tests
 * must not interact before control is established.
 */
async function gotoReady(page: import("@playwright/test").Page, url: string) {
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

async function completeOnboarding(page: import("@playwright/test").Page, path: "manual" | "import") {
  // Step 1: pick a path.
  await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();
  if (path === "manual") {
    await page.getByRole("tab", { name: "Start manually" }).click();
    await page.getByRole("button", { name: "Start manually" }).last().click();
  } else {
    await page.getByRole("button", { name: "Continue with import" }).click();
  }
  // Step 2: consent.
  await expect(page.getByRole("heading", { name: "One privacy promise first" })).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Consent and continue" }).click();
}

test("signup -> onboarding -> dashboard lands on the workspace", async ({ page }) => {
  const email = uniqueEmail("f2");
  // Protected route bounces to signin with a next param.
  await gotoReady(page, "/workspace");
  await expectUrl(page, /\/signin\?next=/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expectUrl(page, /\/onboarding/);
  await completeOnboarding(page, "manual");
  await expectUrl(page, /\/workspace$/);
  await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeVisible();
});

test("route protection returns to the intended page after sign in", async ({ page }) => {
  const email = uniqueEmail("f2-back");
  // Create the account first (signup always routes through onboarding).
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expectUrl(page, /\/onboarding/);

  // Simulate a fresh visit: drop the session, keep the account.
  await page.evaluate(() => window.localStorage.removeItem("riq.session"));
  await gotoReady(page, "/privacy");
  await expectUrl(page, /\/signin\?next=%2Fprivacy/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectUrl(page, /\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
});

test("command palette opens with Ctrl+K and navigates", async ({ page }) => {
  const email = uniqueEmail("f2-palette");
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expectUrl(page, /\/onboarding/);
  await completeOnboarding(page, "manual");
  await expectUrl(page, /\/workspace$/);

  // The ⌘K listener lives in the shell — wait for it to mount first.
  await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.getByPlaceholder("Search pages and actions…").fill("privacy");
  await page.getByRole("option", { name: /Go to Privacy/ }).click();
  await expectUrl(page, /\/privacy$/);

  // Escape closes without navigating.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
  await expectUrl(page, /\/privacy$/);
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("bottom bar + More sheet navigate", async ({ page }) => {
    const email = uniqueEmail("f2-mobile");
    await gotoReady(page, "/signup");
    await page.getByLabel("Full name").fill("E2E User");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expectUrl(page, /\/onboarding/);
    await completeOnboarding(page, "manual");
    await expectUrl(page, /\/workspace$/);

    const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("link", { name: "Job targets" }).click();
    await expectUrl(page, /\/targets$/);

    await mobileNav.getByRole("button", { name: "More navigation" }).click();
    await expect(page.getByRole("dialog", { name: "All destinations" })).toBeVisible();
    await page.getByRole("dialog", { name: "All destinations" }).getByRole("link", { name: "Privacy" }).click();
    await expectUrl(page, /\/privacy$/);
  });
});
