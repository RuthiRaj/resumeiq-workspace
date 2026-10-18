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

## ADR-016 — 2026-10-17 — Workspace data access: Data API + caller JWT + RPC

Context: B1 needs every query scoped to the authenticated user *and* enforced by
Row Level Security, plus "increment the version and append the change_log row in
the same transaction". The backend has no database driver and no database
password — only `httpx`.

Decision (checked against the current Supabase docs, "Securing your API"): talk
to Postgres through the **Data API (PostgREST)** and pass the **caller's JWT** on
every request (`Authorization: Bearer <user jwt>`, `apikey: <publishable key>`).
PostgREST sets `request.jwt.claims` and role `authenticated`, so every statement
runs as `auth.uid()` and RLS applies in the database — this is Supabase's
"pass the user JWT to Postgres" idiom, and it needs no database password. The
`service_role` key (which bypasses RLS) is never used by the backend.

Mutations run through `SECURITY INVOKER` SQL functions (migration
`0002_workspace_api.sql`). Because the function runs as the caller, RLS stays
effective; because it runs inside the single PostgREST request transaction, the
per-user version bump, the `change_log` append and the item change commit
atomically. EXECUTE is granted to `authenticated` explicitly (Supabase is moving
to opt-in default privileges).

Consequence: one extra migration surface (7 functions) and a repository that
speaks PostgREST, but no DB password, no connection pooling to manage, and RLS is
enforced by Postgres as the primary control — the app-level `user_id` filters are
defence in depth. Unit tests use an in-memory repository; the Data API path is
covered by `httpx.MockTransport` tests and by opt-in integration tests
(`RUN_SUPABASE_INTEGRATION=1`), which are skipped otherwise.

## ADR-017 — 2026-10-17 — Workspace wire ↔ DB mapping (mismatches + resolutions)

Context: B1 must expose exactly the shapes the F3 frontend already uses
(`frontend/src/lib/schemas`, `frontend/src/mocks/handlers.ts`) on top of the B0
schema (`0001_initial.sql`). The two do not line up perfectly.

Decisions (the wire/frontend is the contract; `/frontend` is not edited):

1. `order` (wire) ↔ `position` (DB). Kept as-is, mapped in the repository. The
   DB column name is the odd one out; a future migration could rename it, but
   nothing depends on the DB name.
2. **Dates.** The wire sends **month precision** (`startDate`/`endDate`, e.g.
   `2022-09`) because the editor uses `<input type="month">`; the DB columns are
   `date` (day precision). Resolution: pad to the first of the month on write and
   truncate back to `YYYY-MM` on read, which round-trips client values exactly
   (the altered value is invisible to the UI). Proposed long-term: either the DB
   stores these as `text`, or the frontend adopts full dates — if the frontend
   ever needs day precision the current mapping must change.
3. `attachments` (wire, `{id,name,url}`) have no column; they map to the
   `evidence_links` rows (`url`→`url`, `name`→`label`, `id`→`id`). The wire's
   `links: string[]` maps to `workspace_items.links`.
4. **`change_log` label + seq.** The wire changelog entry carries `label`
   (captured at write time so the log stays readable after a soft delete) and a
   monotonic `seq`; the B0 table had neither. Resolution (migration 0002): add
   `change_log.label text` and `change_log.seq integer` (NOT NULL, unique per
   user). This also closes the ADR-013 openapi gap.
5. **`restore`.** The DB `action` enum has `restore`; the wire `op` enum does not
   (`add|edit|delete|reorder`). The DB stores the faithful `restore` and the
   repository maps it to the wire `edit` (the log row still has the right label).
   Proposed: add `restore` to the wire enum in a later frontend milestone so the
   distinction is not lost; not done here because `/frontend` is frozen.

   **Update 2026-10-17 (reconcile with ADR-019).** The frontend wire enum now
   carries `restore` (ADR-019), so the collapse is gone: the repository maps DB
   `action` to wire `op` **1:1** (`restore` → `restore`, see `workspace.py`
   `_ACTION_TO_OP`) and the in-memory double logs `restore` too. The original
   "map to `edit`" resolution above is superseded. `docs/api/openapi.json` was
   re-exported: `ChangeLogEntryResponse.op` is now
   `add|edit|delete|reorder|restore`.
