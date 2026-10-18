import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * UI QA sweep (fix/ui-qa). Two jobs:
 *
 * 1. Regression coverage for the two defects fixed in this branch — the shared
 *    menu placement (bounding-box assertion: a menu never overlaps its trigger,
 *    and never sits clipped off-screen) and the dev failure simulation (banner
 *    while on, in-memory so a reload starts clean).
 * 2. A route sweep at 360 / 768 / 1280 px that checks every built route for
 *    horizontal scroll, console errors/warnings, dead links, lost focus and
 *    axe (WCAG 2.x A/AA) violations.
 */

test.setTimeout(300_000);

const NAV_TIMEOUT = 30_000;

const VIEWPORTS = [
  { label: "360px", width: 360, height: 740 },
  { label: "768px", width: 768, height: 900 },
  { label: "1280px", width: 1280, height: 800 },
] as const;

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

/**
 * Console noise that is not an application defect: MSW's unhandled-request
 * warnings for RSC/document navigations, the designed 401 session probe
 * (ADR-019), and the intentionally-triggered 503/ERR_CONNECTION_REFUSED from
 * the failure-simulation test.
 */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[MSW\]/i,
  /the server responded with a status of 401/i,
  /net::ERR_/i,
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

/** Wait until MSW controls the page (see `src/mocks/start.ts`). */
async function waitForMocks(page: Page) {
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

async function gotoReady(page: Page, url: string, { mocks = true } = {}) {
  await page.goto(url);
  if (mocks) await waitForMocks(page);
}

async function signUpToWorkspace(page: Page, prefix = "qa") {
  const email = uniqueEmail(prefix);
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("QA User");
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
  // `exact` matters: the brand-new-workspace empty state renders a second
  // heading that also starts with "Your workspace".
  await expect(page.getByRole("heading", { name: "Your workspace", exact: true })).toBeVisible();
}

/** Ready-made workspace content so lists, sheets and cards have something to render. */
async function seedWorkspace(page: Page) {
  await page.evaluate(async () => {
    const items = [
      { section: "skill", title: "TypeScript" },
      { section: "skill", title: "React" },
      { section: "project", title: "Campus event tracker" },
      { section: "experience", title: "Junior Developer" },
      { section: "education", title: "BSc Computer Science" },
    ];
    for (const item of items) {
      const res = await fetch("/api/v1/workspace/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...item,
          bullets: ["Owned a piece of the product end to end."],
          tags: ["qa"],
          links: [],
          attachments: [],
          evidence: "attested",
          order: 0,
        }),
      });
      if (!res.ok) throw new Error(`Seeding ${item.title} failed: ${res.status}`);
    }
  });
}

async function seedTarget(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch("/api/v1/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "Frontend Engineer",
        company: "Northwind Labs",
        jobDescription:
          "We are looking for a frontend engineer with strong TypeScript and React experience. " +
          "You will build accessible interfaces and work with a design system. " +
          "Experience with testing and performance work is a plus.",
        requiredSkills: ["TypeScript", "React"],
      }),
    });
    if (!res.ok) throw new Error(`Seeding target failed: ${res.status}`);
    const target = (await res.json()) as { id: string };
    return target.id;
  });
}

/** Bounding box of the visible menu/popover content, if open. */
async function menuBox(page: Page) {
  return page.evaluate(() => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(
      (el) => (el as HTMLElement).getBoundingClientRect().height > 0,
    );
    const menu = menus[menus.length - 1] as HTMLElement | undefined;
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    const header = document.querySelector("header");
    return {
      ...r.toJSON(),
      side: menu.getAttribute("data-side"),
      align: menu.getAttribute("data-align"),
      zIndex: Number(getComputedStyle(menu).zIndex || 0),
      headerZIndex: header ? Number(getComputedStyle(header).zIndex || 0) : 0,
      scrollable: menu.scrollHeight > menu.clientHeight + 1,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

function overlaps(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number; left: number; right: number },
): boolean {
  return !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);
}

interface FocusState {
  focused: boolean;
  visible: boolean;
  /** Focus is inside the Next.js dev-tools overlay, which production never ships. */
  devOverlay: boolean;
  tag: string;
}

async function readFocus(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const devOverlay = Boolean(
      el && (el.tagName.toLowerCase() === "nextjs-portal" || el.closest("nextjs-portal")),
    );
    if (!el || el === document.body) {
      return { focused: false, visible: false, devOverlay, tag: "body" };
    }
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      focused: true,
      // A zero-sized box (or a hidden/display-none ancestor) means the element
      // cannot be seen. `offsetParent` is not used: it is null for fixed
      // elements, which are legitimately focusable.
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none",
      devOverlay,
      tag: `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}]`,
    };
  });
}

