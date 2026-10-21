import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialQueryGuard } from "./credential-query-guard";
import { CREDENTIAL_IN_URL_NOTICE } from "@/lib/auth/credential-query";

beforeEach(() => {
  window.history.replaceState({}, "", "/signin");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/signin");
});

describe("CredentialQueryGuard", () => {
  it("removes credential-like parameters and warns before the form is usable", async () => {
    window.history.replaceState(
      {},
      "",
      "/signin?email=a%40example.com&password=hunter2&token=abc123&next=%2Fworkspace",
    );

    render(<CredentialQueryGuard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(CREDENTIAL_IN_URL_NOTICE);
    await waitFor(() => expect(window.location.search).toBe("?next=%2Fworkspace"));
    expect(window.location.pathname).toBe("/signin");
    expect(document.body.innerHTML).not.toContain("hunter2");
    expect(document.body.innerHTML).not.toContain("abc123");
  });

  it("shows the warning after the server-side scrub marker and drops the marker", async () => {
    window.history.replaceState({}, "", "/signin?notice=credentials");

    render(<CredentialQueryGuard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(CREDENTIAL_IN_URL_NOTICE);
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("keeps the production URL untouched on a clean auth page", async () => {
    window.history.replaceState({}, "", "/signin?next=%2Fworkspace");

    render(<CredentialQueryGuard />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("?next=%2Fworkspace");
  });
});
