import { test, expect, type Page } from "@playwright/test";

test.setTimeout(120_000);

/**
 * F3 workspace audit: the flows the main `workspace.spec.ts` does not cover —
 * keyboard reorder, attachments, the dev persona switcher, simulated failure —
 * plus a guard against console errors / hydration warnings in dev.
 */

const NAV_TIMEOUT = 30_000;

/** Console errors/warnings that are not a bug we care about (test noise only). */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[MSW\]/i,
  // The anonymous session probe (`GET /api/v1/auth/session`) answers 401 by
  // design when nobody is signed in, and the browser logs every 401. This is
  // the documented "no active session" signal (see docs/DECISIONS.md), not an
  // application error.
  /the server responded with a status of 401/i,
  /net::ERR_/i, // intentionally triggered by the failure-simulation test
  /the server responded with a status of 503/i,
];

function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  const keep = (text: string) => !IGNORED_CONSOLE.some((re) => re.test(text));
  page.on("console", (msg) => {
    if ((msg.type() === "error" || msg.type() === "warning") && keep(msg.text())) {
      problems.push(`[console.${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    if (keep(err.message)) problems.push(`[pageerror] ${err.message}`);
  });
  return problems;
}

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

async function signUpToWorkspace(page: Page) {
  const email = uniqueEmail("audit");
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("Audit User");
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

async function rowTitles(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="workspace-item"]')
    .evaluateAll((rows) => rows.map((row) => (row.querySelector("p")?.textContent ?? "").trim()));
}

/**
 * Titles of a section's items as the mock API has actually *stored* them.
 * Reorder is optimistic in the UI, so a reload fired as soon as the rows look
 * right can cancel the in-flight POST; awaiting the persisted order keeps the
 * "persists it" assertion about persistence rather than timing.
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

test("reorders with the keyboard on the drag handle and persists it", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "skill", ["Alpha", "Beta", "Gamma"]);
  await gotoReady(page, "/workspace/skill");
  await expect(page.getByTestId("workspace-item")).toHaveCount(3, { timeout: NAV_TIMEOUT });
  expect(await rowTitles(page)).toEqual(["Alpha", "Beta", "Gamma"]);

  // dnd-kit keyboard path: focus the handle, Space to lift, ArrowDown to move,
  // Space to drop. The small pauses let React commit each drag step before the
  // next key, otherwise the drop can arrive before `over` advances.
  await page.getByRole("button", { name: "Reorder Alpha" }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");

  await expect.poll(() => rowTitles(page)).toEqual(["Beta", "Alpha", "Gamma"]);
  // Optimistic UI: confirm the new order reached the API before reloading.
  await expect.poll(() => persistedTitles(page, "skill")).toEqual([
    "Beta",
    "Alpha",
    "Gamma",
  ]);

  await gotoReady(page, "/workspace/skill");
  await expect(page.getByTestId("workspace-item")).toHaveCount(3, { timeout: NAV_TIMEOUT });
  expect(await rowTitles(page)).toEqual(["Beta", "Alpha", "Gamma"]);
});

test("attaches a document once, with progress feedback and no duplicate", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await signUpToWorkspace(page);
  await seedItems(page, "certificate", ["Cloud Practitioner"]);
  await gotoReady(page, "/workspace/certificate");
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });

  await page.getByRole("button", { name: "Edit Cloud Practitioner" }).click();
  const sheet = page.getByRole("dialog", { name: "Edit certificate" });
  await expect(sheet).toBeVisible();

  await sheet.locator('[data-testid="attachment-input"]').setInputFiles({
    name: "certificate.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 audit fixture"),
  });

  // Progress is visible, then the file settles as exactly one attachment.
  await expect(sheet.getByTestId("attachment-pending")).toBeVisible();
  await expect(sheet.getByTestId("attachment-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });
  await expect(sheet.getByTestId("attachment-item")).toContainText("certificate.pdf");
  await expect(sheet.getByTestId("attachment-pending")).toHaveCount(0);

  await expect(page.getByText(/Saved at/)).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByTestId("workspace-item")).toContainText("1 attachment");

  expect(problems, `console problems:\n${problems.join("\n")}`).toEqual([]);
});

test("switches dev personas and reaches the designed empty state", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await signUpToWorkspace(page);
  await expect(page.getByText("Your workspace is empty — let’s start it right")).toBeVisible();

  await page.getByRole("button", { name: "Mid-level dev" }).click();
  await expect(page.getByText("Your workspace is empty — let’s start it right")).toBeHidden({
    timeout: NAV_TIMEOUT,
  });
  await expect(page.getByRole("region", { name: "All sections" })).toBeVisible();

  await page.getByRole("button", { name: "Empty (new)" }).click();
  await expect(page.getByText("Your workspace is empty — let’s start it right")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  expect(problems, `console problems:\n${problems.join("\n")}`).toEqual([]);
});

test("surfaces a designed error state when the mock API fails, then recovers", async ({ page }) => {
  await signUpToWorkspace(page);
  await seedItems(page, "project", ["Resilient item"]);
  await gotoReady(page, "/workspace");
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Simulate failure" }).click();
  await expect(page.getByRole("button", { name: "Failures on" })).toBeVisible();
  await expect(page.getByText("Couldn’t load your workspace")).toBeVisible({ timeout: NAV_TIMEOUT });

  // Retry while failing keeps the error state honest.
  await page.getByRole("button", { name: /Try again/i }).click();
  await expect(page.getByText("Couldn’t load your workspace")).toBeVisible();

  await page.getByRole("button", { name: "Failures on" }).click();
  await expect(page.getByText("Couldn’t load your workspace")).toBeHidden({ timeout: NAV_TIMEOUT });
  await expect(page.getByRole("region", { name: "All sections" })).toBeVisible();
});

test("dashboard and section flows log no console errors or hydration warnings", async ({ page }) => {
  const problems = collectConsoleProblems(page);
  await signUpToWorkspace(page);
  await seedItems(page, "project", ["Console check"]);
  await gotoReady(page, "/workspace");
  await expect(page.getByTestId("workspace-item")).toBeHidden();
  await gotoReady(page, "/workspace/project");
  await expect(page.getByTestId("workspace-item")).toHaveCount(1, { timeout: NAV_TIMEOUT });
  await gotoReady(page, "/workspace");

  expect(problems, `console problems:\n${problems.join("\n")}`).toEqual([]);
});
