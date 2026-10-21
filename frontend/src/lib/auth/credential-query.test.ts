import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_IN_URL_NOTICE,
  isCredentialQueryKey,
  stripCredentialQuery,
} from "./credential-query";

describe("isCredentialQueryKey", () => {
  it.each([
    "password",
    "Password",
    "passwd",
    "pass",
    "passphrase",
    "pwd",
    "token",
    "access_token",
    "refresh-token",
    "id_token",
    "secret",
    "client_secret",
    "api_key",
    "api-key",
    "jwt",
    "otp",
    "code",
    "verification_code",
    "session",
    "email",
    "user_email",
    "e-mail",
    "credential",
  ])("flags %s", (key) => {
    expect(isCredentialQueryKey(key)).toBe(true);
  });

  it.each(["next", "reason", "notice", "tab", "postcode", "country", "status"])(
    "leaves %s alone",
    (key) => {
      expect(isCredentialQueryKey(key)).toBe(false);
    },
  );
});

describe("stripCredentialQuery", () => {
  it("removes password and token parameters but keeps safe navigation state", () => {
    const result = stripCredentialQuery(
      "/signin?email=a%40example.com&password=hunter2&token=abc123&next=%2Fworkspace&reason=expired",
    );

    expect(result.url).toBe("/signin?next=%2Fworkspace&reason=expired");
    expect(result.removed).toEqual(["email", "password", "token"]);
    expect(result.url).not.toContain("hunter2");
    expect(result.url).not.toContain("abc123");
  });

  it("works with absolute URLs and returns an app-relative path", () => {
    const result = stripCredentialQuery(
      "https://app.example.test/signup?Password=secret&access_token=xyz&step=2",
    );

    expect(result.url).toBe("/signup?step=2");
    expect(result.removed).toEqual(["Password", "access_token"]);
  });

  it("strips Supabase-style fragment tokens and keeps the rest of the fragment", () => {
    const result = stripCredentialQuery(
      "/signin#access_token=abc&refresh_token=def&type=recovery",
    );

    expect(result.url).toBe("/signin#type=recovery");
    expect(result.removed).toEqual(["access_token", "refresh_token"]);
  });

  it("clears the fragment when every fragment parameter is credential-like", () => {
    const result = stripCredentialQuery("/signin#access_token=abc");

    expect(result.url).toBe("/signin");
    expect(result.removed).toEqual(["access_token"]);
  });

  it("returns the URL untouched when nothing credential-like is present", () => {
    const result = stripCredentialQuery("/signin?next=%2Fworkspace&reason=expired");

    expect(result.url).toBe("/signin?next=%2Fworkspace&reason=expired");
    expect(result.removed).toEqual([]);
  });

  it("never returns parameter values", () => {
    const result = stripCredentialQuery("/signin?password=hunter2");

    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("exposes the exact warning copy", () => {
    expect(CREDENTIAL_IN_URL_NOTICE).toBe(
      "Never put your password in a link. Change it if you typed it into the address bar.",
    );
  });
});
