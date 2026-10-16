"use client";

import dynamic from "next/dynamic";
import { HeroPoster } from "@/components/three/hero-poster";
import { useHeroMode } from "@/components/three/use-hero-mode";

/**
 * R3F scene, code-split and client-only. The `three` chunk only loads when
 * the hero actually renders 3D (engaged desktop with hardware WebGL);
 * everyone else gets the static poster with zero 3D JS.
 */
const HeroScene = dynamic(() => import("@/components/three/hero-scene"), {
  ssr: false,
  loading: () => <HeroPoster />,
});

/** Decorative hero backdrop island: poster first, 3D only as enhancement. */
export function HeroBackdrop() {
  const mode = useHeroMode();
  return mode === "3d" ? <HeroScene /> : <HeroPoster />;
}
