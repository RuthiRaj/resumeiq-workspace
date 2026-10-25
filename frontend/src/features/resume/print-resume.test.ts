import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printResumeDocument } from "./print-resume";

/**
 * The print path is the single export path. Chrome/Edge name "Save as PDF"
 * from `document.title`, so it must be `<Name> - Resume` during printing and
 * restored afterwards (the app's own title comes back).
 */
describe("printResumeDocument", () => {
  const originalTitle = "ResumeIQ workspace";

  beforeEach(() => {
    vi.useFakeTimers();
    document.title = originalTitle;
  });

  afterEach(() => {
    // Drain the fallback restore timer so nothing leaks into the next test.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.title = originalTitle;
  });

  it("uses '<Name> - Resume' as the printed document title", () => {
    let seenDuringPrint = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      seenDuringPrint = document.title;
    });

    printResumeDocument("Ada Fern");

    expect(seenDuringPrint).toBe("Ada Fern - Resume");
  });

  it("restores the previous title after printing", () => {
    vi.spyOn(window, "print").mockImplementation(() => {});

    printResumeDocument("Ada Fern");
    expect(document.title).toBe("Ada Fern - Resume");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe(originalTitle);
  });

  it("falls back to 'Resume' when there is no name", () => {
    let seenDuringPrint = "";
    vi.spyOn(window, "print").mockImplementation(() => {
      seenDuringPrint = document.title;
    });

    printResumeDocument("");

    expect(seenDuringPrint).toBe("Resume");
  });
});
