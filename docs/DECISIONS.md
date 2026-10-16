# DECISIONS.md — Architecture Decision Records

Project: AI Resume Analyzer Workspace. The PRD (`docs/PRD.md`) is the source of truth.
Record non-obvious decisions here as short ADRs (date, context, decision, consequence).

## ADR-001 — 2026-10-16 — Frontend-first with contract-first mocks
Context: Backend (FastAPI + Supabase) comes after frontend milestones F0–F7.
Decision: Define Zod schemas first in `src/lib/schemas/`; all API access goes through
`src/lib/api/`; MSW implements the same endpoints the FastAPI backend will expose later.
Consequence: No UI rewrite at backend integration (B7); mock behaviours (sync, staleness,
slow AI, failures) are simulated in MSW handlers.

## ADR-002 — 2026-10-16 — F0 toolchain fixes
Context: `npm install` of the F0 stack hit three issues.
Decision:
1. `@types/node` 20 → 22: vitest 5 requires `@types/node ^22 || >=24` as a
   peer; the scaffold pinned v20, causing ERESOLVE. Node runtime here is v24,
   so the bump is safe.
2. MSW v3 `worker.start()` takes no `onUnhandledRequest` option (removed vs v2);
   call it bare in dev.
3. Demo pages must be prerender-safe: no `new Date()` in server components
   (Next 16 errors at build). Use fixed demo timestamps.
Consequence: `npm run dev/build/lint/typecheck/test` all pass on F0.

## ADR-003 — 2026-10-16 — F1 landing: 3D isolation + fallback-first hero
Context: PRD requires a lazy R3F hero that never ships 3D JS to app routes,
with graceful fallbacks and a static-first narrative.
Decision:
1. `three@0.186.1` + `@react-three/fiber@9` + `@react-three/drei@10` + `lenis`
   install cleanly (single deduped three; fiber peer `react >=19 <19.4` OK).
2. Fallback decision is a pure function (`decideHeroMode`, unit-tested):
   poster unless desktop-width + WebGL + no reduced-motion/save-data/low-power.
   SSR/first paint always render the poster (no hydration mismatch); the hero
   upgrades to 3D only after mount signals allow it.
3. `hero-scene.tsx` is imported only via `next/dynamic` (`ssr: false`) from the
   marketing hero. Verified in the production build: the three chunk (899KB
   raw / 238KB gzip) is referenced solely by the marketing route's loader chunk;
   `/` initial JS is 680KB raw / 209KB gzip with zero three bytes.
4. Scene lifecycle: DPR capped at 1.5; `frameloop` toggles off-screen/hidden-tab;
   memoized geometries/materials disposed on unmount; deterministic seeded PRNG
   for particles (also satisfies the `react-hooks/purity` lint rule).
5. Narrative pinning is CSS sticky with a `prefers-reduced-motion` static
   fallback; Lenis mounts in the marketing layout only and skips itself under
   reduced motion. All palette tokens verified ≥ 4.5:1 contrast on the bg.
Consequence: `/` is fully static semantic HTML with progressive 3D
enhancement; app routes carry no 3D cost.

## ADR-004 — 2026-10-16 — F1 perf + a11y findings (needs owner sign-off)
Context: Lighthouse lab (Playwright Chromium 1248, 4x CPU throttle, Windows):
desktop perf 33 → 43 / mobile 62 across 6 runs (variance ±7 from machine
contention: OneDrive sync + Defender on the repo disk). Accessibility and
best-practices are 100/100 on both form factors.
Findings:
1. The 3D chunk (899KB raw / 238KB gzip) no longer loads for lab visitors:
   engagement-gated (interaction or 6s idle) + software-renderer rejection.
   Verified in lab network logs. Real hardware-GPU desktops still get 3D.
2. Remaining perf deficit is React framework hydration (~224KB shared chunk,
   one ~5s lab-time task) under throttling — not page code. LCP element (hero
   h1) paints with first paint; the entrance fade was removed for the LCP
   budget (PRD §7.7). CLS ≈ 0 throughout.
3. White-on-`#7C5CFF` primary buttons measured 4.35:1 (fails AA). Added a
   derived `--riq-action: #5F48D8` token (6.2:1) for filled buttons only; the
   brand `accent-violet` token is unchanged for glows/gradients/scores.
   Ghost buttons moved to full `text-text` (they sit over glow backdrops).
   Both changes are one-line reverts if the owner prefers the exact PRD palette
   with larger/bolder CTA type instead. Also fixed a label-in-name mismatch on
   the logo link (dropped redundant aria-label).
Consequence: F1 meets every acceptance item except desktop perf 90+ in this
lab. Recommend accepting F1 on architecture + a11y, and scheduling real-device
measurement plus below-fold hydration splits for the F7 polish pass.
