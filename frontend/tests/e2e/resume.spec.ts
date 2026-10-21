import { test, expect, type Page } from "@playwright/test";

// Dev-server compiles + 350ms mock latency + one 5.1s staged analysis per test.
test.setTimeout(240_000);

const NAV_TIMEOUT = 30_000;
const RUN_TIMEOUT = 45_000;

/**
 * F5 E2E: standard-resume presentation, tailored generation, grounded editing,
 * stale diff + per-section refresh, non-destructive restore and 360px layouts.
 * Everything runs against MSW; no real backend or AI provider is called.
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
  await page.getByLabel("Full name").fill("F5 User");
  await page.getByLabel("Email").fill(uniqueEmail("f5"));
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: NAV_TIMEOUT });
  await expect(
    page.getByRole("heading", { name: "How do you want to start?" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Start manually" }).click();
  await page.getByRole("button", { name: "Start manually" }).last().click();
  await expect(
    page.getByRole("heading", { name: "One privacy promise first" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Consent and continue" }).click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return res.json();
  }, path);
}

async function apiJson<T>(
  page: Page,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ url, verb, payload }) => {
      const res = await fetch(url, {
        method: verb,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    },
    { url: path, verb: method, payload: body },
  );
}

interface ResumeShape {
  id: string;
  kind: "standard" | "tailored";
  targetId: string | null;
  title: string | null;
  workspaceVersion: number;
  stale: boolean;
  sections: {
    key: string;
    claims: { text: string; evidenceIds: string[]; removed: boolean }[];
  }[];
  removedEvidenceIds: string[];
}

async function seedFixtures(page: Page) {
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "midlevel",
  });
  await apiJson(page, "POST", "/api/v1/dev/sample-targets", {});
}

async function openStrongReport(page: Page) {
  await gotoReady(page, "/targets/sample-target-strong");
  await expect(page.getByTestId("report-view")).toBeVisible({
    timeout: RUN_TIMEOUT,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally at this width").toBeLessThanOrEqual(1);
}

/* --------------------------------------------------- standard resume page */

