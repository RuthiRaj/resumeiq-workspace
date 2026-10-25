import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Sign-up + onboarding + a 5.1s staged analysis for the studio case.
test.setTimeout(240_000);

const NAV_TIMEOUT = 30_000;

const FORBIDDEN = [
  "Standard resume",
  "LIVE DOCUMENT",
  "Synced",
  "Download PDF",
  "Your truth",
  "Generated from your current workspace",
  "localhost",
];

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
  await page.getByLabel("Full name").fill("Print User");
  await page.getByLabel("Email").fill(uniqueEmail("print"));
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

async function apiJson(
  page: Page,
  method: "POST",
  path: string,
  body?: unknown,
): Promise<void> {
  await page.evaluate(
    async ({ url, verb, payload }) => {
      const res = await fetch(url, {
        method: verb,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
      });
      if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    },
    { url: path, verb: method, payload: body },
  );
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }
  return pages.join("\n");
}

async function printDocument(page: Page, testId: string) {
  // `/resume` prints its visible preview; Studio/History print the portal.
  await expect(page.getByTestId(testId)).toBeAttached({
    timeout: NAV_TIMEOUT,
  });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
  });
  const text = await extractPdfText(pdf);
  const document = await getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
  }).promise;
  return { text, pages: document.numPages };
}

function expectResumeOnly(text: string) {
  const upper = text.toUpperCase();
  expect(upper).toContain("RAVI MENON");
  expect(upper).toContain("SOFTWARE ENGINEER");
  expect(upper).toContain("NORTHWIND LABS");
  expect(upper).toContain("EXPERIENCE");
  for (const forbidden of FORBIDDEN) {
    expect(text, `print leaked app text: ${forbidden}`).not.toContain(forbidden);
  }
}

test("print from /resume contains only the resume document", async ({ page }) => {
  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "midlevel",
  });
  await gotoReady(page, "/resume");
  await expect(page.getByTestId("resume-paper")).toBeVisible();

  const result = await printDocument(page, "resume-paper");
  expect(result.pages).toBe(1);
  expectResumeOnly(result.text);
  expect(result.text).not.toContain("Print");
  expect(result.text).not.toContain("ResumeIQ");
});

test("print from the Resume Studio contains only the tailored document", async ({
  page,
}) => {
  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "midlevel",
  });
  await apiJson(page, "POST", "/api/v1/dev/sample-targets", {});
  await gotoReady(page, "/targets/sample-target-strong");
  await expect(page.getByTestId("report-view")).toBeVisible({
    timeout: 45_000,
  });

  await page.getByTestId("generate-resume").click();
  await expect(page.getByTestId("generate-resume-dialog")).toBeVisible();
  await page.getByTestId("generate-resume-submit").click();
  await expect(page.getByTestId("resume-studio")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });

  const result = await printDocument(page, "resume-print-document");
  expect(result.pages).toBe(1);
  expect(result.text.toUpperCase()).toContain("RAVI MENON");
  expect(result.text.toUpperCase()).toContain("EXPERIENCE");
  for (const forbidden of FORBIDDEN) {
    expect(result.text, `print leaked app text: ${forbidden}`).not.toContain(
      forbidden,
    );
  }
});
