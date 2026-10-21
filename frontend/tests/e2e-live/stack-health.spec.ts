import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { liveE2eCredentials, liveE2eEnabled } from "./backend-env";

/**
 * Stack-health live audit (opt-in, I1 live mode).
 *
 * Not part of `npm run e2e`: the default suite stays MSW-only. This spec runs
 * only with `RUN_LIVE_E2E=1` and real user A credentials in
 * `backend/.env.test` (`SUPABASE_TEST_EMAIL_A` / `SUPABASE_TEST_PASSWORD_A`;
 * exported `LIVE_E2E_*` values still override them), against the local FastAPI
 * backend and the real Supabase project. It is an *instrument*, not a gate:
 *
 *  1. `main live actions` walks the real flows once (add, edit, reorder,
 *     delete, import a synthetic PDF, confirm a review item, create a target,
 *     grant consent, run the analysis) and records what the UI showed.
 *  2. `route sweep` visits every built route at 1280px and 360px and records,
 *     per route: console errors, failed requests (path + status, no query),
 *     hydration warnings, axe (WCAG 2.x A/AA) violations and any action
 *     element that is clipped horizontally or overlaps another action.
 *
 * Results are printed as one line per route and attached as JSON, so the audit
 * report can quote them. Nothing here asserts that the product is defect-free;
 * only a hard 5xx page load fails the run. No credentials or response bodies
 * are ever printed.
 */

const enabled = liveE2eEnabled();
const { email, password } = liveE2eCredentials();

const SECTIONS = [
  "personal",
  "education",
  "experience",
  "internship",
  "project",
  "skill",
  "achievement",
  "extracurricular",
  "certificate",
  "course",
  "publication",
  "training",
] as const;

const ROUTES = [
  "/",
  "/design-system",
  "/forgot-password",
  "/signin",
  "/signup",
  "/onboarding",
  "/history",
  "/privacy",
  "/resume",
  "/settings",
  "/targets",
  "/targets/new",
  "/workspace",
  "/workspace/import",
  ...SECTIONS.map((section) => `/workspace/${section}`),
];

const AUDIT_DIR = join(process.cwd(), "test-results", "live-audit");
const TARGET_FILE = join(AUDIT_DIR, "target.json");

interface AxeFinding {
  id: string;
  impact: string | null;
  nodes: number;
  targets: string[];
}

interface RouteAudit {
  route: string;
  width: number;
  documentStatus: number | null;
  finalUrl: string;
  durationMs: number;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  hydrationWarnings: string[];
  axe: AxeFinding[];
  axeError: string | null;
  clipped: string[];
  overlapping: string[];
  horizontalOverflow: boolean;
  scrollWidth: number;
  viewportWidth: number;
}

