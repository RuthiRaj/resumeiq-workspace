import { expect, test, type Page } from "@playwright/test";

import { liveE2eCredentials, liveE2eEnabled } from "./backend-env";

/**
 * Live auth flows (opt-in, I1 live mode).
 *
 * Complements `live.spec.ts` (which proves sign-in + workspace load) with the
 * checks that matter for the credential-form hardening:
 *
 *  - the form is usable shortly after load (not stuck on "Preparing…"),
 *  - a failed sign-in shows an error without putting anything in the URL,
 *  - sign-up, password reset and sign-out work against real Supabase,
 *  - none of those flows record the email/password in the address bar, the
 *    document or any request URL.
 *
 * Runs only with `RUN_LIVE_E2E=1` and user A credentials in
 * `backend/.env.test` (exported `LIVE_E2E_*` values still override them).
 * Values are never printed: assertions only report key names or a boolean.
 * Sign-up creates one throwaway account on the test project per run; the
 * password-reset check uses a non-deliverable `example.com` address so no real
 * inbox receives mail.
 */
const { email, password } = liveE2eCredentials();

/** Credential-looking query keys, mirroring `src/lib/auth/credential-query.ts`. */
const CREDENTIAL_KEY =
  /pass(word|wd|phrase)?|pwd|secret|token|credential|api[-_]?key|jwt|otp|session|(^|[_-])code($|[_-])|(^|[_-])e-?mail($|[_-])/i;

/**
 * Report *names* of unsafe findings only. Values are never included, so a
 * failure message cannot leak a secret into CI output.
 */
function inspectUrl(raw: string, secrets: string[]): string[] {
  const findings: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return ["unparseable-url"];
  }
  for (const key of parsed.searchParams.keys()) {
    if (CREDENTIAL_KEY.test(key)) findings.push(`query-key:${key}`);
  }
  if (parsed.hash.length > 1) {
    for (const key of new URLSearchParams(parsed.hash.slice(1)).keys()) {
      if (CREDENTIAL_KEY.test(key)) findings.push(`fragment-key:${key}`);
    }
  }
  if (secrets.some((secret) => raw.includes(secret) || raw.includes(encodeURIComponent(secret)))) {
    findings.push("value-in-url");
  }
  return findings;
}

function watchRequests(page: Page, secrets: string[]): string[] {
  const findings: string[] = [];
  page.on("request", (request) => {
    const unsafe = inspectUrl(request.url(), secrets);
    if (unsafe.length > 0) {
      // Path only: the query string is exactly what must not be echoed.
      findings.push(`${unsafe.join(",")} at ${new URL(request.url()).pathname}`);
    }
  });
  return findings;
}

async function expectCleanAddressBar(page: Page, secrets: string[] = []) {
  expect(inspectUrl(page.url(), secrets)).toEqual([]);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
}

/** Sign-out legitimately returns `/signin?next=%2Fworkspace`; still no credentials. */
async function expectNoCredentialQuery(page: Page, secrets: string[] = []) {
  expect(inspectUrl(page.url(), secrets)).toEqual([]);
  const keys = [...new URL(page.url()).searchParams.keys()];
  expect(keys.filter((key) => !["next", "reason", "notice"].includes(key))).toEqual([]);
}

