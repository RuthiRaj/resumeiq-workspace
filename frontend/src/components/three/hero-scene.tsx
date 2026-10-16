"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import * as THREE from "three";

/**
 * Lazy R3F hero scene (F1). Floating translucent "document" planes drift in a
 * violet/cyan haze with slow pointer parallax.
 *
 * Performance + lifecycle rules (per milestone spec):
 * - DPR capped at 1.5.
 * - Rendering pauses when the tab is hidden or the hero leaves the viewport
 *   (frameloop toggles between "always" and "never").
 * - Memoized geometries/materials are disposed on unmount (JSX-attached
 *   objects are disposed automatically by R3F).
 * - This module is only ever imported via next/dynamic (ssr: false) from the
 *   marketing hero — never from app routes.
 */

const VIOLET = "#7C5CFF";
const CYAN = "#22D3EE";

interface DocSpec {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  speed: number;
  opacity: number;
}

const DOCS: DocSpec[] = [
  { position: [-3.4, 0.6, -1.5], rotation: [0.05, 0.5, -0.06], scale: 1.15, speed: 1.1, opacity: 0.14 },
  { position: [-1.4, -1.1, -0.5], rotation: [-0.04, 0.25, 0.05], scale: 0.9, speed: 1.4, opacity: 0.1 },
  { position: [0.4, 0.9, -2.2], rotation: [0.02, -0.15, 0.03], scale: 1.3, speed: 0.9, opacity: 0.12 },
  { position: [2.2, -0.4, -1.0], rotation: [-0.05, -0.4, -0.04], scale: 1.0, speed: 1.2, opacity: 0.14 },
  { position: [3.9, 1.0, -2.4], rotation: [0.04, -0.6, 0.07], scale: 0.8, speed: 1.0, opacity: 0.09 },
  { position: [-4.6, -1.3, -2.8], rotation: [0.0, 0.7, 0.0], scale: 0.85, speed: 0.8, opacity: 0.08 },
  { position: [1.1, 1.7, -3.2], rotation: [-0.03, 0.1, -0.02], scale: 0.7, speed: 1.3, opacity: 0.08 },
];

function DocumentPlane({ spec }: { spec: DocSpec }) {
  const lineGeo = useMemo(() => new THREE.BoxGeometry(1, 0.035, 0.01), []);
  const sheetMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#dfe4f5",
        transparent: true,
        opacity: spec.opacity,
        roughness: 0.35,
        metalness: 0.1,
        emissive: "#7C5CFF",
        emissiveIntensity: 0.12,
        side: THREE.DoubleSide,
      }),
    [spec.opacity],
  );
  const lineMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: Math.min(0.5, spec.opacity + 0.25),
      }),
    [spec.opacity],
  );

  useEffect(
    () => () => {
      lineGeo.dispose();
      sheetMat.dispose();
      lineMat.dispose();
    },
    [lineGeo, sheetMat, lineMat],
  );

  const lines = [0.55, 0.28, 0.01, -0.26];

  return (
    <Float speed={spec.speed} rotationIntensity={0.25} floatIntensity={0.9}>
      <group position={spec.position} rotation={spec.rotation} scale={spec.scale}>
        <mesh material={sheetMat}>
          <planeGeometry args={[1.7, 2.3]} />
        </mesh>
        {lines.map((y, i) => (
          <mesh
            key={y}
            geometry={lineGeo}
            material={lineMat}
            position={[-0.12 + (i % 2) * 0.06, y, 0.012]}
            scale={[i === 3 ? 0.7 : 1.15, 1, 1]}
          />
        ))}
      </group>
    </Float>
  );
}

/** Deterministic PRNG so particle layout is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ParticleField({ count = 220 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null!);
  const { geometry, material } = useMemo(() => {
    const rand = mulberry32(42);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rand() - 0.5) * 14;
      positions[i * 3 + 1] = (rand() - 0.5) * 8;
      positions[i * 3 + 2] = -rand() * 5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: "#9db4ff",
      size: 0.035,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return { geometry, material };
  }, [count]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((state, delta) => {
    ref.current.rotation.y += delta * 0.015;
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 0.15) * 0.15;
  });

  return <points ref={ref} geometry={geometry} material={material} />;
}

function ParallaxRig({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null!);
  const target = useMemo(() => new THREE.Vector2(0, 0), []);
  useFrame((state, delta) => {
    target.set(state.pointer.x, state.pointer.y);
    const g = ref.current;
    // Slow eased parallax toward the pointer (deliberate, cinematic).
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, target.x * 0.12, 1.2, delta);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -target.y * 0.08, 1.2, delta);
    g.position.x = THREE.MathUtils.damp(g.position.x, target.x * 0.25, 1.2, delta);
    g.position.y = THREE.MathUtils.damp(g.position.y, target.y * 0.18, 1.2, delta);
  });
  return <group ref={ref}>{children}</group>;
}

export default function HeroScene() {
  const [active, setActive] = useState(true);
  const hostRef = useRef<HTMLDivElement>(null);

  // Pause rendering when the hero is off-screen or the tab is hidden.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const inView = el.getBoundingClientRect().bottom > 0;
      setActive(inView && document.visibilityState === "visible");
    };
    update();
    const observer = new IntersectionObserver(update, { threshold: 0 });
    observer.observe(el);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <div ref={hostRef} className="hero-scene-enter absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 9], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={active ? "always" : "never"}
      >
        <fog attach="fog" args={["#07080C", 7, 15]} />
        <ambientLight intensity={0.7} />
        <pointLight position={[-6, 3, 2]} intensity={60} color={VIOLET} distance={20} />
        <pointLight position={[6, -2, 2]} intensity={45} color={CYAN} distance={20} />
        <ParallaxRig>
          {DOCS.map((spec, i) => (
            <DocumentPlane key={i} spec={spec} />
          ))}
          <ParticleField />
        </ParallaxRig>
      </Canvas>
    </div>
  );
}
