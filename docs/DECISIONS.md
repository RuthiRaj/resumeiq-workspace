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

## ADR-009 — 2026-10-16 — B0 backend scaffold choices
Context: Milestone B0 needs a minimal FastAPI backend proving auth + contract
before any domain logic (B1+). Constraints: Python 3.12+, `uv` preferred,
Pydantic v2, OpenAPI as the frontend/backend contract, Render free hosting.
Decision:
1. `uv` manages deps with a committed `uv.lock` (`requires-python >=3.12`);
   Dockerfile installs with `uv sync --frozen` on `python:3.12-slim` as a
   non-root user. Plain `venv + pip install -e ".[dev]"` documented as fallback.
2. Auth via `PyJWT` + `PyJWKClient` (no extra Supabase server SDK needed for
   verification). Type check is `mypy` (over pyright: config lives in
   `pyproject.toml`, matches the pre-commit story); lint/format is Ruff.
3. Security defaults: strict CORS allowlist from config (no wildcard, no
   credentials), security headers middleware, streaming 1 MiB request-size
   cap (413), fixed-window per-IP rate limiter. The limiter is an explicit
   single-process in-memory placeholder — it must become a shared store
   (Redis) if the backend ever runs more than one replica.
4. Logging is JSON to stdout with method/path/status/duration/request-id
   ONLY — bodies, headers, IPs and tokens are never logged (PRD §11).
5. `app/ai/gateway.py` is an empty placeholder with a no-AI-calls guarantee;
   the real gateway lands in B3. `GET /health` is unauthenticated;
   everything under `/api/v1` requires a verified Supabase JWT.
6. `docs/api/openapi.json` is the contract: exported by
   `backend/scripts/export_openapi.py`, enforced by `tests/test_openapi.py`.
Consequence: B1+ mounts domain routers under `app/api/v1/router.py` and
replaces the rate limiter before horizontal scaling; frontend Zod/MSW must
track the exported OpenAPI file.

## ADR-010 — 2026-10-16 — Supabase JWT verification (JWKS primary, HS256 fallback)
Context: `/api/v1/me` must accept a valid Supabase JWT. Supabase now has two
signing systems (legacy HS256 shared secret vs asymmetric signing keys).
Decision (verified against live Supabase docs fetched 2026-10-16,
`/docs/guides/auth/jwts` and `/docs/guides/auth/signing-keys`):
1. Primary path: asymmetric keys verified against the project JWKS at
   `GET {SUPABASE_URL}/auth/v1/.well-known/jwks.json` (match JWT `kid`/`alg`;
   key cache kept short — the endpoint itself is edge-cached 10 min).
2. Legacy path: local HS256 verification ONLY when `SUPABASE_JWT_SECRET` is
   set, as a migration fallback. The docs recommend the Auth-server
   `GET /auth/v1/user` check or migrating to asymmetric keys instead, and warn
   local HS256 verification risks long-lived impersonation if the secret
   leaks — so the fallback is opt-in and documented as temporary.
3. Claim checks: `exp` enforced (30s leeway), `aud` must equal
   `SUPABASE_JWT_AUDIENCE` (Supabase default `authenticated`), `iss` checked
   when configured (defaults to `{SUPABASE_URL}/auth/v1`), `sub` required.
   Failures map to distinct 401 codes (`token_expired`, `invalid_audience`,
   `malformed_token`, …); no JWKS and no secret is a 500 `auth_not_configured`.
Consequence: setting `SUPABASE_URL` alone is enough on new projects; legacy
projects add the secret until they migrate, then unset it.

## ADR-011 — 2026-10-16 — B0 database schema and RLS model
Context: PRD §6 needs 16 entities with per-user privacy, evidence states, and
standard-vs-tailored resume rules, but B1 (not B0) builds the APIs.
Decision: single forward-only migration `backend/db/migrations/0001_initial.sql`
(no down migration for B0) with:
1. `user_id REFERENCES auth.users ON DELETE CASCADE` on every table; RLS
   enabled on every table with `auth.uid() = user_id` policies.
