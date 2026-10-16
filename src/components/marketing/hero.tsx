"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HeroPoster } from "@/components/three/hero-poster";
import { useHeroMode } from "@/components/three/use-hero-mode";
import { scrollToSection } from "@/components/marketing/smooth-scroll";

/**
 * R3F scene, code-split and client-only. The `three` chunk only loads when
 * the hero actually renders 3D (capable desktop); everyone else gets the
 * static poster with zero 3D JS.
 */
const HeroScene = dynamic(() => import("@/components/three/hero-scene"), {
  ssr: false,
  loading: () => <HeroPoster />,
});

export function Hero() {
  const mode = useHeroMode();

  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden">
      {mode === "3d" ? <HeroScene /> : <HeroPoster />}

      <div className="relative mx-auto flex min-h-[92svh] w-full max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        {/* No entrance animation on the hero copy: the h1 is the LCP element
            and must paint with first paint (PRD §7.7 LCP budget). */}
        <div className="flex max-w-3xl flex-col items-center gap-6">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-cyan">
            ResumeIQ Workspace
          </p>
          <h1
            id="hero-heading"
            className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          >
            Your truth, in every resume.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Every claim on your resume traces back to evidence you own — your
            work, your projects, your proof. Nothing invented, ever.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Start your workspace</Button>
            </Link>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => scrollToSection("how-it-works")}
            >
              See how it works
            </Button>
          </div>
          <p className="font-mono text-xs text-muted">
            Free, forever · No paywalls · No invented experience
          </p>
        </div>
      </div>
    </section>
  );
}
