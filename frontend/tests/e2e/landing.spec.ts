import { test, expect } from "@playwright/test";

/** F1: cinematic landing — content, CTAs, FAQ, responsive overflow. */
test("landing shows the h1 and working CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your truth, in every resume.", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start your workspace" }).first()).toHaveAttribute(
    "href",
    "/signup",
  );
  await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/signup",
  );
});

test("landing narrative, trust and free-forever copy render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /From scattered history/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We never invent your experience." }),
  ).toBeVisible();
  await expect(page.getByText("Free, forever.", { exact: true })).toBeVisible();
});

test("FAQ expands and collapses with keyboard", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "What does the match score mean?" });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("A transparent weighted score")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

for (const width of [360, 768, 1280, 1920]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