test("standard resume: live synced preview and presentation controls", async ({
  page,
}) => {
  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "midlevel",
  });

  await gotoReady(page, "/resume");
  const paper = page.getByTestId("resume-paper");
  await expect(paper).toBeVisible();
  await expect(page.getByText(/^Synced/).first()).toBeVisible();
  await expect(paper.getByRole("heading", { name: "Experience" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();

  // Length is a presentation choice, not a data change.
  await page.getByRole("button", { name: "Two pages" }).click();
  await expect(page.getByRole("button", { name: "Two pages" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Visibility hides a section from the preview but keeps the workspace items.
  await page.getByRole("checkbox", { name: "Experience" }).uncheck();
  await expect(
    paper.getByRole("heading", { name: "Experience" }),
  ).not.toBeVisible();

  // Preferences survive a reload (localStorage), and re-enabling restores it.
  await gotoReady(page, "/resume");
  await expect(
    page.getByRole("checkbox", { name: "Experience" }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Experience" }).check();
  await expect(
    page.getByTestId("resume-paper").getByRole("heading", { name: "Experience" }),
  ).toBeVisible();
});

/* ------------------------------- generate, edit, reject, stale, restore */

test("tailored resume: generate, edit, reject ungrounded text, refresh stale and restore", async ({
  page,
}) => {
  await signUp(page);
  await seedFixtures(page);
  await openStrongReport(page);

  await page.getByTestId("generate-resume").click();
  const dialog = page.getByTestId("generate-resume-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("ai-reword-explanation")).toContainText(
    "Only bullet lines",
  );
  await expect(
    page.getByRole("checkbox", { name: "Reword bullets with AI (optional)" }),
  ).toBeEnabled();
  await page.getByTestId("generate-resume-submit").click();

  await expect(page.getByTestId("resume-studio")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect(page).toHaveURL(/\/targets\/sample-target-strong\/resume\?resume=/);
  await expect(page.getByTestId("resume-section-experience")).toBeVisible();
  await expect(page.getByRole("heading", { name: "ATS checks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requirement coverage" })).toBeVisible();

  // Open a cited workspace item from an evidence chip.
  const firstChip = page
    .getByTestId("resume-section-experience")
    .getByTestId("evidence-chip")
    .first();
  await firstChip.click();
  await expect(page.getByTestId("evidence-sheet")).toBeVisible();
  await expect(
    page.getByText(/The workspace item this line cites/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();

  // A grounded hand edit saves a new immutable version.
  const line = page
    .getByTestId("resume-section-experience")
    .getByRole("textbox", { name: "Experience line 1", exact: true });
  const original = await line.inputValue();
  await line.fill(`${original} — verified`);
  await page.getByTestId("save-section-experience").click();
  await expect(page.getByText("Experience saved")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect(page.getByTestId("resume-section-experience")).toContainText(
    "Hand-edited",
  );

  // Invented facts are rejected with the specific code, and the text survives.
  const invented = "Principal Architect at Google using AWS, 999% growth in 2026.";
  await line.fill(invented);
  await page.getByTestId("save-section-experience").click();
  const saveError = page.getByTestId("section-save-error");
  await expect(saveError).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(saveError).toContainText("resume_claim_ungrounded");
  await expect(line).toHaveValue(invented);

  // Discard the rejected draft. The previous grounded edit is already saved.
  await page
    .getByTestId("resume-section-experience")
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page.getByTestId("section-save-error")).not.toBeVisible();
  await expect(line).toHaveValue(`${original} — verified`);

  const resumeId = new URL(page.url()).searchParams.get("resume");
  expect(resumeId).toBeTruthy();
  const detail = await apiGet<ResumeShape>(page, `/api/v1/resumes/${resumeId}`);
  const experience = detail.sections.find((section) => section.key === "experience");
  const citedId = experience?.claims[0]?.evidenceIds[0];
  expect(citedId).toBeTruthy();

  // Removing a cited workspace item makes the snapshot stale.
  await apiJson(page, "DELETE", `/api/v1/workspace/items/${citedId}`);
  await page.reload();
  await expect(page.getByTestId("resume-stale-banner")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  await page.getByTestId("open-diff").click();
  const drawer = page.getByTestId("resume-diff-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Removed source items");
  await expect(drawer).toContainText("Hand-edited: refresh will skip it by default");

  // Refresh-all must skip the hand-edited section, not overwrite it.
  await page.getByTestId("refresh-all").click();
  const refreshResult = page.getByTestId("refresh-result");
  await expect(refreshResult).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(refreshResult).toContainText("Skipped Experience");
  await expect(refreshResult).toContainText("remain visible and marked");

  // The skipped section still shows its now-removed claim.
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(
    page
      .getByTestId("resume-section-experience")
      .getByRole("textbox", { name: "Experience line 1", exact: true }),
  ).toHaveValue(`${original} — verified`);
  await expect(page.getByTestId("resume-section-experience")).toContainText(
    "The source item was removed",
  );

  // Overwriting an edited section is a two-step, explicit action.
  await page.getByTestId("open-diff").click();
  await page.getByTestId("refresh-section-experience").click();
  await expect(page.getByTestId("overwrite-confirm-dialog")).toBeVisible();
  await expect(page.getByTestId("overwrite-confirm-dialog")).toContainText(
    "replaces your edits",
  );
  await page.getByTestId("confirm-overwrite").click();
  await expect(page.getByTestId("refresh-result")).toContainText(
    "Refreshed: Experience",
    { timeout: NAV_TIMEOUT },
  );
  await page.getByRole("button", { name: "Close panel" }).click();

  const afterRefresh = await apiGet<ResumeShape>(page, `/api/v1/resumes/${resumeId}`);
  const stillCitesRemoved = afterRefresh.sections
    .flatMap((section) => section.claims)
    .some((claim) => claim.evidenceIds.includes(citedId!));
  expect(stillCitesRemoved).toBe(false);

  // History separates the standard resume from saved snapshots and restores
  // non-destructively.
  await gotoReady(page, "/history");
  await expect(page.getByTestId("resume-history")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Standard resume" }),
  ).toBeVisible();
  await expect(page.getByTestId(`history-resume-${resumeId}`)).toBeVisible();
  await page
    .getByTestId(`history-resume-${resumeId}`)
    .getByRole("button", { name: /Showing versions|Version history/ })
    .click();
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  const restoreButtons = page.getByTestId(/^restore-version-/);
  await expect(restoreButtons.first()).toBeVisible({ timeout: NAV_TIMEOUT });
  const before = await restoreButtons.count();
  expect(before).toBeGreaterThan(0);
  await restoreButtons.last().click();
  await expect(page.getByText("Version restored")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect.poll(() => restoreButtons.count()).toBe(before + 1);
  await expect(page.getByText(/Restore is non-destructive/)).toBeVisible();
  await expect(page.getByText(/Purge is coming/)).toBeVisible();
});

/* ---------------------------------------------------------------- mobile */

test.describe("mobile 360px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("standard, studio and history fit 360px without horizontal scroll", async ({
    page,
  }) => {
    await signUp(page);
    await seedFixtures(page);
    await openStrongReport(page);

    const generated = await apiJson<ResumeShape>(
      page,
      "POST",
      "/api/v1/targets/sample-target-strong/resume",
      { title: "Mobile tailored resume", rewordWithAi: false },
    );

    await gotoReady(page, "/resume");
    await expect(page.getByTestId("resume-paper")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoReady(
      page,
      `/targets/sample-target-strong/resume?resume=${generated.id}`,
    );
    await expect(page.getByTestId("resume-studio")).toBeVisible();
    await expect(page.getByTestId("resume-section-experience")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoReady(page, "/history");
    await expect(page.getByTestId(`history-resume-${generated.id}`)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