2. Append-only history (`change_log`, `audit_events`, `workspace_versions`,
   `analysis_reports`, `resume_versions`): SELECT + INSERT policies only.
3. Soft delete (`deleted_at`) everywhere user-facing; one live standard resume
   per user via partial unique index; tailored rows snapshot `target_id` +
   `workspace_version` with a `stale` flag.
4. `skill_relations.relation` constrained to `related` (adjacent tech is never
   equivalent, PRD §4.3); `CHECK` enums for evidence/section/status fields.
Consequence: B1 APIs inherit privacy from RLS; they must still enforce the
app-level rules (verified-items-need-links, sync/stale transitions) since the
DB cannot express them. Migration reviewed but NOT executed — no local
Postgres here; must be applied to a linked Supabase project before B1
(see `backend/db/README.md`).

## ADR-012 — 2026-10-17 — Workspace has 12 routable sections, not WS-1's 11 groups
Context: PRD §6.1 WS-1 lists eleven workspace groups, but one of them —
"certificates and courses" — bundles two different things: certificates you are
awarded, and courses/structured learning you completed. Each needs its own
evidence rules and empty-state copy.
Decision: model them as two schema sections, `certificate` and `course`, giving
`WORKSPACE_SECTION_ORDER` twelve entries and twelve routes under
`/workspace/[section]` (`generateStaticParams` enumerates all twelve). UIs that
mirror WS-1 in prose (docs, onboarding copy) keep the eleven-group wording.
Consequence: completeness, the section grid and the standard-resume derivation
all count twelve sections (see `computeCompleteness`); tests assert against
`WORKSPACE_SECTION_ORDER.length`, not a hard-coded 11 or 12.

## ADR-013 — 2026-10-17 — Workspace mock API: changelog `label` + openapi gaps
Context: F3 needs an end-to-end workspace against MSW mocks that stay shape-
compatible with the FastAPI contract (`docs/api/openapi.json`), which after B0
only defines `GET /health` and `GET /api/v1/me`. The F3 endpoints
(`/api/v1/workspace*`, `/api/v1/resume/standard`, `/api/v1/dev/*`) are
therefore specified by the frontend Zod schemas in
`frontend/src/lib/schemas/workspace.ts` until B1 exports matching OpenAPI.
Decision:
1. Add an optional `label: string` to `WorkspaceChangeLogEntrySchema`. The mock
   store captures the item title at write time, so the change log stays
   readable after a soft delete (the item may no longer be listed). Optional,
   so an entry without it remains valid.
2. `DELETE /workspace/items/:id` returns **204** (no body); restore is
   `POST /workspace/items/:id/restore`; reorder is `POST /workspace/reorder`
   returning the full workspace and bumps the version exactly once.
3. `GET /workspace/changelog` returns newest-first. `POST /workspace/reorder`
   logs one `reorder` row per id in the request but a single version bump.
4. Dev-only fixture endpoints (`/api/v1/dev/workspace-persona`,
   `/api/v1/dev/failures`) 404 outside `next dev`, so fixtures can never reach
   a production workspace.
Open gaps for B1: (a) `label` must be added to the exported OpenAPI changelog
schema (or the frontend must drop it); (b) B1 must export
`/api/v1/workspace*` and `/api/v1/resume/standard` into `openapi.json` and the
frontend Zod schemas + MSW handlers must be reconciled against that export
before the mock layer is removed at B7.

## ADR-014 — 2026-10-17 — MSW readiness gate + opting /workspace out of instant-nav validation
Context: F3 E2E exposed two dev-only failures that also broke real navigation:
1. A protected-route reload intermittently bounced to `/signin`. `AuthProvider`
   resolves the session with `GET /api/v1/auth/session`, but React runs child
   effects before parent effects, so that fetch ran before `QueryProvider`'s
   effect had started MSW. The request passed through the worker, got a 404 from
   the dev server, and the guard read "unauthenticated".
2. Cache Components' instant-navigation validation flags `/workspace` and
   `/workspace/[section]` ("the segment was dropped from rendering") because
   they are client-rendered with no meaningful server shell. The resulting dev
   overlay intercepted pointer events and could force reloads mid-test.
