import { test, expect } from "@playwright/test";

/** F0 smoke: landing, design system render; F2: app routes require auth. */
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

test("workspace route requires sign in", async ({ page }) => {
  await page.goto("/workspace");
  // The dev mock API must boot before the guard can resolve the session, so
  // the redirect lands later than the default 5s assertion timeout.
  await expect(page).toHaveURL(/\/signin\?next=/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