6. **Reorder validation.** The mock silently ignores ids that are not in the
   section; the backend rejects the request (422) unless every id is an active
   item of that section. Stricter on purpose — a silent no-op would still bump
   the version and write misleading log rows.
7. **`verified` needs support.** Enforced in three places: the wire form (client),
   the Pydantic create/patch models, and the SQL functions (defence in depth), so
   an item can never end up `verified` without a document or link (PRD §4.2).

## ADR-018 — 2026-10-17 — B1 hardening: RPC privileges and the version↔log invariant

Context: after B1 was written, a read-only review of the live project
(security/performance advisors + `pg_proc`/`pg_policies` inspection) found issues
that are not data leaks but should not ship:

* all seven `api_workspace_*` functions were executable by `anon`, because
  `CREATE FUNCTION` grants `EXECUTE` to `PUBLIC` by default and migration 0002
  only *added* a grant to `authenticated`;
* `api_workspace_next_seq` / `api_workspace_next_version` trusted a
  **caller-supplied user id** (`p_user`) and were exposed as Data API RPCs. RLS
  meant a caller could not read or write another user's rows, but calling
  `next_version(<own id>)` inserted a `workspace_versions` row **with no
  `change_log` row**, breaking the "every mutation bumps the version *and* logs
  it" invariant;
* `set_updated_at()` had a mutable `search_path`; every RLS policy called
  `auth.uid()` per row (advisor 0003); four foreign keys were unindexed.

Decision — migration `0003_hardening.sql` (forward-only):

1. **Inline the two helpers into the five mutation functions and `DROP` them.**
   Of the three options offered, this is the safest:
   * "revoke from `authenticated` too" does **not** work: the mutation functions
     are `SECURITY INVOKER`, so the caller (`authenticated`) must itself hold
     `EXECUTE` on any helper it calls — revoking breaks the functions;
   * "assert `p_user = auth.uid()`" leaves an RPC that can still bump a version
     without a log row;
   * inlining removes the standalone surface entirely, so the only code that
     inserts a version also writes its `change_log` row in the same transaction.
2. **A deferred constraint trigger** (`workspace_versions_require_changelog`)
   re-checks at commit that every inserted `workspace_versions` row has a
   `change_log` row with the same `(user_id, workspace_version)`. Dropping the
   helper is not sufficient on its own: RLS lets a user `INSERT` their own
   `workspace_versions` rows directly through the Data API. The deferred check
   (it must be deferred, because the functions insert the version row before the
   log row) makes the invariant true for every writer.
3. `REVOKE EXECUTE … FROM PUBLIC, anon` on the five RPCs (and on
   `set_updated_at`), keeping `GRANT … TO authenticated`; pin
   `set_updated_at`'s `search_path`; rewrite the 54 policies to
   `(select auth.uid())`; add the four covering indexes.

Consequence: the workspace RPCs are usable only by `authenticated`; a workspace
version can no longer exist without its change-log entry, even via a direct
table write; the advisors' security/performance warnings are addressed. New
integration tests assert the anon role cannot call any `api_workspace_*` function
and that an authenticated user cannot insert a version row without a matching
change-log entry.

## ADR-019 — 2026-10-17 — F3 workspace audit: contract alignment + one real defect

Context: end-to-end audit of the workspace feature (F3 frontend against the B1
OpenAPI `docs/api/openapi.json` on `feat/b1-workspace-api`). Three wire
mismatches were fixable on the frontend now (ADR numbers 016–018 were reserved
for the B1 branch, which has since merged here, so the numbering lines up):

1. **Nullable fields.** `WorkspaceItemResponse` models `organization`,
   `startDate`, `endDate`, `location`, `deletedAt` and the changelog `label` as
   `string | null`, but `WorkspaceItemSchema` / `WorkspaceChangeLogEntrySchema`
   only used `.optional()`. A real response carrying `null` would fail
   `safeParse` and, at B7, feed a null into a controlled input. Fixed with
   `.nullish()`.
