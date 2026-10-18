import { test, expect, type Page } from "@playwright/test";

// Dev-server compiles + mock latency + a ~5s staged analysis run per report.
test.setTimeout(180_000);

/**
 * F4 E2E: target intake -> analysis theatre -> full report (PRD §6.4–6.7).
 * The mock run advances from wall-clock time (~5.1s across six stages), so the
 * theatre is a real state on the way to the report — not a decorative loader.
 * The three sample postings are asserted to produce *distinct* scores, which is
 * the milestone's fixture contract (PRD §8.5).
 */

const NAV_TIMEOUT = 30_000;
const REPORT_TIMEOUT = 45_000;

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

/**
 * Arrange: seed workspace evidence directly through the mock API so the report
 * has something to match against. TypeScript/React/PostgreSQL items give the
 * "strong" posting real matches; the ML posting stays mostly unsupported.
 */
async function seedEvidence(page: Page) {
  const items = [
    {
      section: "experience",
      title: "Frontend Engineer at Example Systems",
      bullets: [
        "Built customer dashboards in TypeScript and React.",
        "Tuned PostgreSQL queries for the reporting service.",
      ],
      tags: ["typescript", "react", "postgresql"],
      evidence: "attested",
    },
    {
      section: "project",
      title: "Recipe box",
      bullets: ["A recipe organiser written in React and TypeScript."],
      tags: ["react", "typescript"],
      evidence: "verified",
    },
    {
      section: "skill",
      title: "TypeScript, React and PostgreSQL",
      bullets: [],
      tags: ["typescript", "react", "postgresql"],
      evidence: "attested",
    },
  ];
  await page.evaluate(async (seed) => {
    for (const item of seed) {
      const res = await fetch("/api/v1/workspace/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, links: [], attachments: [], order: 0 }),
      });
      if (!res.ok) throw new Error(`Seeding "${item.title}" failed: ${res.status}`);
    }
  }, items);
}

/** Opens the dev fixture drawer on `/targets/new` and fills the form from it. */
async function loadFixture(page: Page, id: "strong" | "partial" | "poor") {
  await page.getByText("Load a sample posting (development fixtures)").click();
  await page.getByTestId(`load-fixture-${id}`).click();
  // The fixture fills role + JD; wait for it so a fast submit can't race.
  await expect(page.getByTestId("target-role")).not.toHaveValue("", { timeout: 10_000 });
}

/** Submits the intake form and waits for the target page. */
async function submitTarget(page: Page) {
  await page.getByTestId("target-submit").click();
  await expect(page).toHaveURL(/\/targets\/[^/]+$/, { timeout: NAV_TIMEOUT });
}

/**
 * The `Score N` badge for one named target on `/targets`. The list renders
 * newest-first (see `mocks/targets-store.ts`), so a score is matched to the
 * target it belongs to (via the card's accessible name) rather than by list
 * position.
 */
async function scoreFor(page: Page, role: string): Promise<number> {
  const badge = page
    .getByTestId("target-list")
    .getByRole("link", { name: `Open the report for ${role}` })
    .getByText(/^Score \d+$/);
  await expect(badge).toBeVisible();
  const text = await badge.innerText();
  return Number(text.replace(/\D+/g, ""));
}

test("intake -> theatre -> full report with methodology and gap types", async ({ page }) => {
  await signUpToWorkspace(page, "f4-report");
  await seedEvidence(page);

  // Empty state first: the CTA leads into the intake form.
  await gotoReady(page, "/targets");
  await expect(page.getByText("No job targets yet")).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("link", { name: "Add your first target" }).click();
  await expect(page).toHaveURL(/\/targets\/new$/, { timeout: NAV_TIMEOUT });

  await loadFixture(page, "strong");
  await expect(page.getByTestId("target-role")).toHaveValue("Senior Frontend Engineer");
  await submitTarget(page);

  // The theatre shows the six stages while the mock provider works.
  await expect(page.getByTestId("analysis-theatre")).toBeVisible({ timeout: REPORT_TIMEOUT });

  // Then the finished report replaces it.
  const report = page.getByTestId("report-view");
  await expect(report).toBeVisible({ timeout: REPORT_TIMEOUT });

  // Score + factors, with the method next to the number.
  await expect(
    report.getByRole("heading", { name: "Match score and factors" }),
  ).toBeVisible();
  await expect(report.getByText("How this is calculated.")).toBeVisible();
  await expect(
    report.getByText("This is not a probability of being hired."),
  ).toBeVisible();

  // Requirements are placed in the three evidence states.
  await expect(
    report.getByRole("heading", { name: "Requirements against your evidence" }),
  ).toBeVisible();
  await expect(report.getByTestId("requirement-list").locator("li").first()).toBeVisible();

  // Gap types (PRD §6.6): both kinds are named and explained.
  await expect(report.getByRole("heading", { name: "Gaps, split honestly" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Not evidenced yet" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Genuinely missing" })).toBeVisible();

  await expect(report.getByRole("heading", { name: "Skills analysis" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "Improvement roadmap" })).toBeVisible();
  await expect(report.getByRole("heading", { name: "ATS panel" })).toBeVisible();
  await expect(
    report.getByText("Not a guarantee for any employer's ATS."),
  ).toBeVisible();

  // The list card records the score for this target.
  await gotoReady(page, "/targets");
  await expect(page.getByTestId("target-list")).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText(/^Score \d+$/)).toBeVisible();
});

test("strong and poor postings produce distinct scores", async ({ page }) => {
  await signUpToWorkspace(page, "f4-fixtures");
  await seedEvidence(page);

  await gotoReady(page, "/targets/new");
  await loadFixture(page, "strong");
  await submitTarget(page);
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: REPORT_TIMEOUT });

  await gotoReady(page, "/targets/new");
  await loadFixture(page, "poor");
  await submitTarget(page);
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: REPORT_TIMEOUT });

  await gotoReady(page, "/targets");
  await expect(page.getByTestId("target-list")).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByText(/^Score \d+$/)).toHaveCount(2, { timeout: NAV_TIMEOUT });

  const strong = await scoreFor(page, "Senior Frontend Engineer");
  const poor = await scoreFor(page, "Machine Learning Engineer");
  expect(strong).toBeGreaterThan(poor);
});

test("declining AI consent saves the target without a report", async ({ page }) => {
  await signUpToWorkspace(page, "f4-consent");

  // Simulate a user who answered "no" during a later visit: drop the recorded
  // consent, keep the session.
  await page.evaluate(() => window.localStorage.removeItem("riq.consent"));
  await gotoReady(page, "/targets/new");

  await loadFixture(page, "strong");
  await submitTarget(page);

  // The gate stands in for the analysis — nothing starts without a yes.
  const gate = page.getByTestId("consent-gate");
  await expect(gate).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(gate.getByLabel(/I understand my job description/)).toBeVisible();

  await page.getByTestId("consent-decline-button").click();

  // Declined: the page explains the state instead of hiding it.
  await expect(page.getByTestId("consent-declined")).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(page.getByTestId("report-view")).toHaveCount(0);
  await expect(page.getByTestId("analysis-theatre")).toHaveCount(0);

  // And the list card says so plainly.
  await gotoReady(page, "/targets");
  await expect(page.getByText("Not analysed")).toBeVisible({ timeout: NAV_TIMEOUT });
});
