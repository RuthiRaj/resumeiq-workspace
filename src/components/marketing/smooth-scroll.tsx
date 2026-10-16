"use client";

import { useEffect } from "react";
import type Lenis from "lenis";

let lenis: Lenis | null = null;

export function getLenis(): Lenis | null {
  return lenis;
}

/** Smooth-scroll to a section by id (Lenis when active, native otherwise). */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) {
    lenis.scrollTo(el, { offset: -64 });
  } else {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/**
 * Lenis smooth scroll, mounted by the marketing layout only. The library is
 * dynamically imported after first paint (idle or first wheel/touch), so it
 * never competes with content rendering — the page scrolls natively until it
 * activates. Skipped entirely when the user prefers reduced motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let started = false;
    let raf = 0;

    const start = (): void => {
      if (cancelled || started) return;
      started = true;
      import("lenis")
        .then(({ default: Lenis }) => {
          if (cancelled) return;
          lenis = new Lenis({ duration: 1.15, smoothWheel: true });
          const loop = (time: number): void => {
            lenis?.raf(time);
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
        })
        .catch(() => {
          // Smooth scroll is an enhancement; native scrolling remains.
        });
    };

    const idle = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    if (idle.requestIdleCallback) {
      idleId = idle.requestIdleCallback(start, { timeout: 2500 });
    } else {
      window.setTimeout(start, 800);
    }
    // First interaction starts it immediately (user is engaged).
    const onFirstInteract = (): void => start();
    window.addEventListener("wheel", onFirstInteract, { passive: true, once: true });
    window.addEventListener("touchstart", onFirstInteract, { passive: true, once: true });

    return () => {
      cancelled = true;
      if (idleId !== null) idle.cancelIdleCallback?.(idleId);
      window.removeEventListener("wheel", onFirstInteract);
      window.removeEventListener("touchstart", onFirstInteract);
      cancelAnimationFrame(raf);
      lenis?.destroy();
      lenis = null;
    };
  }, []);

  return null;
}
