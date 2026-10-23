import { expect, test, type Page } from "@playwright/test";

// Sign-up + a 5s staged analysis + resume generation + 350ms mock latency.
test.setTimeout(240_000);

const NAV_TIMEOUT = 30_000;
const RUN_TIMEOUT = 45_000;

/**
 * F6 E2E: History's real delete/purge controls (B6 §9.3).
 *
 * A tailored resume is generated, one cited workspace item is soft-deleted,
 * then the History page drives the purge and delete confirmations. Warnings come
 * from `removedEvidenceIds` on the list response, so no per-resume detail fetch
 * is needed.
 */

interface ResumeShape {
  id: string;
  title: string | null;
  sections: {
    key: string;
    claims: { text: string; evidenceIds: string[] }[];
  }[];
  removedEvidenceIds: string[];
}

interface VersionShape {
  id: string;
  reason: string;
  removedEvidenceIds: string[];
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

async function signUp(page: Page) {
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("F6 History");
  await page.getByLabel("Email").fill(uniqueEmail("f6-history"));
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

async function apiJson<T>(
  page: Page,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ url, verb, payload }) => {
      const response = await fetch(url, {
        method: verb,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
    { url: path, verb: method, payload: body },
  );
}

async function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} failed: ${response.status}`);
    return response.json();
  }, path);
}

test("purge rewrites deleted-source lines, then delete removes the resume", async ({
  page,
}) => {
  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "midlevel",
  });
  await apiJson(page, "POST", "/api/v1/dev/sample-targets", {});

  await gotoReady(page, "/targets/sample-target-strong");
  await expect(page.getByTestId("report-view")).toBeVisible({
    timeout: RUN_TIMEOUT,
  });

  const generated = await apiJson<ResumeShape>(
    page,
    "POST",
    "/api/v1/targets/sample-target-strong/resume",
    { title: "F6 purge target", rewordWithAi: false },
  );
  const detail = await apiGet<ResumeShape>(
    page,
    `/api/v1/resumes/${generated.id}`,
  );
  const cited = detail.sections
    .flatMap((section) => section.claims)
    .find((claim) => claim.evidenceIds.length > 0)?.evidenceIds[0];
  expect(cited).toBeTruthy();

  await apiJson(page, "DELETE", `/api/v1/workspace/items/${cited}`);

  await gotoReady(page, "/history");
  const card = page.getByTestId(`history-resume-${generated.id}`);
  await expect(card).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(card.getByTestId("removed-information-warning")).toContainText(
    "removed source item",
  );

  await card.getByTestId(`purge-resume-${generated.id}`).click();
  const purgeDialog = page.getByTestId("confirm-destructive-dialog");
  await expect(purgeDialog).toBeVisible();
  await expect(purgeDialog).toContainText("Rewrites this resume");
  await page.getByTestId("confirm-purge-resume").click();
  await expect(
    page.getByRole("status").getByText("Deleted-source lines removed"),
  ).toBeVisible({ timeout: NAV_TIMEOUT });

  const versions = await apiGet<VersionShape[]>(
    page,
    `/api/v1/resumes/${generated.id}/versions`,
  );
  expect(versions.some((version) => version.reason === "purged")).toBe(true);

  // The purge is non-destructive: the resume is still in History, and the
  // warning disappears because no line cites the deleted item any more.
  await expect(card).toBeVisible();
  await expect(card.getByTestId("removed-information-warning")).toHaveCount(0);

  await card.getByTestId(`delete-resume-${generated.id}`).click();
  const deleteDialog = page.getByTestId("confirm-destructive-dialog");
  await expect(deleteDialog).toContainText("permanently deletes the tailored resume");
  await expect(deleteDialog).toContainText("not touched");
  await page.getByTestId("confirm-delete-resume").click();
  await expect(
    page.getByRole("status").getByText("Resume deleted"),
  ).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(card).toHaveCount(0);

  const remaining = await apiGet<ResumeShape[]>(page, "/api/v1/resumes");
  expect(remaining.some((resume) => resume.id === generated.id)).toBe(false);
});