async function signInAsUserA(page: Page): Promise<void> {
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

test.describe("live auth flows", () => {
  test.skip(
    !liveE2eEnabled() || !email || !password,
    "Set RUN_LIVE_E2E=1 and user A credentials in backend/.env.test.",
  );

  test("sign-in form is enabled shortly after load and posts natively", async ({
    page,
  }) => {
    const started = Date.now();
    await page.goto("/signin");

    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    const enabledAfterMs = Date.now() - started;

    expect(enabledAfterMs).toBeLessThanOrEqual(10_000);
    await expect(page.getByText(/Preparing a secure form/)).toHaveCount(0);

    const form = page.locator("form").filter({ has: submit });
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "#");
    await expect(form).toHaveAttribute("novalidate", "");

    console.log(`[live-auth] sign-in submit enabled ${enabledAfterMs} ms after navigation`);
  });

  test("failed sign-in shows an error without credentials in the URL", async ({
    page,
  }) => {
    // Synthetic wrong password for user A's real account.
    const wrongPassword = `Not-${Date.now()}-The-Password!`;
    const requestFindings = watchRequests(page, [wrongPassword]);

    await page.goto("/signin");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password", { exact: true }).fill(wrongPassword);

    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    await expect(
      page.getByRole("alert").filter({ hasText: /don't match|didn't match|check them/i }),
    ).toBeVisible({ timeout: 45_000 });

    await expectCleanAddressBar(page, [wrongPassword]);
    expect(requestFindings).toEqual([]);

    const html = await page.content();
    expect(html.includes(wrongPassword)).toBe(false);
    expect(html.includes(encodeURIComponent(wrongPassword))).toBe(false);
  });

  test("sign-up succeeds against Supabase (session or confirmation email)", async ({
    page,
  }) => {
    const stamp = Date.now();
    const newEmail = `live-signup-${stamp}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const newPassword = `Live-Signup-${stamp}!`;
    const requestFindings = watchRequests(page, [newEmail, newPassword]);

    await page.goto("/signup");
    await page.getByLabel("Full name").fill("Live Signup Check");
    await page.getByLabel("Email").fill(newEmail);
    await page.getByLabel("Password", { exact: true }).fill(newPassword);

    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    // Auto-confirm projects land on onboarding; confirm-email projects show the
    // typed error instead. Both prove the request reached real Supabase.
    await expect(async () => {
      const onOnboarding = new URL(page.url()).pathname === "/onboarding";
      const needsConfirmation = await page
        .getByRole("alert")
        .filter({ hasText: /check your email to confirm/i })
        .isVisible();
      if (!onOnboarding && !needsConfirmation) throw new Error("sign-up still pending");
    }).toPass({ timeout: 60_000 });

    const outcome =
      new URL(page.url()).pathname === "/onboarding" ? "session" : "confirmation-email";
    console.log(`[live-auth] sign-up outcome: ${outcome}`);

    await expectCleanAddressBar(page, [newEmail, newPassword]);
    expect(requestFindings).toEqual([]);

    const html = await page.content();
    expect(html.includes(newEmail)).toBe(false);
    expect(html.includes(newPassword)).toBe(false);
  });

  test("forgot-password sends a real Supabase reset request", async ({ page }) => {
    // Non-deliverable domain: exercises Supabase without emailing a person.
    const resetEmail = `live-reset-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    const requestFindings = watchRequests(page, [resetEmail]);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(resetEmail);

    const submit = page.getByRole("button", { name: "Send reset link" });
    await expect(submit).toBeEnabled({ timeout: 10_000 });
    await submit.click();

    // The inline confirmation and the toast carry the same copy; either one
    // proves the real Supabase request resolved without an error.
    await expect(page.getByText(/reset link is on its way/i).first()).toBeVisible({
      timeout: 45_000,
    });

    await expectCleanAddressBar(page, [resetEmail]);
    expect(requestFindings).toEqual([]);

    const html = await page.content();
    expect(html.includes(resetEmail)).toBe(false);
  });

  test("sign-out returns to a clean sign-in page", async ({ page }) => {
    await signInAsUserA(page);

    await page.getByRole("button", { name: /account menu for/i }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();

    // Radix names the dialog from its `DialogTitle` ("Sign out?"), which takes
    // precedence over `DialogContent`'s aria-label.
    const dialog = page.getByRole("dialog", { name: "Sign out?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Sign out$/ }).click();

    // The protected-route guard can win the race with the explicit replace and
    // add `next=/workspace`; that is safe and useful for signing back in.
    await expect(page).toHaveURL(/\/signin(?:\?|$)/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 60_000,
    });
    await expectNoCredentialQuery(page);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled({
      timeout: 10_000,
    });
  });
});
