import { test, expect } from "@playwright/test";

/** F0 smoke: landing, design system, and app-shell routes render. */
test("landing renders the headline", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your truth, in every resume." }),
  ).toBeVisible();
});

test("design system renders tokens and components", async ({ page }) => {
  await page.goto("/design-system");
  await expect(
    page.getByRole("heading", { name: "Design system" }),
  ).toBeVisible();
  await expect(page.getByText("Color tokens")).toBeVisible();
  await expect(page.getByText("Evidence states")).toBeVisible();
});

test("workspace route renders inside the app shell", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("complementary", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByText("Coming in F3")).toBeVisible();
});
