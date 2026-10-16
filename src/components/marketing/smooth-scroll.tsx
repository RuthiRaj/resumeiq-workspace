"use client";

import { useEffect } from "react";
import Lenis from "lenis";

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
 * Lenis smooth scroll, mounted by the marketing layout only. Skipped when
 * the user prefers reduced motion (native scrolling takes over).
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    let raf = 0;
    const loop = (time: number): void => {
      lenis?.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis?.destroy();
      lenis = null;
    };
  }, []);

  return null;
}
