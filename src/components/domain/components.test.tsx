import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from "@/components/domain/score-ring";
import { EvidenceBadge } from "@/components/domain/evidence-badge";

describe("domain components", () => {
  it("ScoreRing exposes an accessible score label", () => {
    render(<ScoreRing value={87} label="Match" />);
    expect(screen.getByRole("img", { name: "Match: 87 out of 100" })).toBeInTheDocument();
  });

  it("EvidenceBadge announces every evidence state", () => {
    const { rerender } = render(<EvidenceBadge state="verified" />);
    expect(screen.getByLabelText("Evidence: Verified")).toBeInTheDocument();
    rerender(<EvidenceBadge state="missing" />);
    expect(screen.getByLabelText("Evidence: Missing")).toBeInTheDocument();
  });
});
