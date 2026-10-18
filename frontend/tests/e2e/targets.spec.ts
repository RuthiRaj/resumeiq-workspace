import { test, expect, type Page } from "@playwright/test";

// Dev-server compiles + 350ms mock latency + 5.1s staged analysis per run.
test.setTimeout(180_000);

const NAV_TIMEOUT = 30_000;
const RUN_TIMEOUT = 45_000;

/**
 * F4 E2E: import + extraction review, target intake, the consent gate, the
 * analysis theatre and the full report (PRD §6.2, §6.4–6.7, §7.4.4, §7.5).
 *
 * Every assertion about the user comes from the mock workspace fixtures; the
 * postings are clearly labelled sample ads. Nothing here calls a real backend
 * or a real AI provider.
 */

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Navigate and wait until the MSW worker controls the page (see `src/mocks/start.ts`). */
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

/**
 * Sign up a fresh account and finish onboarding. `consent` decides whether the
 * AI-processing consent is granted, declined, or never recorded at all.
 */
async function signUp(
  page: Page,
  opts: { consent?: "granted" | "declined" } = {},
) {
  const consent = opts.consent ?? "granted";
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F4 User");
  await page.getByLabel("Email").fill(uniqueEmail("f4"));
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

  if (consent === "granted") {
    await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
    await page.getByRole("button", { name: "Consent and continue" }).click();
  } else {
    await page.getByRole("button", { name: "Continue without AI" }).click();
  }

  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Your workspace" })).toBeVisible();
}

/** Read from the mock API in the page context (the MSW worker intercepts it). */
async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return res.json();
  }, path);
}

async function apiPost(page: Page, path: string, body: unknown) {
  await page.evaluate(
    async ({ url, payload }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    },
    { url: path, payload: body },
  );
}

interface WorkspaceItemShape {
  title: string;
  evidence: string;
  links: string[];
  attachments: { name: string }[];
}

async function workspaceItems(page: Page): Promise<WorkspaceItemShape[]> {
  const body = await apiGet<{ items: WorkspaceItemShape[] }>(page, "/api/v1/workspace");
  return body.items;
}

/** Fill `/targets/new` from the development fixture list. */
async function fillTargetFromFixture(
  page: Page,
  fixture: "strong" | "partial" | "poor",
) {
  await gotoReady(page, "/targets/new");
  await page.getByText("Load a sample posting (development fixtures)").click();
  await page.getByTestId(`load-fixture-${fixture}`).click();
  await expect(page.getByTestId("target-role")).not.toHaveValue("");
}

/** Read the match score from the accessible score ring. */
async function matchScore(page: Page): Promise<number> {
  const label = await page
    .getByRole("img", { name: /^Match: \d+ out of 100$/ })
    .getAttribute("aria-label");
  const value = label?.match(/(\d+)/)?.[1];
  if (!value) throw new Error(`No score in "${label}"`);
  return Number(value);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally at this width").toBeLessThanOrEqual(1);
}

/* ------------------------------------------------------------------ import */

