import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlaceholderPage } from "./placeholder-page";

/**
 * S-12: `<Link><Button>` produced a button inside an anchor: invalid HTML and
 * two focus stops for one destination. The action must be a real link styled
 * as a button.
 */
afterEach(() => {
  cleanup();
});

describe("placeholder page action", () => {
  it("renders one focusable link, not a button inside a link", () => {
    render(
      <PlaceholderPage
        title="Standard resume"
        milestone="Coming in F5"
        description="A description."
        capabilities={["One capability"]}
      />,
    );

    const action = screen.getByRole("link", { name: "Back to your workspace" });
    expect(action.tagName).toBe("A");
    expect(action.querySelector("button")).toBeNull();
  });
});