Decision:
1. `QueryProvider` (the single MSW starter, shared by `(app)` and the auth
   screens) renders nothing until `startMocks()` resolves, and only in
   development. If the worker fails to start it still renders, so screens fall
   back to their honest error states rather than a blank page. Production is
   unchanged (no mock API has ever existed there).
2. `export const instant = false` on `/workspace/page.tsx` and
   `/workspace/[section]/page.tsx` — the documented opt-out (Next 16
   `dist/docs`, instant-navigation guide → Opting out) for segments that cannot
   render at navigation time. Validation stays on for every other route.
Consequence: dev-only blank frame while MSW starts; protected-route reloads and
E2E are deterministic. When B1 ships the real backend, the gate is removed
along with the MSW layer (B7) and `instant` can be revisited.

### ADR-014 amendment (same day) — the gate must share one in-flight promise

The first cut of the gate was incomplete and still produced the bounce under
parallel E2E load. Two things had to change:

1. `startMocks()` memoized a *boolean* (`if (started) return true`). React
   StrictMode runs mount effects twice, and the second call returns `true`
   immediately while the first is still awaiting `worker.start()`. The gate then
   released the children, `getSession()` ran before MSW was intercepting, got a
   404, and the guard flipped to `unauthenticated`. That unmounted the whole
   `(app)` subtree — destroying typed-but-unsaved editor state, stealing focus
   mid-keystroke, and (in the worst case) rendering the "redirecting to sign in"
   screen. The fix is to memoize the *promise*: every caller awaits the same
   in-flight promise, which only settles once the worker is ready. This is a
   real dev-only bug, not just a test artifact: a slow dynamic import was enough
   to lose a user's in-progress edit.
2. The dynamic `import("./browser")` must stay lexically inside the exported
   `startMocks` function. Pulling it into a separate non-exported `startWorker()`
   referenced via `pending ??= startWorker()` made Turbopack's dev server resolve
   `msw/browser` against Node conditions (`"node": null` in MSW's export map) and
   fail the build with "Can't resolve 'msw/browser'" for both the client and the
   client-SSR layers. `next build` was unaffected, which is why the regression
   only showed up under `next dev`.

## ADR-015 — 2026-10-17 — Autosave diffs values, not RHF event types

Context: F3's editor autosave subscribed with `form.watch((_values, { type }) => ...)`
and returned early unless `type === "change"`. Only the plain inputs (`title`,
`organisation`, dates) are `register`ed, so they were the only fields that could
schedule a save. The bullet, link, tag, attachment and evidence editors commit
through `form.setValue`; React Hook Form's `setValue` notifies watchers with a
`{ name, values }` payload and **no `type`** (see `_setValue` in
`react-hook-form/dist/index.esm.mjs` v7.90), so every one of those edits was
silently ignored. A save that failed validation on an intermediate value — a
half-typed URL such as `https:/` is rejected by the link refinement — then
stranded the editor: status stayed `error` with no further retry, because the
next keystrokes were all `setValue` edits. That is the real, user-visible bug
behind the one flaky E2E run; it was not a test artifact. The same filter also
made the two failure modes indistinguishable, since both branches showed the
same hard-coded message.

Decision: the watcher compares `JSON.stringify(values)` against a
`savedSnapshot` ref instead of inspecting the event. Any value change that
differs from what was last persisted schedules the debounced save; a change back
to the persisted value schedules nothing. RHF's own `isDirty` cannot express
this — it is measured against the sheet's opening defaults, so it stays `true`
after a successful save and would re-save the same values forever. `save.current`
updates the snapshot only on success (so a validation failure retries on the
next edit) and now sets a distinct message per failure mode: "Fix the highlighted
fields…" for schema errors, "Couldn't save your changes…" for request errors.

Consequence: opening an editor no longer counts as a change (the reset also
emits a valueless `type`, and the snapshot guard absorbs it), so browsing an item
never bumps the workspace version. `item-editor-sheet.test.tsx` locks in both the
setValue path and the invalid-then-corrected recovery; reverting to the `type`
filter fails 3 of its 4 cases.

