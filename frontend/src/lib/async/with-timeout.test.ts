import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, withTimeout } from "./with-timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves normally when the work finishes first", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1_000)).resolves.toBe("ok");
  });

  it("rejects with the user-facing message when the deadline passes", async () => {
    vi.useFakeTimers();
    const hung = new Promise<string>(() => {});
    const result = withTimeout(hung, 500, "Still checking consent. Try again.");

    const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    await expect(result).rejects.toThrow("Still checking consent. Try again.");
  });

  it("passes through the original rejection and clears its timer", async () => {
    vi.useFakeTimers();
    const failure = new Error("network down");
    await expect(withTimeout(Promise.reject(failure), 500)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