test.describe("defect 1 — menu placement", () => {
  for (const vp of VIEWPORTS) {
    test(`menus open clear of their trigger and inside the viewport @ ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await signUpToWorkspace(page, `menu-${vp.width}`);

      const triggers: { name: string | RegExp; label: string }[] = [
        { name: "Quick add", label: "workspace quick-add" },
        { name: "Create new", label: "topbar new" },
        { name: /account menu/i, label: "user menu" },
      ];

      for (const { name, label } of triggers) {
        const trigger = page.getByRole("button", { name });
        await trigger.scrollIntoViewIfNeeded();
        const triggerBox = (await trigger.boundingBox())!;
        await trigger.click();

        const menu = page.getByRole("menu").last();
        await expect(menu, `${label} did not open`).toBeVisible();
        await page.waitForTimeout(250);

        const box = (await menuBox(page))!;
        expect(box, `${label} has no measurable box`).not.toBeNull();

        const triggerRect = {
          top: triggerBox.y,
          bottom: triggerBox.y + triggerBox.height,
          left: triggerBox.x,
          right: triggerBox.x + triggerBox.width,
        };

        // Placement: below the trigger (or flipped above it), never overlapping.
        expect(
          overlaps(box, triggerRect),
          `${label} overlaps its trigger (menu ${box.top}-${box.bottom}, trigger ${triggerRect.top}-${triggerRect.bottom})`,
        ).toBe(false);

        if (box.side === "bottom") {
          expect(box.top, `${label} should open below the trigger`).toBeGreaterThanOrEqual(
            triggerBox.y + triggerBox.height - 1,
          );
        } else {
          expect(box.bottom, `${label} should stay above the trigger`).toBeLessThanOrEqual(
            triggerBox.y + 1,
          );
        }

        // Collision safety: the whole panel is reachable inside the viewport.
        expect(box.left, `${label} overflows the left edge`).toBeGreaterThanOrEqual(-1);
        expect(box.right, `${label} overflows the right edge`).toBeLessThanOrEqual(box.vw + 1);
        expect(box.top, `${label} overflows the top edge`).toBeGreaterThanOrEqual(-1);
        expect(box.bottom, `${label} overflows the bottom edge`).toBeLessThanOrEqual(box.vh + 1);

        // A long menu scrolls internally rather than clipping its last entry.
        const lastItem = menu.locator('[role="menuitem"]').last();
        if (await lastItem.count()) {
          await lastItem.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
          const lastBox = (await lastItem.boundingBox())!;
          expect(
            lastBox.y + lastBox.height,
            `${label}: last item is unreachable`,
          ).toBeLessThanOrEqual(box.vh + 1);
        }

        // Collision-safe stacking: above the sticky chrome, and the app's overlay layer.
        expect(box.zIndex, `${label} must sit above the sticky header`).toBeGreaterThan(box.headerZIndex);
        expect(box.zIndex, `${label} z-index lower than the overlay layer`).toBeGreaterThanOrEqual(70);

        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
      }
    });
  }
});

test.describe("defect 2 — simulated failures", () => {
  test("are in-memory, announced by a banner, and off again after a reload", async ({ page }) => {
    await signUpToWorkspace(page, "failures");

    await page.getByRole("button", { name: "Simulate failure" }).click();
    const banner = page.getByTestId("simulated-failures-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Simulated failures are ON");

    // Nothing about the toggle may be persisted outside the page's memory.
    const persisted = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)!);
      for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i)!);
      return keys.filter((k) => /failure/i.test(k));
    });
    expect(persisted, `failure flag must not be persisted: ${persisted.join(", ")}`).toEqual([]);

    // A fresh page load cannot inherit "failures on".
    await page.reload();
    await expect(page.getByTestId("simulated-failures-banner")).toBeHidden();
    await expect(page.getByRole("button", { name: "Simulate failure" })).toBeVisible();
    // ...and the app works, rather than failing every request.
    await expect(page.getByRole("region", { name: "All sections" })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
  });

  test("the banner's one-click turn-off restores the app", async ({ page }) => {
    await signUpToWorkspace(page, "failures-off");

    await page.getByRole("button", { name: "Simulate failure" }).click();
    await expect(page.getByText("Couldn’t load your workspace")).toBeVisible({ timeout: NAV_TIMEOUT });

    await page.getByTestId("simulated-failures-banner").getByRole("button", { name: "Turn off" }).click();

    await expect(page.getByTestId("simulated-failures-banner")).toBeHidden();
    await expect(page.getByText("Couldn’t load your workspace")).toBeHidden({ timeout: NAV_TIMEOUT });
    await expect(page.getByRole("region", { name: "All sections" })).toBeVisible();
  });
});

test.describe("defect 3 — shared chrome, placeholder routes and form labels", () => {
  test("/design-system renders its own page instead of crashing on a missing provider", async ({
    page,
  }) => {
    const problems = collectConsoleProblems(page);
    await gotoReady(page, "/design-system", { mocks: false });

    await expect(page.getByRole("heading", { name: "Design system" })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    expect(problems, "the design-system route must render without errors").toEqual([]);
  });

  test("/privacy renders its placeholder and live consent without instant-navigation errors", async ({
    page,
  }) => {
    const problems = collectConsoleProblems(page);
    await signUpToWorkspace(page, "privacy");
    await gotoReady(page, "/privacy");

    await expect(page.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });
    await expect(page.getByRole("heading", { name: "AI processing consent" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your workspace" })).toBeVisible();
    expect(problems.filter((line) => /instant navigation/i.test(line))).toEqual([]);
  });

  test("form controls and the chrome expose names that include their visible text", async ({
    page,
  }) => {
    await signUpToWorkspace(page, "names");

    for (const route of ["/workspace", "/workspace/import", "/targets"] as const) {
      await gotoReady(page, route);
      // The two axe rules this branch fixed: an unlabelled control, and an
      // accessible name that does not contain the control's visible text.
      const axe = await new AxeBuilder({ page })
        .withRules(["label", "label-content-name-mismatch"])
        .exclude("nextjs-portal")
        .analyze();
      expect(
        axe.violations,
        `${route}: ${axe.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))).join(" | ")}`,
      ).toEqual([]);
    }

    await gotoReady(page, "/workspace/import");
    await expect(page.getByTestId("upload-input")).toHaveAttribute(
      "aria-label",
      /document to import/i,
    );
  });
});

test.describe("defect 4 — 360px overflow and control names", () => {
  test("the auth pages fit a 360px viewport and name their provider buttons by content", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });

    for (const route of ["/signin", "/signup", "/forgot-password"] as const) {
      await gotoReady(page, route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: NAV_TIMEOUT });

      // Decorative glows must not push the page sideways.
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(
        scrollWidth,
        `${route} scrolls sideways at 360px (scrollWidth ${scrollWidth} > ${innerWidth})`,
      ).toBeLessThanOrEqual(innerWidth + 1);

      // A control's accessible name must contain its visible text.
      const axe = await new AxeBuilder({ page })
        .withRules(["label-content-name-mismatch"])
        .exclude("nextjs-portal")
        .analyze();
      expect(
        axe.violations,
        `${route}: ${axe.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))).join(" | ")}`,
      ).toEqual([]);
    }

    await gotoReady(page, "/signin");
    await expect(page.getByRole("button", { name: /Continue with Google/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with GitHub/ })).toBeVisible();
  });

  test("onboarding fits a 360px viewport once signed in", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signUpToWorkspace(page, "narrow-onboarding");
    await gotoReady(page, "/onboarding");
    await expect(page.getByRole("heading", { name: "How do you want to start?" })).toBeVisible({
      timeout: NAV_TIMEOUT,
    });

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      scrollWidth,
      `/onboarding scrolls sideways at 360px (scrollWidth ${scrollWidth} > ${innerWidth})`,
    ).toBeLessThanOrEqual(innerWidth + 1);
  });
});

test.describe("route sweep", () => {
  // 29 routes x 3 widths, each with a full axe pass (the design-system page
  // alone is enormous), against a dev server that compiles routes on demand.
  // That is genuinely long, so it gets its own budget instead of aborting
  // mid-sweep on a loaded machine.
  test.describe.configure({ timeout: 900_000 });

  for (const vp of VIEWPORTS) {
    test(`every built route at ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const problems = collectConsoleProblems(page);

      await signUpToWorkspace(page, `sweep-${vp.width}`);
      await seedWorkspace(page);
      const targetId = await seedTarget(page);

      const routes = [
        "/",
        "/signin",
        "/signup",
        "/forgot-password",
        "/onboarding",
        "/workspace",
        ...SECTIONS.map((section) => `/workspace/${section}`),
        "/workspace/import",
        "/targets",
        "/targets/new",
        `/targets/${targetId}`,
        "/resume",
        "/history",
        "/privacy",
        "/settings",
        "/design-system",
      ];

      const findings: string[] = [];

      for (const route of routes) {
        const before = problems.length;
        await gotoReady(page, route, { mocks: !["/", "/design-system"].includes(route) });

        // The shell (or the marketing page) must be on screen before we judge
        // it. `:visible` skips chrome that is hidden at this viewport (the
        // desktop sidebar is `hidden` below `md`).
        await expect(
          page.locator("[data-app-chrome]:visible, main:visible, h1:visible").first(),
          `${route}: nothing rendered`,
        ).toBeVisible({ timeout: NAV_TIMEOUT });
        await page.waitForTimeout(700);

        // Horizontal scroll (PRD §7.7: 360px → ultrawide, no sideways scroll).
        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          const widest = [...document.querySelectorAll("body *")]
            .map((el) => el.getBoundingClientRect().right)
            .reduce((max, right) => Math.max(max, right), 0);
          return {
            scrollWidth: de.scrollWidth,
            innerWidth: window.innerWidth,
            widest: Math.round(widest),
            offenders: [...document.querySelectorAll("body *")]
              .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
              .slice(0, 5)
              .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
          };
        });
        if (overflow.scrollWidth > overflow.innerWidth + 1) {
          findings.push(
            `${route}: horizontal scroll (scrollWidth ${overflow.scrollWidth} > ${overflow.innerWidth}); widest ${overflow.widest}; offenders: ${overflow.offenders.join(" | ")}`,
          );
        }

        // Dead links: an anchor the browser will not navigate.
        const deadLinks = await page.evaluate(() =>
          [...document.querySelectorAll("a")]
            .filter((a) => {
              const href = a.getAttribute("href");
              return !href || href === "#" || href.trim() === "";
            })
            .slice(0, 5)
            .map((a) => `${(a.textContent ?? "").trim().slice(0, 40) || "(no text)"} → href=${a.getAttribute("href")}`),
        );
        if (deadLinks.length) findings.push(`${route}: dead links: ${deadLinks.join(" | ")}`);

        // Keyboard: pressing Tab from a fresh load must reach a *visible*,
        // in-app element. Focus inside the Next.js dev-tools overlay
        // (`nextjs-portal`, absent in production) is ignored, not counted.
        // A route that is mid-redirect (/signin or /signup while signed in) can
        // have its document replaced between key presses, which briefly leaves
        // nothing focusable — a race, not a defect — so settle and try again
        // before reporting.
        let lastFocus = await readFocus(page);
        let reachedVisibleFocus = false;
        for (let round = 0; round < 3 && !reachedVisibleFocus; round++) {
          if (round > 0) await page.waitForTimeout(400);
          for (let attempt = 0; attempt < 6 && !reachedVisibleFocus; attempt++) {
            await page.keyboard.press("Tab");
            lastFocus = await readFocus(page);
            reachedVisibleFocus =
              lastFocus.focused && lastFocus.visible && !lastFocus.devOverlay;
          }
        }
        if (!reachedVisibleFocus) {
          findings.push(
            `${route}: keyboard focus did not land on a visible element (${lastFocus.tag})`,
          );
        }

        // axe: WCAG 2.x A/AA. A streamed client navigation can briefly leave the
        // document without a <title>, so wait (bounded) for one before judging:
        // a page mid-transition is not a defect, a page that never gets a title
        // still is.
        await page
          .waitForFunction(() => document.title.trim().length > 0, null, { timeout: 5_000 })
          .catch(() => {});
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .exclude("nextjs-portal")
          .analyze();
        for (const violation of axe.violations) {
          findings.push(
            `${route}: axe [${violation.impact}] ${violation.id} — ${violation.help} (${violation.nodes.length} node${violation.nodes.length === 1 ? "" : "s"}; e.g. ${violation.nodes[0]?.target?.join(" ")})`,
          );
        }

        const routeProblems = problems.slice(before);
        if (routeProblems.length) findings.push(`${route}: ${routeProblems.join(" | ")}`);
      }

      expect(findings, `UI QA sweep at ${vp.label}:\n${findings.join("\n")}`).toEqual([]);
    });
  }
});