/** Minimal valid text PDF, generated in code (fictional content only). */
function syntheticPdf(lines: string[]): Buffer {
  const escape = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const body = ["BT", "/F1 12 Tf", "14 TL", "72 740 Td"];
  for (const line of lines) {
    body.push(`(${escape(line)}) Tj`);
    body.push("T*");
  }
  body.push("ET");
  const content = Buffer.from(body.join("\n"), "latin1");

  const objects = new Map<number, Buffer>([
    [1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1")],
    [2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1")],
    [
      3,
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
          "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        "latin1",
      ),
    ],
    [
      4,
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
        content,
        Buffer.from("\nendstream", "latin1"),
      ]),
    ],
    [
      5,
      Buffer.from(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        "latin1",
      ),
    ],
  ]);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let offset = chunks[0]!.length;
  const offsets = new Map<number, number>();
  for (let number = 1; number <= 5; number += 1) {
    offsets.set(number, offset);
    const object = Buffer.concat([
      Buffer.from(`${number} 0 obj\n`, "latin1"),
      objects.get(number)!,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(object);
    offset += object.length;
  }

  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let number = 1; number <= 5; number += 1) {
    xref += `${String(offsets.get(number)).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

function isHydrationWarning(text: string): boolean {
  return /hydrat|did not match|server rendered|text content does not match/i.test(text);
}

function requestLabel(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Path only: query strings can carry tokens or filter values.
  return parsed.pathname;
}

interface LayoutFinding {
  clipped: string[];
  overlapping: string[];
  horizontalOverflow: boolean;
  scrollWidth: number;
  viewportWidth: number;
}

/**
 * Measure the rendered page for horizontal clipping and action-on-action
 * overlap. Nested elements and zero-sized/invisible controls are ignored, as
 * are Next.js dev-overlay elements (the overlay never ships to production).
 */
async function measureLayout(page: Page): Promise<LayoutFinding> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]';
    const label = (el: HTMLElement) => {
      const testId = el.getAttribute("data-testid");
      const aria = el.getAttribute("aria-label");
      const text = (el.textContent ?? "").trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${testId ? `[${testId}]` : ""}${
        aria ? `(${aria})` : text ? `(${text})` : ""
      }`;
    };

    const visible = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((el) => {
      if (el.closest("nextjs-portal")) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 1 &&
        rect.height > 1 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity) > 0
      );
    });

    const clipped: string[] = [];
    for (const el of visible) {
      const rect = el.getBoundingClientRect();
      if (rect.left < -1 || rect.right > vw + 1) {
        clipped.push(`${label(el)} ${Math.round(rect.left)}..${Math.round(rect.right)} (vw ${vw})`);
      }
    }

    const overlapping: string[] = [];
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i]!;
        const b = visible[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        if (
          ra.bottom < 0 ||
          rb.bottom < 0 ||
          ra.top > window.innerHeight ||
          rb.top > window.innerHeight
        )
          continue;
        const width = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const height = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (width <= 4 || height <= 4) continue;
        const overlapArea = width * height;
        const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (smaller <= 0 || overlapArea / smaller < 0.5) continue;
        overlapping.push(`${label(a)} ∩ ${label(b)}`);
      }
    }

    return {
      clipped,
      overlapping,
      horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: vw,
    };
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/workspace/, { timeout: 60_000 });
  // `exact` matters: the empty-state heading also starts with "Your workspace".
  await expect(
    page.getByRole("heading", { name: "Your workspace", exact: true }),
  ).toBeVisible({
    timeout: 60_000,
  });
}

async function readTargetUrl(): Promise<string | null> {
  try {
    // Playwright keeps the module in one worker, so the action test sets it.
    const raw = process.env.LIVE_AUDIT_TARGET_URL;
    if (raw) return raw;
    const { readFileSync } = await import("node:fs");
    const parsed = JSON.parse(readFileSync(TARGET_FILE, "utf8")) as { url?: string };
    return parsed.url ?? null;
  } catch {
    return null;
  }
}

