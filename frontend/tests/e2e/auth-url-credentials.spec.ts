import { test, expect } from "@playwright/test";

test.setTimeout(120_000);

const SECRET = "url-secret-do-not-keep-31415";
const EMAIL = "a@example.com";

/**
 * A native form submit (the failure mode when the page does not hydrate) must
 * never turn email/password into query parameters, and credentials that arrive
 * in a link must be gone before the page renders them.
 */
test("strips credentials from the URL and never renders them", async ({ page }) => {
  const initial = `/signin?email=${encodeURIComponent(EMAIL)}&password=${SECRET}&token=tok-123&next=%2Fworkspace`;
  const consoleLines: string[] = [];
  const requests: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(initial);

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/signin\?next=%2Fworkspace$/);
  expect(page.url()).not.toContain(SECRET);
  expect(page.url()).not.toContain("password=");
  expect(page.url()).not.toContain("token=");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Never put your password in a link" }),
  ).toContainText(
    "Never put your password in a link. Change it if you typed it into the address bar.",
  );

  // The rendered document (including Next's flight payload scripts) must not
  // contain the values, not just the visible text.
  const content = await page.content();
  expect(content).not.toContain(SECRET);
  expect(content).not.toContain("tok-123");
  expect(await page.locator("body").innerText()).not.toContain(SECRET);

  // The only request allowed to carry the secret is the navigation the user
  // made; no follow-up fetch, prefetch or analytics call may repeat it.
  const leaked = requests.filter((url) => url.includes(SECRET));
  expect(leaked).toHaveLength(1);
  expect(leaked[0]).toContain(`password=${SECRET}`);

  expect(consoleLines.join("\n")).not.toContain(SECRET);
  expect(consoleLines.join("\n")).not.toContain("tok-123");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("a submit cannot put credentials in the URL", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    const form = page.locator("form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "#");
    await expect(form).toHaveAttribute("novalidate");

    await page.getByLabel("Email").fill(EMAIL);
    const password = page.getByLabel("Password", { exact: true });
    await password.fill(SECRET);

    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(submit).toBeDisabled();

    // Implicit submission (Enter) and a forced click must both be no-ops.
    await password.press("Enter");
    await submit.click({ force: true });
    await page.waitForTimeout(300);

    expect(page.url()).toBe("http://localhost:3000/signin");
    expect(page.url()).not.toContain("password");
    expect(page.url()).not.toContain(SECRET);
  });
});