2. **Month precision.** The editor's `startDate`/`endDate` accepted any string up
   to 20 characters. ADR-017 sets the wire format to `YYYY-MM`, and the
   "end before start" check is a lexicographic `>` that is only correct at month
   precision. Added `MonthValueSchema` (`^\d{4}-(0[1-9]|1[0-2])$`, empty = unset)
   and used it in `WorkspaceItemFormSchema`; day precision and `2024-13` now fail
   inline with "Use month precision, e.g. 2024-06".
3. **Restore operation.** The B1 mapper collapses a DB `restore` into the wire
   `op: "edit"` (ADR-017 §5 proposed keeping the distinction). Added `restore` to
   `WorkspaceChangeOpSchema`, taught `describeChange`/`RecentChanges` about it,
   and made the mock store emit `restore` on undo instead of `edit`, so history
   can tell an undo apart from an edit.

Defect found and fixed (regression-tested): `AttachmentsEditor.startUpload`
called `finish()` — which appends the attachment and calls `onChange` — from
*inside* a `setPending` updater. React StrictMode double-invokes updaters, so one
file was appended twice with the same id (a duplicate attachment and a duplicate
React key). Confirmed by an E2E assertion (`attachment-item` resolved to 2). Fix:
progress is tracked in a ref and `finish()` runs from the interval callback, never
from an updater, and `finish()` is idempotent.

Reconciled when B1 merged (this branch): the B1 mapper now emits `op: "restore"`
instead of `edit` (ADR-017 §5 update, migration 0003) and a PATCH on a
soft-deleted item returns 404; the frontend already accepted both.

Still backend-side (documented, no frontend change needed):
- `WorkspaceItemUpdate` accepts `section`/`order`, which the frontend never
  sends (`deletedAt` is correctly absent).
- The frontend mock lets an edit touch a soft-deleted item where B1 answers 404;
  the UI never does this, so mock/B1 parity is deferred to B7, when the mock is
  removed.

Accepted, not a defect: `GET /api/v1/auth/session` answers **401** when nobody
is signed in, and the browser logs every 401 in the console. That is the designed
"no session" signal (the client maps it to `null`); the E2E console audit ignores
only that one 401 and still fails on hydration, duplicate-key and React warnings.

Consequence: `tests/e2e/workspace-audit.spec.ts` adds keyboard reorder,
attachments, persona switching, failure-recovery and a console/hydration guard;
`schemas.test.ts` / `workspace-utils.test.ts` / `workspace-store.test.ts` lock in
the null, month and restore behaviour.

## ADR-020 — 2026-10-17 — npm audit: dev-only `braces` advisory deferred