test("import: staged extraction, side-by-side review, nothing saved until confirmed", async ({
  page,
}) => {
  await signUp(page);
  await gotoReady(page, "/workspace/import");

  const upload = page.getByTestId("upload-input");

  // IM-1: type gate, with a readable reason.
  await upload.setInputFiles({
    name: "screenshot.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(2048, 1),
  });
  await expect(page.getByRole("alert")).toContainText("Only PDF and DOCX");

  // IM-1/IM-2: accepted file → staged progress → side-by-side review.
  await upload.setInputFiles({
    name: "example-cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(4096, 1),
  });
  await expect(page.getByTestId("import-extracting")).toBeVisible();
  await expect(page.getByTestId("import-extracting")).toContainText(
    /Uploading the document|Reading the text|Extracting fields|Checking confidence/,
  );
  await expect(page.getByTestId("import-review")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expect(page).toHaveURL(/session=/);

  // The source is on the page next to the extracted fields.
  await expect(page.getByTestId("source-preview")).toContainText(
    "EXAMPLE CANDIDATE",
  );
  await expect(page.getByTestId("review-progress")).toContainText("0 confirmed");
  await expect(page.getByTestId("review-progress")).toContainText("7 pending");

  // IM-2: nothing has entered the workspace yet.
  expect(await workspaceItems(page)).toHaveLength(0);

  // IM-2: uncertain fields are flagged, and each links to its source line.
  const internship = page.getByTestId("review-item-ext-internship");
  await expect(internship.locator('[data-uncertain="true"]')).toHaveCount(2);
  await expect(internship.getByText("Check this").first()).toBeVisible();
  await expect(internship.getByRole("link", { name: /from line \d+/ }).first()).toBeVisible();

  // IM-3: a certificate link upgrades the confirm to Verified.
  await page
    .getByTestId("support-link-ext-internship")
    .fill("https://example.com/credentials/abc");
  await page.getByTestId("attach-link-ext-internship").click();
  await expect(internship).toContainText(
    "A certificate is attached, so confirming records this as Verified.",
  );

  await page.getByTestId("confirm-ext-internship").click();
  await expect(internship).toHaveAttribute("data-status", "confirmed", {
    timeout: NAV_TIMEOUT,
  });
  await expect(internship).toContainText("In your workspace");

  // Rejecting records a decision but never writes an item.
  await page.getByTestId("reject-ext-education").click();
  await expect(page.getByTestId("review-item-ext-education")).toHaveAttribute(
    "data-status",
    "rejected",
  );
  await page.getByTestId("undo-ext-education").click();
  await expect(page.getByTestId("review-item-ext-education")).toHaveAttribute(
    "data-status",
    "pending",
  );

  const items = await workspaceItems(page);
  expect(items).toHaveLength(1);
  expect(items[0].title).toBe("Backend Intern");
  expect(items[0].evidence).toBe("verified");
  expect(items[0].links).toContain("https://example.com/credentials/abc");

  // A second item without a certificate records User-attested (IM-3).
  await page.getByTestId("confirm-ext-project").click();
  await expect(page.getByTestId("review-item-ext-project")).toHaveAttribute(
    "data-status",
    "confirmed",
    { timeout: NAV_TIMEOUT },
  );
  const afterSecond = await workspaceItems(page);
  const project = afterSecond.find((item) => item.title === "Recipe box");
  expect(project?.evidence).toBe("attested");
});

/* ----------------------------------------- target intake, theatre, report */

test("target intake and consent gate: no consent, no analysis — then theatre to report", async ({
  page,
}) => {
  await signUp(page, { consent: "declined" });

  await fillTargetFromFixture(page, "strong");

  // The gate appears instead of starting an analysis.
  await page.getByTestId("target-submit").click();
  const gate = page.getByTestId("consent-gate");
  await expect(gate).toBeVisible();
  await expect(page).toHaveURL(/\/targets\/new/);
  // Nothing was created while consent is missing.
  expect(await apiGet<unknown[]>(page, "/api/v1/targets")).toHaveLength(0);
  await expect(page.getByTestId("consent-decline-button")).toBeVisible();

  // The analyse button is disabled until the box is checked.
  const accept = page.getByTestId("consent-accept-button");
  await expect(accept).toBeDisabled();
  await page.getByTestId("consent-checkbox").click();
  await expect(accept).toBeEnabled();
  await accept.click();

  // Consent recorded → target saved → analysis theatre starts.
  await expect(page).toHaveURL(/\/targets\/tgt-/, { timeout: NAV_TIMEOUT });
  await expect(page.getByTestId("analysis-theatre")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  const stages = page.locator("[data-stage]");
  await expect(stages).toHaveCount(6);
  for (const label of [
    "Reading the job",
    "Extracting requirements",
    "Searching your workspace",
    "Matching evidence",
    "Scoring",
    "Writing report",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // The active stage really advances instead of faking a spinner.
  await expect
    .poll(async () => page.getByTestId("stage-active-label").innerText(), {
      timeout: 20_000,
    })
    .not.toBe("Reading the job");
  // Progress is announced accessibly.
  await expect(page.getByRole("progressbar", { name: "Analysis progress" })).toBeVisible();

  // The report replaces the theatre when the run succeeds.
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });

  // PRD §6.5 — score ring, factor weights and the methodology.
  await expect(
    page.getByRole("heading", { name: "Match score and factors" }),
  ).toBeVisible();
  const score = await matchScore(page);
  expect(score).toBeGreaterThan(0);
  expect(score).toBeLessThanOrEqual(100);
  await expect(page.getByText("How this is calculated.")).toBeVisible();
  await expect(
    page.getByText("This is not a probability of being hired."),
  ).toBeVisible();
  await expect(page.getByText(/Required skills/).first()).toBeVisible();

  // PRD §6.4 JD-3: Matched / Partially matched / Unsupported, with evidence.
  await expect(
    page.getByRole("heading", { name: "Requirements against your evidence" }),
  ).toBeVisible();
  await expect(page.getByTestId("requirement-list").locator("li")).not.toHaveCount(0);
  await expect(page.getByText(/\d+ matched/).first()).toBeVisible();
  await expect(page.getByText(/\d+ partial/).first()).toBeVisible();
  await expect(page.getByText(/\d+ unsupported/).first()).toBeVisible();

  // JD-4: gaps split into the two honest buckets.
  await expect(page.getByRole("heading", { name: "Gaps, split honestly" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not evidenced yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Genuinely missing" })).toBeVisible();

  // PRD §6.6: skills + content report + roadmap.
  await expect(page.getByRole("heading", { name: "Skills analysis" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What goes into the resume, and why" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Improvement roadmap" })).toBeVisible();

  // PRD §6.7: ATS panel with the disclaimer (never a guarantee).
  await expect(page.getByRole("heading", { name: "ATS panel" })).toBeVisible();
  await expect(page.getByText(/ATS score \d+/)).toBeVisible();
  await expect(page.getByText(/Keyword coverage \d+%/)).toBeVisible();
  await expect(
    page.getByText("Based on defined checks. Not a guarantee for any employer's ATS."),
  ).toBeVisible();
  await expect(page.getByTestId("ats-checks").locator("li")).not.toHaveCount(0);

  // The list shows the same score without re-running anything.
  await gotoReady(page, "/targets");
  await expect(page.getByTestId("target-list").locator("li")).toHaveCount(1);
  await expect(page.getByText(`Score ${score}`)).toBeVisible();
});

/* ------------------------------------------------------- failure + retry */

test("analysis failure shows the failed stage, offers retry and recovers", async ({
  page,
}) => {
  await signUp(page);
  await fillTargetFromFixture(page, "partial");
  await page.getByTestId("target-submit").click();

  await expect(page.getByTestId("analysis-theatre")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  // Turn the dev provider failure on *after* the page has loaded, so the run
  // fails mid-flight exactly like a real outage.
  await apiPost(page, "/api/v1/dev/failures", { enabled: true });

  const alert = page.getByRole("alert").filter({ hasText: "stopped responding" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("analysis-retry")).toBeVisible();
  // The failed stage is named, not left ambiguous.
  await expect(page.getByText("Analysis stopped").first()).toBeVisible();

  await apiPost(page, "/api/v1/dev/failures", { enabled: false });
  await page.getByTestId("analysis-retry").click();
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });
});

/* ------------------------------------------- the three report fixtures */

test("the strong, partial and poor postings render distinct reports", async ({
  page,
}) => {
  await signUp(page);
  // The fixture postings are written against the mid-level workspace.
  await apiPost(page, "/api/v1/dev/workspace-persona", { persona: "midlevel" });
  await apiPost(page, "/api/v1/dev/sample-targets", {});

  const ids = ["strong", "partial", "poor"] as const;
  const scores: number[] = [];
  for (const id of ids) {
    await gotoReady(page, `/targets/sample-target-${id}`);
    await expect(page.getByTestId("report-view")).toBeVisible({
      timeout: RUN_TIMEOUT,
    });
    await expect(page.getByText("Sample posting")).toBeVisible();
    scores.push(await matchScore(page));
  }

  // Ordered and distinct — a flat or inverted fixture set is a bug.
  expect(scores[0]).toBeGreaterThan(scores[1]);
  expect(scores[1]).toBeGreaterThan(scores[2]);
  expect(scores[0] - scores[1]).toBeGreaterThanOrEqual(10);
  expect(scores[1] - scores[2]).toBeGreaterThanOrEqual(10);

  // The partial posting demonstrates every requirement state and both gaps.
  await gotoReady(page, "/targets/sample-target-partial");
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(page.getByText(/\d+ partial/).first()).toBeVisible();

  // The poor posting is dominated by genuine gaps and still suggests a roadmap.
  await gotoReady(page, "/targets/sample-target-poor");
  await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });
  await expect(page.getByRole("heading", { name: "Genuinely missing" })).toBeVisible();
  await expect(page.getByTestId("roadmap").locator("li")).not.toHaveCount(0);
});

/* ------------------------------------------------------- reduced motion */

test.describe("prefers-reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the theatre renders its static version and still reaches the report", async ({
    page,
  }) => {
    await signUp(page);
    await fillTargetFromFixture(page, "strong");
    await page.getByTestId("target-submit").click();

    await expect(page.getByTestId("analysis-theatre")).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    // The static state marker, not a sped-up animation.
    await expect(page.getByTestId("stage-progress")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });
  });
});

/* ---------------------------------------------------------------- mobile */

test.describe("mobile 360px", () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("import review and targets fit 360px without horizontal scroll", async ({
    page,
  }) => {
    await signUp(page);

    // Import review must stack the source above the fields, not overflow.
    await gotoReady(page, "/workspace/import");
    await page.getByTestId("upload-input").setInputFiles({
      name: "example-cv.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(4096, 1),
    });
    await expect(page.getByTestId("import-review")).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expectNoHorizontalOverflow(page);

    // Targets list, intake form and a finished report at 360px.
    await gotoReady(page, "/targets");
    await expect(page.getByRole("heading", { name: "Jobs you're aiming at" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await fillTargetFromFixture(page, "strong");
    await expectNoHorizontalOverflow(page);
    await page.getByTestId("target-submit").click();

    await expect(page.getByTestId("report-view")).toBeVisible({ timeout: RUN_TIMEOUT });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { name: "ATS panel" })).toBeVisible();
  });
});
