/**
 * Hero-mode decision logic (F1). Pure and unit-tested: given capability
 * signals, decide between the lazy R3F scene ("3d") and the static CSS
 * poster ("poster"). The poster is always safe, so every unknown or weak
 * signal falls back to it.
 */
export type HeroMode = "3d" | "poster";

export interface HeroSignals {
  /** OS/browser prefers-reduced-motion. */
  reducedMotion: boolean;
  /** CSS viewport width in px. */
  viewportWidth: number;
  /** Data-Saver / save-data hint. */
  saveData: boolean;
  /** Low-power device heuristic (little RAM or few cores). */
  lowPower: boolean;
  /** WebGL context could be created. */
  webGL: boolean;
}

/** Minimum viewport width for the 3D hero (lighter poster on mobile). */
export const HERO_3D_MIN_WIDTH = 768;

export function decideHeroMode(signals: HeroSignals): HeroMode {
  if (signals.reducedMotion) return "poster";
  if (!signals.webGL) return "poster";
  if (signals.saveData) return "poster";
  if (signals.lowPower) return "poster";
  if (signals.viewportWidth < HERO_3D_MIN_WIDTH) return "poster";
  return "3d";
}
