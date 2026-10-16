"use client";

import { useEffect, useState } from "react";
import { decideHeroMode, type HeroMode } from "./hero-mode";

interface NavigatorExtras {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: { saveData?: boolean };
}

function hasHardwareWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    // Software rasterizers (SwiftShader, llvmpipe, Basic Render) run the
    // scene at single-digit fps — the poster is the better experience there,
    // same as any other low-power path.
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) {
      const renderer = String(
        gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "",
      ).toLowerCase();
      if (
        renderer.includes("swiftshader") ||
        renderer.includes("llvmpipe") ||
        renderer.includes("software") ||
        renderer.includes("basic render")
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads browser capability signals after mount and resolves the hero mode.
 * SSR and first paint always render the poster (safe default, no hydration
 * mismatch). The 3D upgrade is engagement-gated progressive enhancement: it
 * fires on first interaction (scroll / pointer / keys) or, for passive
 * viewers, after the load has settled — so the 240KB 3D chunk never competes
 * with first paint, fonts, or interaction readiness.
 */
const PASSIVE_UPGRADE_DELAY_MS = 6000;

export function useHeroMode(): HeroMode {
  const [mode, setMode] = useState<HeroMode>("poster");

  useEffect(() => {
    const nav = navigator as Navigator & NavigatorExtras;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = nav.connection?.saveData === true;
    const lowPower =
      (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) ||
      (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4);

    const eligible =
      decideHeroMode({
        reducedMotion,
        viewportWidth: window.innerWidth,
        saveData,
        lowPower,
        webGL: hasHardwareWebGL(),
      }) === "3d";
    if (!eligible) return;

    let done = false;
    let idleId: number | null = null;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const upgrade = (): void => {
      if (done) return;
      done = true;
      // Let the interaction settle before downloading the 3D chunk.
      const fire = (): void => setMode("3d");
      if (win.requestIdleCallback) {
        idleId = win.requestIdleCallback(fire, { timeout: 2000 });
      } else {
        window.setTimeout(fire, 500);
      }
      cleanup();
    };

    const onActivity = (): void => upgrade();
    const timer = window.setTimeout(upgrade, PASSIVE_UPGRADE_DELAY_MS);
    window.addEventListener("scroll", onActivity, { passive: true, once: true });
    window.addEventListener("pointerdown", onActivity, { passive: true, once: true });
    window.addEventListener("keydown", onActivity, { once: true });

    function cleanup(): void {
      window.clearTimeout(timer);
      if (idleId !== null) win.cancelIdleCallback?.(idleId);
      window.removeEventListener("scroll", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    }

    return cleanup;
  }, []);

  return mode;
}
