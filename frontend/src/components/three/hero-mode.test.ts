import { describe, expect, it } from "vitest";
import { decideHeroMode, type HeroSignals } from "./hero-mode";

const healthy: HeroSignals = {
  reducedMotion: false,
  viewportWidth: 1280,
  saveData: false,
  lowPower: false,
  webGL: true,
};

describe("decideHeroMode", () => {
  it("uses 3D on a capable desktop", () => {
    expect(decideHeroMode(healthy)).toBe("3d");
  });

  it("falls back to the poster when reduced motion is preferred", () => {
    expect(decideHeroMode({ ...healthy, reducedMotion: true })).toBe("poster");
  });

  it("falls back to the poster without WebGL", () => {
    expect(decideHeroMode({ ...healthy, webGL: false })).toBe("poster");
  });

  it("falls back to the poster on save-data", () => {
    expect(decideHeroMode({ ...healthy, saveData: true })).toBe("poster");
  });

  it("falls back to the poster on low-power devices", () => {
    expect(decideHeroMode({ ...healthy, lowPower: true })).toBe("poster");
  });

  it("falls back to the poster below 768px viewports", () => {
    expect(decideHeroMode({ ...healthy, viewportWidth: 767 })).toBe("poster");
    expect(decideHeroMode({ ...healthy, viewportWidth: 360 })).toBe("poster");
    expect(decideHeroMode({ ...healthy, viewportWidth: 768 })).toBe("3d");
  });
});
