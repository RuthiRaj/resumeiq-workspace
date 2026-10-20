import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractionProgress } from "./import-review";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("import extraction note", () => {
  it("says the server reads the file in live mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "live");
    const { unmount } = render(<ExtractionProgress fileName="cv.pdf" />);

    expect(screen.getByText(/sent to the server for extraction/i)).toBeInTheDocument();
    expect(screen.queryByText(/no file leaves your browser/i)).not.toBeInTheDocument();
    unmount();
  });

  it("keeps the simulated note in mock mode", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    const { unmount } = render(<ExtractionProgress fileName="cv.pdf" />);

    expect(screen.getByText(/simulated extractor/i)).toBeInTheDocument();
    unmount();
  });
});
