import { expect, test, type Page } from "@playwright/test";

/**
 * S-11: the fixed mobile bottom navigation covered controls that happened to
 * sit at the bottom of the first screen — the only action on /resume and the
 * job-description field on /targets/new at 360px. The navigator is now a
 * layout row below the scrolling area, so no control is ever drawn under it.
 *
 * The overlap check is clipping-aware: a control that is scrolled out of the
 * app's scroll area does not count as covered.
 */

const NAV_TIMEOUT = 30_000;

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
  await gotoReady(page, "/signup");
  await page.getByLabel("Full name").fill("Mobile Layout User");
  await page.getByLabel("Email").fill(`mobile-nav-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("secret123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: NAV_TIMEOUT });

  await page.getByRole("tab", { name: "Start manually" }).click();
  await page.getByRole("button", { name: "Start manually" }).last().click();
  await page.getByRole("checkbox", { name: /I understand and consent/ }).check();
  await page.getByRole("button", { name: "Consent and continue" }).click();
  await expect(page).toHaveURL(/\/workspace$/, { timeout: NAV_TIMEOUT });
}

/** Descriptions of interactive controls whose visible box overlaps the nav. */
async function controlsUnderMobileNav(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
    if (!nav) return ["the mobile navigation is missing"];

    const navRect = nav.getBoundingClientRect();
    const selector =
      'a[href], button, textarea, input:not([type="hidden"]), select, [role="button"], [role="link"]';

    const visibleBox = (el: Element) => {
      const rect = el.getBoundingClientRect();
      let { top, bottom, left, right } = rect;
      let node = el.parentElement;
      while (node) {
        const style = window.getComputedStyle(node);
        if (/(auto|scroll|hidden)/.test(style.overflowY)) {
          const clip = node.getBoundingClientRect();
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        node = node.parentElement;
      }
      return { top, bottom, left, right, width: rect.width, height: rect.height };
    };

    const covered: string[] = [];
    for (const el of document.querySelectorAll(selector)) {
      if (nav.contains(el)) continue;
      const box = visibleBox(el);
      if (box.width <= 1 || box.height <= 1) continue;
      if (box.bottom <= box.top || box.right <= box.left) continue;
      const overlapWidth =
        Math.min(box.right, navRect.right) - Math.max(box.left, navRect.left);
      const overlapHeight =
        Math.min(box.bottom, navRect.bottom) - Math.max(box.top, navRect.top);
      if (overlapWidth > 2 && overlapHeight > 2) {
        const label = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        covered.push(`${el.tagName.toLowerCase()} "${label}"`);
      }
    }
    return covered;
  });
}

test.describe("mobile bottom navigation", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("never covers a control at 360px", async ({ page }) => {
    test.setTimeout(120_000);
    await signUpToWorkspace(page);

    for (const route of ["/resume", "/targets/new"]) {
      await page.goto(route);
      await expect(
        page.locator('nav[aria-label="Mobile navigation"]'),
        `${route} renders the mobile navigation`,
      ).toBeVisible();
      await page.waitForTimeout(500);

      expect(
        await controlsUnderMobileNav(page),
        `${route}: controls under the navigation at the initial scroll position`,
      ).toEqual([]);

      const navTop = await page
        .locator('nav[aria-label="Mobile navigation"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top));

      // Scroll the app content to its end: the navigator must stay put and
      // must not slide content underneath itself.
      await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Mobile navigation"]');
        const scroller = nav?.previousElementSibling;
        if (scroller instanceof HTMLElement) scroller.scrollTo(0, scroller.scrollHeight);
      });
      await page.waitForTimeout(300);

      const navTopAfter = await page
        .locator('nav[aria-label="Mobile navigation"]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top));
      expect(navTopAfter, `${route}: the navigation moved while scrolling`).toBe(navTop);

      expect(
        await controlsUnderMobileNav(page),
        `${route}: controls under the navigation after scrolling to the end`,
      ).toEqual([]);
    }
  });
});