test.describe("live stack audit", () => {
  test.skip(
    !enabled || !email || !password,
    "Set RUN_LIVE_E2E=1 and user A credentials in backend/.env.test.",
  );

  test("main live actions: add, edit, reorder, delete, import, confirm, target, analysis", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);

    const stamp = Date.now();
    const prefix = `Live audit ${stamp}`;
    const firstRole = `${prefix} role one`;
    const secondRole = `${prefix} role two`;
    const importedTitle = `${prefix} imported role`;
    const targetRole = `${prefix} engineer`;

    mkdirSync(AUDIT_DIR, { recursive: true });
    const notes: string[] = [];

    // --- workspace: add two items ---------------------------------------
    await page.goto("/workspace/experience");
    await page
      .getByRole("button", { name: /^Add experience$/ })
      .first()
      .click();
    await page.locator("#item-title").fill(firstRole);
    await page.locator("#item-organization").fill("Example Live Audit Ltd");
    await page.locator("#item-start").fill("2024-01");
    await page.locator("#item-end").fill("2024-06");
    await page.getByRole("button", { name: "Save item" }).click();
    await expect(page.getByText(firstRole, { exact: true })).toBeVisible({ timeout: 60_000 });
    notes.push("workspace create: first item visible");

    await page
      .getByRole("button", { name: /^Add experience$/ })
      .first()
      .click();
    await page.locator("#item-title").fill(secondRole);
    await page.locator("#item-organization").fill("Example Live Audit Ltd");
    await page.locator("#item-start").fill("2023-01");
    await page.locator("#item-end").fill("2023-06");
    await page.getByRole("button", { name: "Save item" }).click();
    await expect(page.getByText(secondRole, { exact: true })).toBeVisible({ timeout: 60_000 });
    notes.push("workspace create: second item visible");

    // --- workspace: edit (autosave) -------------------------------------
    await page.getByRole("button", { name: `Edit ${firstRole}` }).click();
    await page.locator("#item-location").fill("Example City");
    await expect(page.getByText(/^Saved at/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    notes.push("workspace edit: autosave reached 'Saved at'");

    // --- workspace: reorder (keyboard-accessible move buttons) ----------
    await page.getByRole("button", { name: `Move ${secondRole} up` }).click();
    // Other rows may already exist in this account, so assert relative order
    // rather than "first in the section".
    await expect
      .poll(
        async () => {
          const texts = await page.getByTestId("workspace-item").allTextContents();
          const second = texts.findIndex((text) => text.includes(secondRole));
          const first = texts.findIndex((text) => text.includes(firstRole));
          return second >= 0 && first >= 0 && second < first;
        },
        {
          timeout: 60_000,
          message: "the second item should be ordered above the first",
        },
      )
      .toBe(true);
    notes.push("workspace reorder: second item now sits above the first");

    // --- workspace: delete + undo toast ---------------------------------
    await page.getByRole("button", { name: `Delete ${secondRole}` }).click();
    await expect(page.getByText(secondRole, { exact: true })).toBeHidden({ timeout: 60_000 });
    notes.push("workspace delete: row removed (soft delete)");

    // --- import: synthetic PDF, edit, confirm ---------------------------
    await page.goto("/workspace/import");
    await page.getByTestId("upload-input").setInputFiles({
      name: "live-audit.pdf",
      mimeType: "application/pdf",
      buffer: syntheticPdf([
        "EXAMPLE LIVE CANDIDATE",
        "Example City, EX",
        "example.live.candidate@example.com",
        "",
        "EXPERIENCE",
        "Example Live Audit Intern",
        "Example Live Audit Ltd",
        "Jan 2024 - Sep 2024",
        "- Built an internal reporting endpoint for the support team.",
        "",
        "EDUCATION",
        "BSc Computer Science",
        "Example University",
        "Sep 2019 - Jun 2022",
        "",
        "SKILLS",
        "TypeScript, Python",
      ]),
    });
    await expect(page.getByTestId("import-review")).toBeVisible({ timeout: 120_000 });
    const experienceCard = page.locator('article[data-section="experience"]').first();
    const anyCard = page.locator('article[data-testid^="review-item-"]').first();
    const card = (await experienceCard.count()) > 0 ? experienceCard : anyCard;
    await expect(card).toBeVisible({ timeout: 60_000 });
    const importedSection = (await card.getAttribute("data-section")) ?? "experience";
    const titleInput = card.locator('input[data-testid^="value-title-"]');
    if ((await titleInput.count()) > 0) {
      await titleInput.fill(importedTitle);
      await titleInput.blur();
    }
    const confirm = card.locator('[data-testid^="confirm-"]');
    if ((await confirm.count()) > 0) {
      await confirm.click();
      await expect(card).toHaveAttribute("data-status", "confirmed", { timeout: 60_000 });
      notes.push("import: review item confirmed and marked In your workspace");
    } else {
      notes.push("import: card offered no confirm button (already decided)");
    }

    // --- target: create + consent + analysis ----------------------------
    await page.goto("/targets/new");
    await page.getByTestId("target-role").fill(targetRole);
    await page.getByTestId("target-company").fill("Example Live Audit Ltd");
    await page
      .getByTestId("target-jd")
      .fill(
        "We are looking for a backend engineer to build reporting APIs with Python and " +
          "PostgreSQL, and to work with TypeScript on the dashboard. Experience with " +
          "REST APIs and automated testing is required.",
      );
    await page.getByTestId("target-skill-input").fill("Python");
    await page.getByTestId("target-skill-add").click();
    // S-09: the consent lookup starts on mount. A submit while it is still in
    // flight is refused with "still checking ... try again", which is correct
    // but meant this automated run only clicked once. Wait for the lookup like
    // a person would, then submit.
    await expect(page.getByTestId("consent-checking")).toBeHidden({ timeout: 60_000 });
    await page.getByTestId("target-submit").click();

    const gate = page.getByTestId("consent-gate");
    const gateShown = await gate
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (gateShown) {
      await page.getByTestId("consent-checkbox").click();
      await page.getByTestId("consent-accept-button").click();
      notes.push("consent: gate shown, consent accepted");
    } else {
      notes.push("consent: already granted, gate not shown");
    }

    await expect(page).toHaveURL(/\/targets\/[0-9a-f-]{36}/, { timeout: 120_000 });
    const targetUrl = new URL(page.url()).pathname;
    // Persist the URL before waiting for the report: the route sweep must still
    // be able to visit /targets/[id] if the analysis itself fails.
    writeFileSync(
      TARGET_FILE,
      JSON.stringify({ url: targetUrl, createdAt: new Date().toISOString() }, null, 2),
    );
    process.env.LIVE_AUDIT_TARGET_URL = targetUrl;

    const reportShown = await expect(page.getByTestId("report-view"))
      .toBeVisible({ timeout: 240_000 })
      .then(() => true)
      .catch(() => false);
    if (reportShown) {
      const scoreText = await page
        .getByTestId("report-view")
        .locator("text=/score/i")
        .first()
        .textContent()
        .catch(() => null);
      notes.push(
        `analysis: report rendered${scoreText ? ` (${scoreText.trim().slice(0, 40)})` : ""}`,
      );
    } else {
      const theatre = await page
        .getByTestId("analysis-theatre")
        .textContent()
        .catch(() => null);
      notes.push(
        `analysis: report did NOT render within 240s${
          theatre ? ` (theatre: ${theatre.trim().slice(0, 120)})` : ""
        }`,
      );
    }

    // --- cleanup: remove the workspace items this run created -----------
    // The imported card may land in education/personal, not experience, so
    // sweep both sections and match the run prefix.
    let removed = 0;
    for (const section of new Set(["experience", importedSection])) {
      await page.goto(`/workspace/${section}`);
      // The section renders its header immediately; rows arrive with the
      // workspace query. Wait for the list before counting, otherwise the
      // first count is 0 and cleanup silently does nothing.
      await expect(page.getByTestId("workspace-list")).toBeVisible({ timeout: 60_000 });
      for (let guard = 0; guard < 12; guard += 1) {
        const rows = page.getByTestId("workspace-item").filter({ hasText: /Live audit \d+/ });
        const before = await rows.count();
        if (before === 0) break;
        await rows
          .first()
          .getByRole("button", { name: /^Delete / })
          .click();
        await expect(rows).toHaveCount(before - 1, { timeout: 60_000 });
        removed += 1;
      }
    }
    notes.push(`cleanup: deleted ${removed} workspace item(s) created by this run`);
    notes.push("residue: job targets have no delete route; the live-audit target remains");

    test.info().attach("live-actions.json", {
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({ notes, targetUrl }, null, 2)),
    });
    console.log(notes.map((note) => `[live-actions] ${note}`).join("\n"));
  });

  for (const width of [1280, 360]) {
    test(`route sweep @ ${width}px`, async ({ page }) => {
      test.setTimeout(1_200_000);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await signIn(page);

      const targetUrl = await readTargetUrl();
      const routes = targetUrl ? [...ROUTES, targetUrl] : ROUTES;
      if (!targetUrl) {
        console.log(
          "[live-audit] no target detail URL from the actions test; skipping /targets/[id]",
        );
      }

      const entries: RouteAudit[] = [];
      const consoleMessages: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];

      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          consoleMessages.push(`[console.${message.type()}] ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        const status = response.status();
        if (status < 400) return;
        const path = requestLabel(response.url());
        if (!path) return;
        failedRequests.push(`${response.request().method()} ${path} ${status}`);
      });
      page.on("requestfailed", (request) => {
        const path = requestLabel(request.url());
        if (!path) return;
        failedRequests.push(`${request.method()} ${path} failed`);
      });

      // Give the per-IP limiter (60/min) an empty window: a sweep is far more
      // traffic than a person generates, and we want UI findings, not 429s.
      await page.waitForTimeout(65_000);

      for (const route of routes) {
        const consoleMark = consoleMessages.length;
        const pageErrorMark = pageErrors.length;
        const failedMark = failedRequests.length;
        const started = Date.now();

        let documentStatus: number | null = null;
        try {
          const response = await page.goto(route, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          documentStatus = response?.status() ?? null;
        } catch (error) {
          pageErrors.push(`navigation ${route}: ${(error as Error).message.split("\n")[0] ?? ""}`);
        }
        // Settle client fetches and the dev overlay without waiting for the
        // analysis poll (a target with a running analysis never goes idle).
        await page.waitForTimeout(4_000);

        const routeConsole = consoleMessages.slice(consoleMark);
        const hydrationWarnings = routeConsole.filter(isHydrationWarning);

        let axe: AxeFinding[] = [];
        let axeError: string | null = null;
        try {
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .exclude("nextjs-portal")
            .analyze();
          axe = results.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact ?? null,
            nodes: violation.nodes.length,
            targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
          }));
        } catch (error) {
          axeError = (error as Error).message.split("\n")[0] ?? "axe failed";
        }

        const layout = await measureLayout(page).catch(() => ({
          clipped: [],
          overlapping: [],
          horizontalOverflow: false,
          scrollWidth: 0,
          viewportWidth: width,
        }));

        const entry: RouteAudit = {
          route,
          width,
          documentStatus,
          finalUrl: new URL(page.url()).pathname,
          durationMs: Date.now() - started,
          consoleErrors: routeConsole.filter((line) => line.startsWith("[console.error]")),
          pageErrors: pageErrors.slice(pageErrorMark),
          failedRequests: failedRequests.slice(failedMark),
          hydrationWarnings,
          axe,
          axeError,
          clipped: layout.clipped,
          overlapping: layout.overlapping,
          horizontalOverflow: layout.horizontalOverflow,
          scrollWidth: layout.scrollWidth,
          viewportWidth: layout.viewportWidth,
        };
        entries.push(entry);

        console.log(
          `[live-audit ${width}] ${route} status=${documentStatus ?? "ERR"} ` +
            `console=${entry.consoleErrors.length} pageErrors=${entry.pageErrors.length} ` +
            `failed=${entry.failedRequests.length} hydration=${entry.hydrationWarnings.length} ` +
            `axe=${entry.axe.length} clipped=${entry.clipped.length} ` +
            `overlap=${entry.overlapping.length} overflow=${entry.horizontalOverflow}` +
            (entry.axeError ? ` axeError=${entry.axeError}` : ""),
        );
      }

      mkdirSync(AUDIT_DIR, { recursive: true });
      const file = join(AUDIT_DIR, `routes-${width}.json`);
      writeFileSync(file, JSON.stringify(entries, null, 2));
      await test.info().attach(`live-routes-${width}.json`, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(entries, null, 2)),
      });

      const hardFailures = entries.filter(
        (entry) => entry.documentStatus !== null && entry.documentStatus >= 500,
      );
      expect(hardFailures, "routes returning 5xx").toEqual([]);

      const totals = entries.reduce(
        (sum, entry) => ({
          console: sum.console + entry.consoleErrors.length,
          failed: sum.failed + entry.failedRequests.length,
          hydration: sum.hydration + entry.hydrationWarnings.length,
          axe: sum.axe + entry.axe.length,
          clipped: sum.clipped + entry.clipped.length,
          overlap: sum.overlap + entry.overlapping.length,
        }),
        { console: 0, failed: 0, hydration: 0, axe: 0, clipped: 0, overlap: 0 },
      );
      console.log(
        `[live-audit ${width}] totals route=${entries.length} console=${totals.console} ` +
          `failed=${totals.failed} hydration=${totals.hydration} axe=${totals.axe} ` +
          `clipped=${totals.clipped} overlap=${totals.overlap}`,
      );
    });
  }

  // `/targets/[id]` only exists once the actions test has created a target, so
  // it gets its own small pass at both widths rather than a placeholder URL.
  for (const width of [1280, 360]) {
    test(`target detail route @ ${width}px`, async ({ page }) => {
      test.setTimeout(300_000);
      const targetUrl = await readTargetUrl();
      test.skip(!targetUrl, "No target URL from the actions test.");

      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await signIn(page);

      const consoleLines: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          consoleLines.push(`[console.${message.type()}] ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const path = requestLabel(response.url());
        if (path)
          failedRequests.push(`${response.request().method()} ${path} ${response.status()}`);
      });
      page.on("requestfailed", (request) => {
        const path = requestLabel(request.url());
        if (path) failedRequests.push(`${request.method()} ${path} failed`);
      });

      const consoleMark = consoleLines.length;
      const pageErrorMark = pageErrors.length;
      const failedMark = failedRequests.length;
      const response = await page.goto(targetUrl!, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await page.waitForTimeout(4_000);

      const routeConsole = consoleLines.slice(consoleMark);
      const hydration = routeConsole.filter(isHydrationWarning);
      let axe: AxeFinding[] = [];
      let axeError: string | null = null;
      try {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .exclude("nextjs-portal")
          .analyze();
        axe = results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact ?? null,
          nodes: violation.nodes.length,
          targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
        }));
      } catch (error) {
        axeError = (error as Error).message.split("\n")[0] ?? "axe failed";
      }
      const layout = await measureLayout(page);
      const entry: RouteAudit = {
        route: targetUrl!,
        width,
        documentStatus: response?.status() ?? null,
        finalUrl: new URL(page.url()).pathname,
        durationMs: 0,
        consoleErrors: routeConsole.filter((line) => line.startsWith("[console.error]")),
        pageErrors: pageErrors.slice(pageErrorMark),
        failedRequests: failedRequests.slice(failedMark),
        hydrationWarnings: hydration,
        axe,
        axeError,
        clipped: layout.clipped,
        overlapping: layout.overlapping,
        horizontalOverflow: layout.horizontalOverflow,
        scrollWidth: layout.scrollWidth,
        viewportWidth: layout.viewportWidth,
      };

      mkdirSync(AUDIT_DIR, { recursive: true });
      writeFileSync(join(AUDIT_DIR, `target-${width}.json`), JSON.stringify(entry, null, 2));
      await test.info().attach(`live-target-${width}.json`, {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify(entry, null, 2)),
      });
      console.log(
        `[live-audit ${width}] ${targetUrl} status=${entry.documentStatus ?? "ERR"} ` +
          `console=${entry.consoleErrors.length} pageErrors=${entry.pageErrors.length} ` +
          `failed=${entry.failedRequests.length} hydration=${hydration.length} axe=${axe.length} ` +
          `clipped=${entry.clipped.length} overlap=${entry.overlapping.length} ` +
          `overflow=${entry.horizontalOverflow}` +
          (axeError ? ` axeError=${axeError}` : ""),
      );
      expect(entry.documentStatus ?? 200).toBeLessThan(500);
    });
  }
});
