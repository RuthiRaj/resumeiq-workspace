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

## ADR-005 — 2026-10-16 — Landing JS budget: 215KB gzip on "/"
Context: "/" initial JS measured 680.9KB raw / 209.0KB gzip. Attribution of the
initial graph: react-dom + Next runtime (~123KB gzip, untouchable floor),
motion full + lucide + page code (~50KB gzip), react-query + zustand + Toaster
(~17KB gzip via root Providers), lenis (~8KB gzip, eager import).
Decision:
1. Providers split: root layout is now a pure server component; QueryProvider +
   Toaster mount only under (app)/. Marketing ships no react-query, no zustand,
   no dev MSW starter (the narrative export-preview uses local inline feedback).
2. Motion ships via LazyMotion (`m` components + domAnimation) from the
   marketing layout; no AnimatePresence/springs/scroll features in the bundle.
3. Hero copy, trust, footer and FAQ copy are server components; only the hero
   backdrop, scroll button, narrative scenes and FAQ accordion are client
   islands. SSR output (headings, copy, SEO) is byte-identical in shape.
4. Lenis loads via dynamic import after idle/first interaction; anchors fall
   back to native smooth scroll until it activates.
5. Verified absent from "/" initial JS: msw, fixtures, zod, three/R3F,
   react-query, zustand. next/font already optimal (display=swap, latin subset,
   single weights) — no change.
6. Result: 631.7KB raw / 196.6KB gzip. Budget set at 215KB gzip
   (best 196.6 × 1.1 = 216.3, rounded down), enforced by
   `scripts/check-landing-budget.mjs` (`npm run budget`, runs in CI after build).
   150KB is not reachable without removing animations/icons/content (framework
   floor alone is ~123KB gzip); below-fold dynamic splitting was considered and
   rejected for F1 (SSR/hydration timing risk on the sticky narrative for ~12KB
   gzip — revisit in F7 with real-device data).
Consequence: any regression (re-added query/motion-full/eager-lenis/3D in the
initial graph) fails CI until the budget is deliberately raised.

## ADR-006 — 2026-10-16 — Monorepo: `/frontend`, `/backend`, root docs
Context: The repo grew a backend plan (PRD §10) but all code lived at the root.
Decision: `/frontend` holds ALL Next.js code/config (moved with `git mv`, history
preserved); `/backend` is a README placeholder until B0; `docs/`, `.github/`,
`AGENTS.md` stay at root with updated paths (PRD §8.2 tree now shows the
`frontend/` prefix; CI runs every job with `working-directory: frontend` and
`cache-dependency-path: frontend/package-lock.json`). Root layout is provider-free
(see ADR-005), so the move required no app-code changes — only relative-path
configs, which needed none. Root `.gitignore` covers both packages.
Consequence: backend work later starts in `/backend` without touching frontend
history or CI.

## ADR-007 — 2026-10-16 — `frontend/AGENTS.md` is a generated duplicate, never commit it
Context: Running `next dev` from `frontend/` (the normal workflow) made Next.js
write `frontend/AGENTS.md` containing only the managed `nextjs-agent-rules`
block — byte-identical to the block already at the top of the root `AGENTS.md`,
which additionally holds all project rules. Source:
`frontend/node_modules/next/dist/server/lib/generate-agent-files.js`
(`writeAgentFiles` targets the dev server's project dir; see `syncAgentRulesForDev`
in `dist/server/lib/app-info-log.js`).
Decision: Deleted the untracked `frontend/AGENTS.md` (nothing to merge — root
already has the identical block); added `frontend/AGENTS.md` to root
`.gitignore` so a future `next dev` regeneration can never be committed by mistake.
Consequence: `next dev` may still recreate the file on disk as ignored clutter;
the canonical, tracked copy remains the root `AGENTS.md`. This precise path
entry does not affect the tracked root file.

## ADR-008 — 2026-10-16 — F2 auth shell: client guard, MSW fixes, Radix gotchas
Context: F2 needs route protection, mock auth + consent, and Radix primitives
without touching the landing bundle. Three surprises surfaced.
Decision:
1. Client-side `AuthGuard`, no `proxy.ts`. The mock session lives in
   localStorage, which the server proxy cannot read; installed Next 16 docs
   (`frontend/node_modules/next/dist/docs/01-app/.../proxy.md`: middleware
   renamed to `proxy`, "not intended for slow data fetching... should not be
   used as a full session management solution") confirm proxy is for
   optimistic checks only. Supabase cookie sessions (B0) will enable a real
   proxy check later without changing the guard's contract.
2. MSW was scaffolded but never initialized: `public/mockServiceWorker.js`
   was missing (`npx msw init` never ran), so every mock call 404'd. Fix:
   committed the worker script; added `src/mocks/start.ts` which reloads once
   when the page isn't worker-controlled yet (a fresh registration never
   controls its own page — first-visit API calls would otherwise bypass MSW).
   `public/mockServiceWorker.js` is now eslint-ignored (generated file).
3. `AuthProvider` stabilizes the client via `useState` initializer. A
   `createMockAuthClient()` default parameter allocated a new object per
   render, re-firing the session effect into an unthrottled getSession loop
   (hundreds of requests in seconds; DOM churn broke palette clicks in E2E).
4. cmdk always renders `data-disabled="true"|"false"`, so Tailwind's
   presence-matched `data-[disabled]:pointer-events-none` disabled EVERY
   palette option (real user-facing bug, caught by E2E hit-testing).
   `CommandItem` now gates on `aria-[disabled=true]` instead. Other
   primitives use Radix, which omits `data-disabled` when false — unaffected.
5. Mobile bottom-bar labels are truncated ("Job targets" → "Job") with the
   full name kept in `aria-label`, so the accessible name stays meaningful.
Consequence: auth/consent E2E is deterministic (seeded by real signup flow);
`npm run e2e` needs generous timeouts (30s nav assertions, 120s tests) under
dev compiles + 350ms mock latency. Landing bundle unchanged (196.8KB gzip).