Context: `npm audit` reports 5 high-severity advisories, all one chain in the
lint toolchain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` →
`micromatch` → `braces` (`braces` stack-exhaustion DoS, GHSA-vfj7-8cjw-p6xm).

Options checked:
- `braces` latest published version is **3.0.3** and the advisory's vulnerable
  range is `*` (all versions), so there is no patched release to pin or override.
  `micromatch` (4.0.8) and `fast-glob` are likewise already at their latest and
  flagged.
- `npm audit fix --force` only offers `eslint-config-next@14.2.35`, a **major
  downgrade** (project is on 16.4.2) and explicitly off-limits.
- An `overrides` entry cannot point at a version that does not exist.

Decision: defer. None of the vulnerable packages are runtime dependencies —
`npm audit --omit=dev` reports **0 vulnerabilities** — and the only remediation
would break lint/CI. Re-check when upstream `fast-glob` drops `micromatch`, or
`braces`/`micromatch` ship a patched release to override.

Consequence: `npm audit` (full tree) keeps reporting the dev chain by design and
is tracked here rather than silenced with a breaking downgrade.

## ADR-021 — 2026-10-18 — F4 analysis is a deterministic reference engine

Context: F4 must show a compatibility score with visible methodology, classify
every job requirement against workspace evidence, split unsupported skills into
two honest gap types, and run ATS checks — all against mocks, with identical
inputs producing identical outputs (PRD §6.5, §6.4 JD-5, §6.7). The backend (B4)
does not exist yet, so the frontend needs a reference implementation it can be
diffed against rather than hand-written fixture numbers.

Decision:
1. `frontend/src/lib/analysis/` is a pure, deterministic engine:
   `taxonomy → extractRequirements → matchRequirements → computeFactors →
   computeAtsReport → buildAnalysisReport`. It reads only the target and the
   workspace items handed to it; no `Date.now()` inside the report body (the
   caller passes `generatedAt`).
2. **Score** = weighted sum of five factors with the PRD starting weights
   (required 0.40, preferred 0.15, experience 0.20, education 0.10, projects
   0.15). Requirement status maps to 1 / 0.5 / 0 for matched / partial /
   unsupported. A factor with no applicable requirements falls back to
   workspace depth; a factor with nothing to compare at all is **dropped** and
   the remaining weights are renormalised. The payload carries the *effective*
   weights and the effective weights sum to 1, so the visible breakdown always
   reconciles with the ring.
3. **Classification** is evidence-first: `matched` requires `verified` or
   `attested` support; `partial` means the requirement is mentioned only by
   items whose evidence is `related`/`missing`; `unsupported` means no mention.
   Unsupported becomes `not_evidenced` when an adjacent taxonomy skill (or a
   nearby requirement) exists, otherwise `genuinely_missing`. Adjacent skills
   are related, never equivalent (PRD §4.3).
4. **ATS** is count-based, no model: start at 100, subtract 12/7/3 per
   high/medium/low issue, clamp 0–100. Keyword coverage counts *skill*
   requirements only (prose requirements would fake coverage); a keyword is
   present on a whole-word label or taxonomy alias match. Layout and
   PDF-round-trip checks return `not_checked` until export exists rather than
   claiming a pass.
5. The methodology and both disclaimers ("not a probability of being hired",
   "not a guarantee for any employer's ATS") travel **in the payload**
   (`report.methodology`), with the same strings as the frontend constants.
   A backend wording change therefore needs no frontend release, and a report
   can never render a score without its method.
6. `schemas.test.ts` + `analysis.test.ts` + `analysis-fixtures.test.ts` lock the
   contract, the ordering of the three fixtures (≥10-point gaps), the gap
   split, determinism and schema validity.

Consequence: B4 can be validated by replaying the same target + workspace
snapshot against this engine. Any backend change to weights, renormalisation,
status thresholds or ATS penalties must update this ADR and the frontend tests,
or the two implementations will disagree.

## ADR-022 — 2026-10-18 — Import review: uncertainty, evidence and a two-call confirm

Context: IM-1..IM-3 require a type/size-gated upload, a side-by-side review with
uncertain fields highlighted, per-item confirmation, and User-attested vs
Verified depending on a certificate. There is no parser in F4, so the mock
fabricates the *document* while every claim about the user still comes from
what the user confirms.

Decision:
1. Upload gate: PDF/DOCX only, 5 MiB (`MAX_IMPORT_BYTES`), non-empty, checked on
   the client and again in the handler (the real B2 must sniff content, not
   trust the extension).
2. Extraction keeps two shapes: immutable `extraction` (what the parser read,
   with per-field `confidence` and 1-based `sourceLine`) and editable `values`
   (what the user verified). Confirmation copies `values`, never the raw
   extraction. Uncertain = confidence below **0.75**, printed in the UI; an
   item's confidence is its weakest field (conservative).
3. The preview text is labelled "simulated" in the UI, every uncertain field
   links to its source line, and a scanned/under-1 KB file produces the designed
   empty state instead of invented items.
4. **Confirm is two calls**: `POST /workspace/items` then `PATCH` the review
   item to `confirmed`. If the create fails the item stays `pending`; nothing
   enters the workspace before confirmation. The ordering is deliberate (create
   first, mark second) but not atomic: a failed PATCH leaves a created item and
   a pending review row, and re-confirming would duplicate it. This is recorded
   as an open B2 item; `docs/api/contract-proposals.md` proposes an atomic,
   idempotent `POST /imports/{id}/items/{item_id}/confirm` for B2 to implement
   before the mock is removed at B7.
5. IM-3 is derived, not chosen: `support` (file or link) → `verified`; no
   support → `attested`. A link also becomes an evidence link and a file an
   attachment, so `verified` stays true to its definition (ADR-017 §7).
   Attaching a certificate goes through the same save mutation as field edits,
   so that mutation must carry `support` as well as `values`. The first cut sent
   only `values`, which showed "Verified" in the card while the server still
   recorded `attested` on confirm — caught by the F4 E2E and fixed in
   `useSaveImportValues`; the UI state and the persisted evidence now always
   come from the same PATCH.
6. Rejection writes no workspace item and is reversible ("Put back for review").

Consequence: the review screen can always show read-vs-accepted, the evidence
state is structurally impossible to fake, and the only known integrity gap
(duplicate on retry after a partial confirm) is documented with a proposed fix
rather than silently patched in the client.

## ADR-023 — 2026-10-18 — Analysis theatre is driven by the run, not a client timer

Context: PRD §7.4.4 asks for a six-stage theatre with a micro-animation per
stage, a failure state with retry, and a reduced-motion version. A purely
cosmetic timer would lie about progress and would desynchronise on reload.

Decision:
1. The run is server state (`AnalysisRun`) advanced from elapsed wall-clock time
   and persisted in the mock store. The client polls
   `GET /targets/{id}/analysis/run` every 300 ms while `status === "running"`
   and stops on success/failure. Reloading the page resumes the same run.
2. The stage contract is six keys — `reading`, `extracting`, `searching`,
   `matching`, `scoring`, `writing` — with mocks timed 900/900/800/1000/600/900
   ms (≈5.1 s total). Each stage has its own icon and a motion-only micro
   animation (`animate-spin/pulse/ping/bounce` behind `motion-safe:`).
3. **Reduced motion** is a real alternate rendering, not a faster animation:
   `useReducedMotion()` (with a test override) removes the animation and adds a
   static state marker plus text status; `StageProgress` exposes
   `data-motion="full|reduced"` so E2E can assert the branch actually taken.
   The bar, stage list, progressbar and polite `aria-live` status remain.
4. Failure names the failed stage and code (`provider_unavailable` in the dev
   toggle, failing at `matching`), states that nothing was saved, and offers a
   retry that starts a **new** run from stage 1. `POST …/analysis` is the only
   mutator; polling never starts a run.
5. The dev failure toggle fails the *run mid-flight*, not the page load, so the
   failure is observed in the theatre exactly as a real provider outage would
   be (`tests/e2e/targets.spec.ts` covers fail → retry → report).
6. Consent is checked before the run starts; without recorded consent the gate
   replaces the theatre, and the contract asks B4 to return
   `403 consent_required` as defence in depth (the mock cannot, because consent
   lives in the F2 browser store).

Consequence: progress shown to the user is the state the server actually holds,
the theatre has a tested failure path, and the reduced-motion version is
verifiable rather than assumed. SSE can replace polling later without changing
the payload or the UI.

## ADR-024 — 2026-10-18 — F4 fixtures, dev-only controls and what E2E guarantees

Context: F4 acceptance requires three job descriptions (strong, partial, poor)
that render distinct reports against the existing workspace fixtures, and the
four screens need end-to-end coverage without a real backend or AI provider.

Decision:
1. `analysis-fixtures.ts` holds the three postings as **sample job ads**, not
   claims about the user. Their ids are stable (`strong`, `partial`, `poor`),
   and `analysis-fixtures.test.ts` asserts the mid-level workspace scores them
   in order with ≥10 points between bands, that the partial posting shows all
   three requirement states and both gap types, that the poor posting has ≥3
   genuine gaps, and that reports are byte-identical for identical inputs.
2. Dev-only controls (`/dev/workspace-persona`, `/dev/failures`,
   `/dev/sample-targets`) 404 outside `next dev`; the sample targets carry
   `sample: true` and stable ids `sample-target-{strong,partial,poor}` so E2E
   and demos can deep-link without depending on creation order.
3. The intake form's "load a sample posting" and the targets list's "load sample
   targets" buttons are development-only; in production a real user never sees
   fixture data or a fixture switcher.
4. Wire rules carried from the F3 audit into the F4 schemas: month precision
   (`YYYY-MM`) everywhere a user types a date, and `.nullish()` for every field
   the database can return as `null` (ADR-019). `docs/api/openapi.json` is not
   edited; the proposed F4 routes live in `docs/api/contract-proposals.md` for
   B2/B4 to export later (same pattern as ADR-013).
5. E2E covers the acceptance path in `tests/e2e/targets.spec.ts`: import gating
   + staged extraction + side-by-side review + per-item confirm/reject + the
   attested/verified rule; target intake behind the consent gate with nothing
   created while consent is missing; theatre stages advancing into the full
   report (methodology, disclaimers, requirement states, both gap buckets,
   skills, content report, roadmap, ATS panel); the failure → retry → report
   path; the three fixtures producing ordered, distinct scores; reduced motion;
   and 360 px without horizontal scroll. Locators target roles, labels and
   `data-testid` seams, never styling or copy fragments that are meant to
   change.

Consequence: the three report states are reproducible from a cold workspace with
one dev button, the report cannot silently flatten into one band without a test
failure, and the E2E suite exercises the same composition the real backend will
serve at B7.

## ADR-025 — 2026-10-18 — Backend CI skip path: a pre-checkout step must not inherit `working-directory: backend`

Context: the Backend workflow has to keep a *required* `backend` check that
always reports, so `paths:` filters are not used on the trigger. Instead a cheap
`detect` job decides whether anything backend-relevant changed and the `backend`
job either runs the full gate or short-circuits with a "Nothing to check" step.
On the first frontend-only run through that skip path (PR #10) the required
"backend" check failed after ~5 s on both `pull_request` and `push`, while
"Detect backend changes" passed.

Root cause: the job declares `defaults.run.working-directory: backend`, and that
default applies to **every** `run` step in the job — including "Nothing to
check". That step *is* the skip path, and it runs before `actions/checkout`,
which the skip path also skips. On a fresh runner `backend/` does not exist until
checkout creates it, so the shell could not `cd` into it and the step failed
immediately with `working directory 'backend' does not exist`. The failure had
nothing to do with detection: the detector correctly reported
`backend=false`.

Decision: keep the job-level `working-directory: backend` for the heavy steps and
pin the "Nothing to check" step to `working-directory: ${{ github.workspace }}`,
which always exists on the runner. Nothing else changes — the `on:` triggers, the
job id `backend`, its required check name, every heavy step, and the fail-safe
(`if: needs.detect.outputs.backend != 'false'`, so an empty or missing detector
result still runs the whole gate) are untouched.

Rejected alternatives:
- Give each of the five heavy steps its own `working-directory: backend` and drop
  the job default. Correct, but a bigger diff that re-creates the same footgun
  for any future step added before checkout.
- Move the echo into the `detect` job. Breaks the "always starts, always reports"
  contract, because the required check is the `backend` job itself.

Consequence: a PR that touches none of `backend/`, `docs/api/openapi.json` or this
workflow reports a green "backend" check in seconds; a PR that touches any of
them still runs `uv sync --frozen`, `ruff check`, `ruff format --check`, `mypy` and
`pytest` unchanged.

Numbering note: ADRs 021–024 are claimed by the F4 branch (now merged), so this
one is 025 rather than 021 to avoid duplicate headings.

## ADR-026 — 2026-10-18 — UI/QA sweep: placement, dev-only state, and honest import review

Context: a pass over every built route at 360 / 768 / 1280 px surfaced six defect
areas. Only one was a crash; the rest were honesty or consistency defects: the
import review could look as though it had read the user's file, its forms offered
fields the workspace cannot store, the dev failure toggle persisted in
`localStorage` and could leave the app failing on every later load, menus opened
at inconsistent positions and could clip off-screen, the placeholder pages
described features without saying what the page was for, and no test asserted any
of this at more than one width.

Decision:
1. Menu placement belongs to the shared primitives, not to call sites.
   `DropdownMenuContent` and `PopoverContent` default to `side="bottom"`,
   `align="end"`, `sideOffset={8}`, `collisionPadding={8}`, `avoidCollisions`,
   with `max-h-[var(--radix-*-content-available-height)]` + `overflow-y-auto`.
   Rejected: fixing each menu individually — the next menu added would drift
   again, and the defect was that there was no shared contract.
2. The dev failure flag is in-memory (`src/mocks/dev-state.ts` module variable),
   never `localStorage`, so a fresh page load always starts clean; and the
   dev-only client moved to `src/lib/api/dev.ts`, reached only through a dynamic
   `import()` behind a `process.env.NODE_ENV !== "development"` gate so `next
   build` eliminates it. A build-artifact check (`npm run check:dev-excluded`,
   wired into CI) proves the failure markers appear in none of the chunks a
   production page loads. "Excluded" must be verifiable, not asserted in a
   comment, and a developer convenience must never persist into a state the
   developer cannot see.
3. Import review honesty is enforced by shape, not by a sentence: a prominent
   demo-mode banner built from a shared `DEMO_MODE_COPY` constant (so the banner
   and the test that asserts it cannot drift), an unconditional "Sample" badge on
   every extracted card, and every fixture name rewritten to a "Sample …" form.
4. Editable fields are decided per section by `REVIEW_FIELD_POLICIES` in the
   schema layer and consumed by the card: a personal detail is a name and a
   location, a skill is chips, only sections that can carry a document offer the
   certificate control. Skills are reviewed as one card whose chips create one
   workspace item per skill (`reviewItemToWorkspaceInputs`); the single-item path
   (`reviewItemToWorkspaceInput`) now throws for a skills section rather than
   silently dropping them.
5. Placeholder pages state what the page will do, list its capabilities and link
   back to the workspace. They are not built, and they carry no dead buttons.
6. One sweep (`tests/e2e/ui-qa.spec.ts`) walks every built route at three widths
   and asserts no horizontal scroll, no dead links, that Tab lands on a visible
   element, no unexpected console error, and axe WCAG 2.x A/AA; the two defects
   above additionally get explicit bounding-box and persistence assertions.

Consequence: the fix for each defect is a rule the codebase enforces (a shared
default, a module boundary, a schema policy, a test) rather than a one-off patch,
so the same class of defect fails a check next time instead of shipping.

Addendum (same day, after the sweep first ran): the sweep initially failed on its
own helpers, which is the most expensive kind of wrong — it could not see what it
was written to see. Four were fixed before its verdict could be trusted: a heading
locator that also matched the brand-new-workspace empty state's second heading
(`exact: true` now), a case-sensitive `/Account menu/` trigger regex against a name
that now begins with the user's initials, a "nothing rendered" probe whose
`.first()` picked the desktop sidebar, which is `hidden` below `md`, and focus
logic that pressed Tab only when focus was *already* on the dev overlay — so it
never pressed Tab at all and reported `body` for every route. The last one now
presses Tab (bounded) until the app takes visible focus, and treats
`offsetParent === null` as focused-but-fixed rather than invisible.

With the sweep honest, two real defects remained:
1. `aria-prohibited-attr` (serious): `aria-label` sat on generic `div`s — the
   loading skeletons in thirteen places. ARIA forbids a name on a generic element
   and assistive tech ignores it, so the label was decoration. Those containers now
   carry `role="status"`, which both permits the name and announces the wait.
2. At 360 px the auth pages (`/signin`, `/signup`, `/forgot-password`) and
   `/onboarding` scrolled sideways: their decorative glows (`size-96` centred,
   `size-72` at `left-1/4`) were wider than the viewport; and the OAuth provider
   buttons overrode their name with an `aria-label` ("… (mocked demo account)")
   whose text is not a contiguous part of the visible text ("Continue with Google
   Mocked in F2") — `label-content-name-mismatch` (serious). The glows are now
   clipped by an `overflow-hidden` container, which is what `EmptyState` and the
   landing CTA already did, and the OAuth label is gone so the name comes from the
   content. `defect 4` in the sweep pins both at 360 px, signed out, so it does not
   depend on a redirect race.

Hygiene: `eslint` walked the Playwright trace bundles under `test-results/`
(generated, git-ignored, thousands of third-party files), so `eslint.config.mjs`
now ignores `test-results/**`, `playwright-report/**` and `blob-report/**`. Lint is
green on source alone.

Reconciliation (same day) — the axe fixes removed accessible names that older
specs located by. Fixing `label-content-name-mismatch` means the visible text
must be *inside* the accessible name, which in three places only worked by
dropping an `aria-label` (the section card, the target report card, and the
"Open all navigation" trigger). Five pre-existing E2E assertions still referenced
the removed names, so they were updated rather than the fix being reverted:
`section-card.tsx` gained `data-testid="section-card-{key}"` /
`section-count-{key}` seams (the card's name is now prose, unsuitable for a
locator), `analysis.spec.ts#scoreFor` filters the list by the card's visible
role text, `auth-shell.spec.ts` uses "More navigation", and the import/targets
copy assertions follow the new shared strings and the five sample items. These
are locator/copy updates only — no behaviour changed. The sweep's own defects
(a `role="status"` on the loading skeletons, the 360px auth glows, the OAuth
label) are described above.

Addendum 2 (same day) — what the second pass added:

1. **The dev route indicator is off** (`devIndicators: false` in
   `next.config.ts`). Its floating overlay owns the first keyboard tab stops in
   development and renders inside a shadow root, so focus appears permanently
   "stuck" on `nextjs-portal` and an honest keyboard sweep of the app cannot be
   written. It is dev-only chrome, absent from any production build, and compile
   and runtime errors are still surfaced — only the indicator badge is hidden.
2. **`instant = false` on `/history`, `/resume`, `/settings` and `/privacy`.** The
   `(app)` layout resolves the mock session on the client, so these segments
   cannot produce a meaningful static shell at navigation time and Cache
   Components' instant-navigation validation flags them — the same reason
   `/workspace` opts out (ADR-014). The sweep asserts no "instant navigation"
   console error on `/privacy`, so the opt-out is checked, not assumed.
3. **The a11y fix broke four existing locators, and the specs were updated rather
   than the names restored.** Removing an `aria-label` that duplicates (or hides)
   visible text is the *fix* for `label-content-name-mismatch`; keeping the label
   to keep a test green would reintroduce the violation. So `analysis.spec.ts`
   (`scoreFor`) locates the target card by content, `auth-shell.spec.ts` uses the
   renamed "More navigation" button, `import.spec.ts` asserts the section card by
   its `section-count-*` test id, and `targets.spec.ts` uses the reworded
   "Supporting evidence is attached…" copy. Each is a locator change in a test,
   not a behaviour change in the app.

Two further findings were dev-server artefacts rather than product defects, and
both were dealt with explicitly instead of being silenced:
- The Next.js dev route indicator is a floating overlay whose contents live in a
  shadow root, so it owns the first keyboard tab stops and focus reads as stuck on
  `nextjs-portal`. It never ships, and it makes an honest keyboard sweep
  impossible, so `next.config.ts` sets `devIndicators: false` (compile and runtime
  errors are still surfaced). The sweep still tolerates `nextjs-portal` in case a
  developer re-enables it.
- A streamed client navigation can briefly leave the document without a `<title>`.
  axe's `document-title` rule fired on `/signup` during a redirect, which is a
  race, not a defect: the sweep now waits (bounded, 5 s) for a title before running
  axe, so a page that genuinely never gets one is still reported.

The route sweep is also expensive by nature — 29 routes x 3 widths, each with a
full axe pass against a dev server that compiles routes on demand — so it carries
its own 900 s budget (`test.describe.configure`), while every other test keeps the
300 s default. Without it the sweep was aborted mid-way on a loaded machine and
reported a timeout instead of its findings.

