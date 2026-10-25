import { expect, test, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Sign-up + onboarding + a fresh workspace read per navigation.
test.setTimeout(180_000);

const NAV_TIMEOUT = 30_000;

/**
 * F6 E2E: Download PDF uses the one shared `ResumeDocument`, not a plain-text
 * generator. Download PDF opens the browser print path with the title
 * `<Name> - Resume`, so the test (a) spies on `window.print()` to prove the
 * candidate-named title, and (b) prints the page to a real PDF via Chromium to
 * prove the ATS layout: bold name header, merged section labels, formatted
 * dates and no raw workspace keys or ISO dates.
 */
const FORBIDDEN = [
  "PERSONAL",
  "EXTRACURRICULAR",
  "COURSES",
  "CERTIFICATE",
  "STANDARD RESUME",
  "2022-09",
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
  await page.getByLabel("Full name").fill("F6 Export");
  await page.getByLabel("Email").fill(uniqueEmail("f6-export"));
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

interface PrintSpy {
  __printTitles: string[];
}

async function extractPdf(
  buffer: Buffer,
): Promise<{ text: string; pages: number }> {
  const document = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  return {
    text: pages.join("\n").replace(/\s+/g, " ").trim(),
    pages: document.numPages,
  };
}

test("Download PDF prints with the candidate-named title", async ({ page }) => {
  await page.addInitScript(() => {
    const spy = window as unknown as PrintSpy & { print: () => void };
    spy.__printTitles = [];
    spy.print = () => {
      spy.__printTitles.push(document.title);
    };
  });

  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "fresher",
  });
  await gotoReady(page, "/resume");
  await expect(
    page.getByRole("heading", { name: "Standard resume", exact: true }),
  ).toBeVisible();

  const exportButton = page.getByTestId("pdf-export-button");
  await expect(exportButton).toBeEnabled({ timeout: NAV_TIMEOUT });
  await expect(exportButton).toHaveText("Download PDF");

  await exportButton.click();
  await expect(page.getByTestId("pdf-export-status")).toContainText(
    "Print dialog opened",
  );

  const titles = await page.evaluate(
    () => (window as unknown as PrintSpy).__printTitles,
  );
  expect(titles).toContain("Ada Fern - Resume");
});

test("the printed PDF is a one-page ATS document, not a text dump", async ({
  page,
}) => {
  await signUp(page);
  // Ada Fern (fresher) has the ISO dates and split workspace sections the bug
  // report used; the document model must merge and format them.
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "fresher",
  });
  await gotoReady(page, "/resume");
  await expect(page.getByTestId("resume-paper")).toBeVisible();

  // Chromium's print engine is exactly what Download PDF uses; capture it.
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    preferCSSPageSize: true,
  });
  const { text, pages } = await extractPdf(Buffer.from(pdf));
  const upper = text.toUpperCase();

  expect(pages).toBe(1);
  expect(upper).toContain("ADA FERN");
  expect(text).toContain("Example City");
  expect(text).toContain("Sep 2022 – Jun 2026");
  expect(upper).toContain("EDUCATION");
  expect(upper).toContain("CERTIFICATIONS");
  expect(upper).toContain("ACHIEVEMENTS AND AWARDS");

  for (const forbidden of FORBIDDEN) {
    expect(upper, `PDF leaked: ${forbidden}`).not.toContain(forbidden);
  }
});

test("an empty resume keeps Download PDF disabled", async ({ page }) => {
  await signUp(page);
  await apiJson(page, "POST", "/api/v1/dev/workspace-persona", {
    persona: "empty",
  });
  await gotoReady(page, "/resume");

  const exportButton = page.getByTestId("pdf-export-button");
  await expect(exportButton).toBeDisabled({ timeout: NAV_TIMEOUT });
  await expect(page.getByTestId("pdf-export-error")).toHaveCount(0);
});
