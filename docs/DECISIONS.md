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

## ADR-026 — 2026-10-18 — Environment hygiene: runtime vs test env, fail-fast startup, secret guard

Context: the runtime `backend/.env` held integration-test credentials, `.env.example`
mixed runtime and test variables with no grouping, the backend started happily with
no Supabase configuration (failing only per-request with `auth_not_configured` or
`data_api_not_configured`), `frontend/.env.example` advertised a variable no code
read, and nothing prevented a `service_role` key from being committed.

Decision:

1. **Split the environments.** `backend/.env` is runtime only; test-only values
   (`RUN_SUPABASE_INTEGRATION`, `SUPABASE_TEST_*`) live in `backend/.env.test`
   (git-ignored, with a committed `backend/.env.test.example`), so a deployed
   backend never carries test passwords. `run_supabase_integration` was removed
   from `Settings` because nothing in the app read it. `tests/supabase_auth.py`
   now loads `.env` (project URL + publishable key) and `.env.test` (gate +
   credentials) in that order, so the test file wins on any clash.
2. **`.env.example` is grouped and complete** — App, CORS, Supabase, AI providers,
   Limits — with a comment per variable, no real values, and the AI group
   deliberately empty (no provider key is read before B3; adding an unread
   variable would violate "remove what nothing reads"). `APP_VERSION` was added
   because `main.py`/`health.py` read it.
3. **Fail fast at startup.** `Settings.missing_required()` /
   `Settings.validate_required()` raise `MissingSettingsError` naming the missing
   variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and never a value. It is
   enforced from a FastAPI **lifespan**, so uvicorn/a real deploy fails before
   serving, while tests that construct an app *without* a lifespan stay hermetic.
   Rejected alternatives: validating in `create_app()`/the constructor (would
   break `Settings(_env_file=None)` defaults tests and the `test_openapi` /
   `test_health` apps built with incomplete settings), and gating on
   `environment == "production"` (the shipped example defaults to
   `ENVIRONMENT=development`, so a misconfigured deploy would still start).
4. **`backend/scripts/check_env.py`** reports, for the app and for the tests,
   which required variables are `set` or `missing` — names only, never values
   (`--strict` exits 1 when an app variable is missing).
5. **Frontend env policy.** `frontend/.env.example` lists no active variable:
   nothing reads one yet (MSW only), so the two Supabase names appear only as
   commented "when B7 wires it" placeholders. A repo-wide vitest guard
   (`frontend/src/lib/config/no-secrets.test.ts`) fails `npm run test` if a
   secret-shaped value appears in any tracked or new non-ignored file. It matches
   **values, not words**, so documentation that names the `service_role` key is
   allowed; an assignment of one is not.
6. **`.gitignore`** now also covers `private-fixtures/`, `*.pdf`/`*.docx` outside
   `**/tests/golden/**`, `*.log`, and un-ignores `.env.test.example` so the test
   template can be committed while `.env.test` stays ignored.

Consequence: the app cannot start misconfigured and names what is missing without
leaking a value; test credentials never reach a deployed backend; a committed
private key fails CI. Migration note: a deployed service must now set
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` or it will refuse to start, and any
developer `.env` copied before this change should be compared with the new
`.env.example` (the test variables moved to `.env.test`).

Hygiene (same change): deleted the generated `frontend/test-results/` Playwright
artifacts and the regenerated `frontend/AGENTS.md` (ADR-007); `git worktree prune`
found no stale metadata; a scan of all 43 commits and the tracked tree found no
`sb_`, `gsk_`, `nvapi-`, `github_pat_` or JWT-shaped value.

## ADR-027 — 2026-10-18 — UI/QA sweep: placement, dev-only state, and honest import review

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
- `next dev`'s HMR socket (`ws://…/_next/hmr`) is intercepted by MSW and closed,
  which logs "WebSocket is already in CLOSING or CLOSED state" — dev-server
  tooling that no production build ships, seen once on `/workspace/course`. The
  sweep's console filter excludes that exact message for the same reason it
  excludes the `nextjs-portal` dev overlay; real console errors still fail the
  sweep.

The route sweep is also expensive by nature — 27 routes x 3 widths, each with a
full axe pass against a dev server that compiles routes on demand — so it carries
its own 900 s budget (`test.describe.configure`), while every other test keeps the
300 s default. Without it the sweep was aborted mid-way on a loaded machine and
reported a timeout instead of its findings.

Addendum 3 (same day) — an E2E race the sweep exposed in *older* specs, not a
product defect. `workspace.spec.ts` ("Move buttons … persists across reload") and
`workspace-audit.spec.ts` ("reorders with the keyboard … persists it") polled the
DOM for the new row order and then reloaded immediately. But `useReorderItems`
(`src/features/workspace/use-workspace.ts`) mutates optimistically — `onMutate`
reorders the cache before the `PATCH` resolves — so the tests were seeing
optimistic state and the reload cancelled the still-in-flight request. The titles
were then correct in the DOM but never persisted, which is a timing assumption in
the test, not a bug in reorder (the code paths are byte-identical to master). Both
specs now await the order the mock API has actually *stored* (a `persistedTitles`
helper that reads `/api/v1/workspace`) before reloading, so the assertions test
persistence rather than latency. No application code changed.

Numbering note: ADR-026 is claimed by the environment-hygiene change merged from
`chore/clean-env`, so this one is 027 rather than 026 to avoid duplicate headings.

## ADR-028 — 2026-10-18 — B2 import parsing: deterministic extraction, discard the file, confirm through one RPC

Context: IM-1..IM-3 need a real PDF/DOCX path behind the review screen F4
already built against MSW mocks. `docs/api/contract-proposals.md` §2 fixes the
endpoints, the field names and the extraction shape (`extraction` = what was read
with per-field `confidence` + 1-based `sourceLine`; `values` = what the user
verified), and PRD §11 fixes the security posture. Hard product rules apply: no
fabricated fields, no score that reads as a guarantee, and nothing entering the
workspace without the user's decision.

Decision:

- **Extraction is deterministic and local.** A section parser over extracted text
  finds headings (experience, education, project, skill, certificate, …), then
  entries per section: title line, employer/institution, month-precision dates,
  bullet lines, a `Technologies:` style tag list, and comma-separated skill
  lists. Every value carries a confidence (title 0.9, month-precision date 0.85,
  bare year 0.5, org 0.75 with keyword hint else 0.6, skill 0.8, name 0.6,
  location 0.5) and the 1-based `sourceLine` it came from; an item's confidence is
  the weakest of its fields (same convention as ADR-022's uncertainty).
  `UNCERTAIN_CONFIDENCE = 0.75` is shared with the frontend.
- **Permissively licensed libraries only.** `pypdf` (BSD-3-Clause) for PDF,
  `python-docx` + `lxml` (MIT / BSD-3-Clause) for DOCX, both typed. No AGPL, no
  OCR engine, and **no AI call** in this milestone.
- **Content is sniffed on magic bytes, never on the file name.** The declared
  type comes from the extension, then the bytes must agree (`%PDF-`, or a zip
  that actually contains `word/document.xml`); a mismatch is 415. DOCX zips are
  bounded by entry count and compression ratio (zip bomb), and PDFs by page cap;
  the whole parse runs under a deadline checked inside the page/block loops.
- **The upload is parsed in memory and discarded.** Nothing about the original
  file is stored and its bytes and extracted text are never logged (only type,
  size and item count). `source_text` is persisted for the preview because the
  user needs to see what was read; a scanned or image-only document returns
  `previewAvailable: false`, `sourceText: ""` and no items — "nothing could be
  read", honestly.
- **A DOCX reports `pageCount: 1`.** The format does not record a page count and
  we will not invent one.
- **A bare year is shown as read but never becomes a value.** `extraction` may
  say `2019`; `values.startDate` stays `""` because the wire accepts `YYYY-MM`
  or `""` only. Picking a month for the user would be fabrication.
- **Confirm is one `SECURITY INVOKER` function**, `api_import_confirm(uuid,
  text) -> uuid`, mirroring the B1 RPC style: it reads the row's `values` and
  `support`, inserts the `workspace_items` row, writes the `change_log` entry,
  adds the evidence link, and flips the review item to `confirmed` in a single
  transaction. It is idempotent (confirming twice returns the same workspace
  item) and raises `P0002`/`P0003` for a missing session/item. Nothing else
  writes a workspace row from an import.
- **Evidence follows support.** A confirmed item is `attested`; it is `verified`
  only when a certificate file or link was attached, matching ADR-017 §7.
  Because B2 discards uploads, a certificate *file* becomes an attachment with an
  internal `import://<import_id>/<item_id>` url, not a fabricated external link;
  B6 replaces it with a private-Storage signed URL.
- **Error codes follow the contract** (`import_file_required` 400,
  `import_file_rejected` 400, `import_file_too_large` 413,
  `import_file_type_unsupported` 415, `extraction_unavailable` 503,
  `import_not_found`/`import_item_not_found` 404, `values_invalid` 422). The
  router sends `file` as an optional multipart part so a missing file yields the
  contract's 400 instead of FastAPI's own 422 body.

Rejected alternatives:

- **Keep the uploaded file** so a certificate could be re-downloaded. Out of
  scope and a privacy liability; B6 owns document storage with retention rules.
- **Write the workspace item from Python, then mark the review item confirmed.**
  Two round trips that can half-succeed. The RPC keeps it atomic, and the RPC is
  the only import→workspace path.
- **`pdfplumber`** (also permissive) — adds a dependency for layout we do not use
  yet; `pypdf` gives the text layer directly.
- **A per-field AI/LLM extraction pass.** Deferred by the PRD: the milestone is
  explicitly deterministic, and mock/live AI would put fabrication within reach.

Consequences (accepted limits, all covered by tests):

- Interleaved two-column content can merge entries, since the parser reads one
  text stream. A DOCX table row becomes a single `" | "`-joined line, which the
  parser splits back out on `|` (that case parses well); genuinely column-major
  text does not.
- Unusual heading synonyms are not recognised; unlabelled sections are not
  guessed.
- PDF extraction drops blank lines, so entries are also split on bullet runs and
  on a date line close behind another date line (heuristically; some odd resumes
  will merge or split imperfectly — which is why every item is reviewed by hand).
- The `values`→`workspace_items` mapping exists twice: in
  `values_to_workspace_create` (Python, used by the in-memory repository and the
  workspace tests) and inside `api_import_confirm` (SQL, the production path).
  They must be changed together; a follow-up could drive the RPC from a single
  generated definition.
- `db/migrations/0004_imports.sql` is written but **not applied**: applying it to
  the project is a deliberate manual step.

Numbering note: 026 and 027 are claimed by the environment-hygiene and UI/QA
sweep changes merged from `chore/clean-env` and `fix/ui-qa`, so this one is 028
rather than 026 to avoid duplicate headings.

Addendum (2026-10-19) — migration 0004 was applied to the Supabase dev project.
Read-only verification found both import tables with RLS enabled and four
owner-only policies each; `api_import_create_session` and `api_import_confirm`
are `SECURITY INVOKER` with `search_path=public`, executable by `authenticated`
and not by `anon`. The live import-isolation suite passes 4/4. The advisors
report only one auth WARN (leaked-password protection) and unused-index INFOs;
the two import indexes exercised by the suite stop being reported unused after
the run. No 0004-related security or unindexed-foreign-key finding remains.

Addendum (2026-10-19) — the live import-isolation suite. `tests/test_import_integration.py`
proves the parts only a real project can: user A cannot list, read, patch or
confirm user B's sessions/items; a second confirm returns the same workspace item
(no duplicate); and a confirmed item is `attested` unless a certificate link was
attached, in which case it is `verified`. It reuses the `.env.test` gate (never
the runtime `.env`) and probes `import_sessions` read-only with the publishable
key before running: a 404 `PGRST205` means `0004` is not applied, so the suite
skips and prints that exact condition instead of failing on a missing table.
`-rs` is now in pytest's `addopts`, so every skipped opt-in run names its cause
(gate, user A/B credentials, or the migration) even without `-v`.

## ADR-029 — 2026-10-19 — B3 AI gateway: verified providers, failover, structured output

Context: PRD §10.3 needs a provider-agnostic gateway over an OpenAI-compatible
HTTP client, with Groq primary and NVIDIA-hosted secondary. Resumes are personal
data, so data-handling terms matter as much as price, and the terms had to be
**re-verified against the providers' current docs** rather than trusted from
training data. B3 must ship no public AI endpoint, must start without any AI key,
and must never fabricate qualifications, so reliability and grounding controls had
to exist before B4/B5 consume the gateway.

What was verified (docs read **and** live probes on 2026-10-19; re-verify before
launch — the NVIDIA docs listed models the API had already retired):

| | Groq (primary) | NVIDIA API catalog (secondary) |
|---|---|---|
| Docs | `console.groq.com/docs/openai`, `/docs/models`, `/docs/rate-limits`, `/docs/structured-outputs`, `/docs/your-data` | `docs.api.nvidia.com/nim/reference/llm-apis`, `.../openai-gpt-oss-120b-infer`, `docs.nvidia.com/nim/large-language-models/*/structured-generation.html` |
| Base URL | `https://api.groq.com/openai/v1` | `https://integrate.api.nvidia.com/v1` |
| Endpoint | `POST /chat/completions` (OpenAI-compatible) | `POST /chat/completions` (OpenAI-compatible) |
| Model IDs used | `openai/gpt-oss-120b` (default; also `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`) | `openai/gpt-oss-20b` (default). Probed 2026-10-19: `meta/llama-3.3-70b-instruct`, `openai/gpt-oss-120b`, `nvidia/llama-3.3-nemotron-super-49b-v1.5` and `qwen/qwen3-next-80b-a3b-instruct` all returned **HTTP 410** (end-of-life) even though the docs page still listed them; `nvidia/nemotron-3-super-120b-a12b` works but was slower and invented requirements in the bake-off |
| Structured output | `response_format={"type":"json_schema","json_schema":{"strict":true}}` on gpt-oss and qwen models; strict needs all fields required + `additionalProperties: false` | `response_format={"type":"json_schema",...,"strict":true}` — verified 200 on `openai/gpt-oss-20b` and `nvidia/nemotron-3-super-120b-a12b`. `nvext.guided_json` is a NIM/self-hosted feature: the hosted endpoint returned **400 "unknown field `guided_json`"** for nemotron-3-super, so B3 does not use it |
| Free-tier limits | per model: gpt-oss-120b **30 RPM / 1,000 RPD / 8K TPM / 200K TPD**; 429 responses carry `Retry-After` | API catalog is a **trial**: ~**40 RPM global hard cap**, no increase for free personal accounts; production requires NVIDIA AI Enterprise |
| Free-tier data terms | no retention by default; reliability/abuse logs may be kept up to 30 days; Zero Data Retention is available in Data Controls; processing in GCP US | NVIDIA **API Trial Terms of Service** §2.3: content is not stored or used after each API session except stated cases; trial-only, not for production |

Decision:

- **One client, per-provider payload.** `app/ai/client.py` posts the same
  OpenAI-compatible request to both providers, including the same
  `response_format` JSON-schema block. A per-provider *profile* carries base URL,
  model and key; **those come from `Settings`** and are overridable in `.env`, so
  a provider/model change is configuration, not a code edit.
- **Keys are optional config.** `REQUIRED_ENV_VARS` still lists only the Supabase
  pair. With no key the gateway raises `AINotConfiguredError` (naming the missing
  variables, never their values) and makes no network call; the app starts and
  serves every other route.
- **Fallback is limited to transient failure**: 429, 5xx and timeouts retry with
  deterministic exponential backoff (`AI_BACKOFF_BASE_SECONDS`, capped at 8 s; no
  jitter, so tests are stable) and then move to the secondary provider. A 429 whose
  `Retry-After` exceeds `AI_RETRY_AFTER_CAP_SECONDS` (**5 s**) falls back
  immediately instead of holding the request. Other 4xx (401/403/400) fail fast:
  the same request would fail on the secondary too, and retrying a rejected schema
  or a bad key hides a configuration error. When every provider fails transiently
  the caller gets `AIUnavailableError` carrying the per-provider errors.
- **Structured output with exactly one repair.** Each task is a Pydantic model;
  the JSON schema is normalised to `additionalProperties: false` on every object
  so strict mode accepts it. A response that is not JSON or does not match the
  schema earns **one** repair attempt on the same provider (schema errors plus the
  invalid, already-redacted output are fed back), then the call fails with
  `AISchemaError` (`ai_invalid_output`). A repair failure is not silently retried a
  third time. Groq's documented `400 / json_validate_failed` best-effort failure
  is special-cased as an invalid *output* (its `failed_generation` becomes the
  assistant turn for the repair); every other 400 stays a hard request error.
  `AI_MAX_OUTPUT_TOKENS` defaults to **2048** because reasoning models spend
  completion tokens before the JSON: at 1024 one bake-off generation was
  truncated, which is exactly the `json_validate_failed`/empty-content path.
- **Cache keyed by the request, scoped to the user.** SHA-256 over task + redacted
  messages + schema + **`user_id`**; in-memory, TTL `AI_CACHE_TTL_SECONDS` (900 s),
  LRU-bounded by `AI_CACHE_MAX_ENTRIES`. Including the user id is deliberate: cached
  values are *restored* to their original PII, so a shared entry could leak one
  person's data to another. A hit makes no call and consumes no quota.
- **Quota behind an interface.** `QuotaStore` + `InMemoryDailyQuota`
  (`AI_DAILY_QUOTA`, per user per UTC day). Consumed only on a cache miss. The
  protocol is the seam for a database-backed `ai_usage` store later; the in-memory
  counter is per process and resets on restart, which is acceptable for B3.
- **Only metrics are logged.** `provider`, `model`, `latency_ms`,
  `prompt_tokens`, `completion_tokens`, `valid`, `task`, `attempt`, `cache_hit`.
  The logging allowlist in `app/core/logging.py` was extended with exactly those
  keys, so a prompt, a response body or a key cannot reach a log line even by
  mistake.
- **Error mapping shipped ahead of the endpoints.** `app/main.py` registers
  handlers for every AI error (`ai_not_configured` 503, `ai_consent_required` 403,
  `ai_quota_exceeded` 429, `ai_invalid_output` 502, `ai_ungrounded` 502,
  `ai_provider_auth_failed` 502, `ai_unavailable` 503) so B4/B5 mount routes that
  already speak the contract's `{"code","message"}` shape.
- **Bake-off before adoption.** `scripts/ai_bakeoff.py` measures JSON validity
  after retries, latency p50/p95 and grounding errors per provider/model on a
  synthetic corpus, and writes `docs/ai-bakeoff.md`. Live runs require
  `RUN_AI_LIVE=1` **and** a key; otherwise the harness writes a "not run" report
  instead of pretending to have numbers.

Rejected alternatives:

- **A provider SDK** (OpenAI/Groq Python clients). Both providers expose the same
  OpenAI-compatible endpoint; one `httpx` client with an injectable
  `MockTransport` keeps every reliability path testable offline, which is the
  milestone's acceptance criterion.
- **Fallback on any error, including 400/401.** Hides misconfiguration and
  doubles the cost of a request that cannot succeed.
- **Jittered backoff.** Makes retry timing untestable for no benefit at this
  volume; the deterministic schedule plus the `Retry-After` cap is enough.
- **Cache key without `user_id`.** Better hit rate, but cached results contain
  restored personal data — a cross-user leak. Rejected on privacy grounds.
- **Hardcoding URLs/model IDs in the gateway.** Would make the ADR's verification
  stale the moment a model is renamed; settings keep one place to change.
- **A retry loop around the repair attempt.** The PRD allows one repair; more
  attempts cost tokens and latency without a bounded promise.
- **`nvext.guided_json` for NVIDIA.** The NIM docs describe it, but the hosted
  API rejected it for `nvidia/nemotron-3-super-120b-a12b` (400, unknown field
  `guided_json`), while the OpenAI-compatible `response_format` worked on every
  hosted model probed. One request shape for both providers is also less code.
- **A live-verified model ID in the docs instead of the documented one.** The
  NVIDIA docs page still listed `meta/llama-3.3-70b-instruct`, but the live API
  returned 410 (EOL 2026-08-26). The ADR records the probe result, and the default
  was changed to a model that answered.

Consequences (accepted limits, all covered by tests):

- The gateway keeps no per-model rate-limit accounting; it reacts to 429s and
  `Retry-After` rather than staying under the published RPM/TPM budgets. Live
  bake-off runs must therefore keep their request count small (free tiers are
  30–40 RPM).
- `nvext.guided_json` is not used; output is still fully validated, so a model
  that ignores the schema degrades to "repair or fail", not to silent acceptance.
- The NVIDIA free trial is **slow** in practice: the 2026-10-19 bake-off (11
  synthetic cases per model, one repeat, 20 s timeout) measured p50/p95 of
  9.4 s/19.6 s for `openai/gpt-oss-20b` (6/11 answered, 0 grounding rejections)
  and 15.3 s/19.3 s for `nvidia/nemotron-3-super-120b-a12b` (10/11 answered, 4
  grounding rejections). Groq answered 11/11 at p50 1.9 s / p95 6.1 s with 1
  grounding rejection. `openai/gpt-oss-20b` stays the default secondary because it
  did not fabricate on the synthetic corpus; the secondary is a degraded fallback
  on the free tier, not a like-for-like alternative, and production should use a
  paid tier or a different secondary.
- The NVIDIA-hosted catalog drifts: four model IDs still documented on 2026-10-19
  returned HTTP 410. Model IDs are configuration, and the bake-off is the check
  that catches a retirement before a user does.
- Retries (and their backoff sleeps) happen inside one request, so a slow primary
  can add up to its retry budget before the secondary is tried. `AI_TIMEOUT_SECONDS`
  (20 s) plus the retry-after cap bound that.
- Cache and quota are single-process; a multi-worker deployment needs the
  Redis/Postgres-backed stores the interfaces anticipate.
- Grounding is enforced by the deterministic validator, not by the provider; a
  model that cannot produce grounded claims for a task will fail that task at
  `ai_ungrounded` rather than return something usable (see ADR-030).

## ADR-030 — 2026-10-19 — B3 privacy boundary (reversible redaction) and claim validator v1

Context: PRD §11 requires that personal data is stripped before any external AI
call and that a recorded AI-processing consent gates the call; PRD §12 rates LLM
fabrication as critical, and RG-2..RG-4 require every generated claim to be
grounded in supplied evidence. B3 had to make both properties *structural* —
enforced by the gateway and a dependency — rather than prompt requests the model
is asked to honour.

Decision:

- **Redaction is reversible and per request.** `app/ai/privacy.py` replaces, in
  this order, known profile fields (longest first, so "Alex Rivera" wins over
  "Alex"), URLs, e-mails, phone numbers and street addresses with stable
  placeholders (`[[EMAIL_1]]`, `[[FIELD_2]]`, …). The same value always maps to the
  same placeholder inside one call; the mapping lives in memory for that call
  only and is never logged or cached. Placeholders are JSON-safe and survive a
  model copy.
- **The whole rendered prompt is redacted, not just the input field.** User
  prompt and every evidence line pass through the same session, so an e-mail that
  only appears in the evidence text is stripped too.
- **Restore happens before validation.** The provider's JSON is parsed, the
  placeholders are restored, and only then is it validated against the task
  model, so length/pattern checks see the real values, and the caller never sees a
  placeholder. Cached values are therefore stored restored — which is exactly why
  the cache key includes the user id (ADR-029).
- **Consent is a token, not a boolean.** `ConsentGrant` is only minted by
  `app.api.deps.require_ai_consent`, which returns it after `consent_records`
  shows a live `ai_processing` grant (RLS-scoped, caller's JWT). `AIGateway.run`
  *requires* the token, so a code path that skips the dependency cannot call a
  provider. The store fails closed on network error, non-200 or unparseable JSON.
  The bake-off uses `ConsentGrant.for_synthetic_data`, explicitly labelled
  `synthetic_fixture`, because its corpus contains no real person's data.
- **Claim validator v1 is deterministic (no LLM).** `app/ai/claims.py` checks each
  claim against its cited evidence:
  - **numbers/metrics** — currency, `%`, `k`/`m`/`bn` suffixes, thousands
    separators; normalised before comparison;
  - **technologies** — a curated canonical lexicon with aliases, so adjacent
    skills stay distinct: `TypeScript` is not `JavaScript`, `Docker` is not
    `Kubernetes`; `K8s`→`Kubernetes` and `Postgres`→`PostgreSQL` are aliases, not
    substitutions;
  - **organisations** — suffixed names (`Inc`, `LLC`, `Ltd`, `Corp`, `GmbH`,
    `University`, …) plus declared `organizations` on the evidence;
  - **titles** — capitalised title phrases including level modifiers, so
    "Senior Software Engineer" is rejected when the evidence only says "Software
    Engineer"; the reverse (claiming the subset) is allowed;
  - **dates** — `19xx`/`20xx` years and month-year pairs;
  - **evidence integrity** — unknown evidence ids and claims with no known
    citation are rejected.
  Violations carry a code and the offending *token only* (never the claim text,
  which may include restored personal data). The gateway runs the validator on
  every successful generation: `grounding="fail"` (default) raises
  `AIGroundingError` and caches nothing; `grounding="report"` returns the report,
  which is what the bake-off uses to count grounding errors without aborting.
- **No task may add facts.** All four prompts (`parse_job_requirements`,
  `rewrite_bullet`, `explain_gap`, `extract_resume_fields`) share the
  `NO_NEW_FACTS` rule from `app/ai/prompts/base.py` and receive only supplied
  evidence items, rendered with their ids. Every result model is a
  `GroundedResult`: a list of claims, each with at least one evidence id.
  `extract_resume_fields` refines the deterministic parser's text only — B2
  discards the original document, so there is nothing else to read.

Rejected alternatives:

- **Irreversible redaction** (drop the PII). Simple, but then the generated bullet
  can never mention the person's own name or contact line, which
  `extract_resume_fields` needs. Placeholders keep the information in the user's
  own request.
- **A blocklist of "sensitive" words in the prompt** instead of redaction.
  Cosmetic: the data still leaves the process.
- **Checking consent with a boolean flag on the gateway.** Easy to flip anywhere
  in the codebase; a token that only the dependency can mint keeps the check at
  the boundary.
- **An LLM-based grounding judge.** Non-deterministic, costs tokens, and cannot be
  the thing that decides whether a metric was invented. Deterministic v1 first.
- **Rejecting on any capitalised run.** Too many false positives (sentence starts,
  product names). Titles are matched against a title-word list and organisations
  against suffixes/declared fields.
- **Auto-repairing ungrounded output.** Grounding failures are deterministic
  evidence gaps; asking the model again invites it to "fix" the claim by
  re-wording it into a different invention.

Consequences (accepted limits, all covered by tests):

- The lexicon is finite: a supported technology written as an unknown synonym
  ("Postgres" is handled, "psql" is not) can be flagged. Fail-closed is the
  intended direction — extend the lexicon or the evidence rather than publish an
  invented qualification — but it will cost some false positives in the bake-off.
- Organisations without a recognised suffix and not declared on the evidence
  ("I worked at Initech") are not detected; declaring `organizations` on the
  evidence is the reliable path.
- Numbers are compared as tokens: "twelve thousand" in a claim versus `12,000` in
  the evidence is a violation, and a claim that merely *repeats* a supported number
  in the wrong context still passes. Context and negation are not modelled.
- Redaction covers e-mail, phone, URL, street address and known profile fields.
  Free-text PII (an unusual name form, a street address without a suffix, a
  non-`example`-style domain) can survive; a NER pass or a stricter field list is
  future work, and the consent gate plus the metrics-only logging limit the
  blast radius meanwhile.
- B3 exposes no public AI route, so consent, quota and grounding are exercised by
  tests (mocked transports) and the bake-off, not by a user-facing endpoint.

## ADR-031 — 2026-10-19 — B4 analysis API: consent-gated runs, in-process execution, no new tables

Context: B4 turns on the targets/analysis surface (`docs/api/contract-proposals.md`
§3–§5). Three tensions had to be resolved: the contract returns `403
consent_required` from `POST /targets/{id}/analysis` while the brief also says a
no-consent deterministic report must still work; runs must show six stages of
progress across polls; and the free single-instance host cannot run a queue or a
second worker.

Decision:

- **Consent gates the endpoint, not the engine.** `require_analysis_consent`
  (distinct from `require_ai_consent`, which keeps the `ai_consent_required`
  code) returns a `ConsentGrant` after `consent_records` shows a live
  `ai_processing` grant and otherwise raises the contract's `consent_required`
  403. The endpoint is where optional AI enrichment can run, so the contract
  requires the grant there. The deterministic engine, every parity/unit test and
  the enrichment fallback path never touch the grant — a missing key or a
  revoked grant still yields a complete, deterministic report wherever the
  engine is called (which is the real meaning of "works without AI/consent").
- **Runs execute as a FastAPI `BackgroundTask`, in process, after the response.**
  `start_analysis` persists the run as `running`, schedules `execute_run`, and
  returns the initial run (the contract's POST response). `execute_run` walks the
  six stages, persisting `stage`/`stageIndex`/`progress` before each phase, so a
  poll sees real progress; `analysis_stage_delay_seconds` (default `0.0`) is the
  only artificial pause and exists for local demos. Accepted limits, documented
  in the service docstring: no multi-worker deployment (another worker cannot see
  the task), a restart loses an in-flight run (it stays `running`), and the AI
  cache/quota are per-process. A durable queue is the upgrade path when the host
  changes; nothing in the report depends on the task's lifetime once saved.
- **Wire statuses are `running|succeeded|failed`.** The frontend Zod schema does
  not know `queued`; the DB's initial state is mapped on read (`_as_run_status`).
  Progress is derived from the same per-stage durations as the F4 theatre
  (900/900/800/1000/600/900 ms → 18/35/51/71/82/100 %).
- **No new tables.** `targets` carries the latest `TargetAnalysisSummary`
  (`analysis` jsonb); `jd_requirements` mirrors the classified requirements for
  the latest report (best-effort, delete-then-insert); `analysis_reports` stores
  the whole wire report in a new `report` jsonb column (insert-only by RLS, so
  each run appends and the newest wins); `jobs` carries one run per row with its
  staged progress in `payload["run"]` plus queryable columns. Migration
  `0005_analysis.sql` adds the columns, aligns the `targets` enums to the wire
  (`one_page`/`two_page`, `precision`/`classic`/`compact`, `failed`) and mirrors
  the table grants. It is **written but not applied**; until it is, only the live
  Supabase routes are affected (they fail closed), and the in-memory repositories
  used by every test are unaffected. The existing `auth.uid() = user_id` RLS
  policies already give per-user isolation, so none are added.
- **Repository failures become typed contract errors.** `TargetNotFoundError`,
  `AnalysisRunNotFoundError`, `ReportNotReadyError` and
  `AnalysisAlreadyRunningError` map to `404 target_not_found`,
  `404 analysis_run_not_found`, `404 report_not_ready` and `409
  analysis_already_running`; a bad `POST /targets` body maps to `422
  target_invalid`. Other users' rows are indistinguishable from missing ones
  (both `404`), so probing reveals nothing.
- **Privacy.** No job description or resume text is logged. The run failure
  records a code-safe message and the stage only (`error` is the exception
  *class name*), and the AI error path logs `{step, code}` only.

Rejected alternatives:

- **A Celery/RQ/arq queue.** Needs a broker the free host does not provide; the
  contract only needs one process to report progress.
- **Blocking the POST until the run finishes.** The contract returns a `running`
  run and the UI polls; a blocking POST would also break the consent/409 shape.
- **Putting stage progress in a separate `analysis_runs` table.** `jobs` already
  exists, is RLS-scoped and is the natural place for a durable unit of work.
- **Deriving `target.analysis` on every read from `analysis_reports`.** An N+1 (or
  a wide join) for the list endpoint; storing the summary is a single column and
  the staleness flag is recomputed from the workspace version on read anyway.
- **Making the API require no consent and treating consent as AI-only.** The
  contract explicitly returns `consent_required` from the analysis endpoint; the
  engine-only reading is captured by keeping the engine free of any consent
  dependency.

Consequences: a single-process deployment is assumed and stated; a process
restart during a run leaves it `running` (the UI already renders a stale
`running` run and can restart); and applying `0005` is a prerequisite for the
live routes, surfaced by the opt-in integration tests' skip reason.

## ADR-032 — 2026-10-19 — B4 engine port: golden parity, JS numeric semantics, and a conservative AI refinement

Context: the analysis engine was already implemented and tested in the frontend
(`frontend/src/lib/analysis/`, ADR-021). B4 must serve identical output from
Python without forking the behaviour, prove it, and add optional AI enrichment
that can never fabricate coverage or move the score.

Decision:

- **Port the engine, do not re-derive it.** `app/analysis/` mirrors the TS
  modules one-for-one (`taxonomy`, `requirements`, `matching`, `scoring`, `ats`,
  `report`, `weights`). Classification keeps the product rules: adjacent skills
  are *related, never equivalent*; a concrete form answers the general skill
  (PostgreSQL is SQL) but never the reverse; only verified/user-attested evidence
  can support a claim, related/missing evidence is a gap; unsupported splits into
  `not_evidenced` vs `genuinely_missing`.
- **Parity is proven against golden vectors, not asserted.** A temporary
  frontend test exported the TS engine's output for 18 cases (strong/partial/poor
  fixtures plus edge cases: empty workspace, only-related evidence, seniority,
  no requirements, all-preferred, undated experience, over-length fields) to
  `backend/tests/golden/analysis_vectors.json`; `tests/test_analysis_parity.py`
  re-runs the Python engine on the same inputs and diffs every field. The TS
  fixture scores are 91/60/39 (ATS 100/93/88). The temp exporter was deleted so
  `/frontend` stays untouched.
- **Comparisons strip `None` recursively.** The TS engine omits absent optional
  fields (`pattern` on skill requirements) while Pydantic emits explicit `null`;
  `strip_none()` makes absence and null equivalent, and every other value is
  compared exactly. Without this the diff would be noise, not signal.
- **JS numeric semantics are explicit.** `app/analysis/numeric.py` provides
  `js_round = floor(x + 0.5)` (not banker's rounding) and `round_fixed` for the
  factor weights' `toFixed(4)`. Name sorting approximates `localeCompare` with a
  lowercase key; the golden vectors pin the order so the approximation is
  verified, not assumed.
- **AI is optional enrichment, never a scorer.** `app/analysis/enrichment.py`
  wraps the B3 gateway:
  - **refinement** may only add a *taxonomy-known skill the posting literally
    mentions* (via `mentions_skill` on the JD), as a normal `RequirementDraft`,
    so matching and scoring are unchanged; it cannot invent a requirement, and
    any claim whose skill the posting omits is dropped. Because the deterministic
    extractor already scans every line for the whole taxonomy, refinement is in
    practice a grounded safety net rather than a source of new requirements.
  - **gap explanations** may replace the prose of at most three unsupported
    requirements; status, evidence links, gap type and the score are untouched.
  - Both call `AIGateway.run`, so output is grounded and passes the claim
    validator (ADR-030); any `AIError` falls back silently to the deterministic
    text. Refinement is cached per SHA-256 of the JD and explanations per JD hash
    + requirement, so identical inputs stay deterministic even with AI on.
  - The report carries `aiUsed: bool` (additive, safe per contract §1.9) and the
    deterministic baseline is bit-identical with AI off or on.
- **The engine stays pure.** `assemble_report` takes already-classified
  requirements, so the service can enrich without touching safety; `build_analysis_report`
  remains the extract → match → assemble shortcut the parity tests call.

Rejected alternatives:

- **Calling the model to score or classify.** Non-deterministic and exactly what
  the brief forbids ("no AI for scoring"); the score must be reproducible from
  the same inputs.
- **Letting AI add free-text requirements.** The engine matches unknown skills by
  substring, so an AI-supplied phrase could silently match unrelated evidence
  ("Agile" inside "fragile"). Restricting to taxonomy keys keeps matching sound.
- **Comparing golden output without the `None`/absent normalisation.** Would fail
  on every skill requirement for a cosmetic modelling difference.
- **Hand-rolling `Math.round` semantics with Python's `round`.** Banker's
  rounding differs on `.5` and would drift the score on borderline factors.

Consequences: the port and the TS engine cannot drift without a red parity test;
the engine is deterministic and AI-free by construction; and the AI path's only
observable effect on a report is `aiUsed` plus up to three rewritten gap
sentences (verified by `tests/test_analysis_enrichment.py`, including that the
score and classifications are identical with AI on and off).


## ADR-033 - 2026-10-20 - Live mode (I1): transport switch, wire fixes, mock-only surfaces

Context: F0-F7 ran against MSW, B1-B4 exposed a real FastAPI API, and the two
contracts had never been connected in the browser. I1 adds `NEXT_PUBLIC_API_MODE`
with `mock` as the default and `live` as an opt-in, so every existing test and
demo stays untouched.

Decisions:

1. **One client, two transports.** `src/lib/api/client.ts` keeps the same `api`
   object screens already call. It chooses `"/api/v1"` (MSW) or
   `"{NEXT_PUBLIC_API_BASE_URL}/api/v1"` (FastAPI) per call and validates every
   success body with the existing Zod schema. A schema failure is a typed
   `ApiError` (`invalid_response`, 502), never a half-rendered screen.
2. **Auth behind the existing interface.** `createAuthClient()` returns the mock
   adapter by default and a Supabase adapter in live mode. The adapter implements
   sign up, sign in, sign out, password reset and session refresh (refresh when
   the token is within 60 s of expiry) and maps Supabase errors onto `AuthError`.
   Only the publishable key is read; `@supabase/supabase-js` is imported
   dynamically so the marketing bundle and mock mode never contain it. A new
   `AuthError` code, `email_confirmation_required`, covers projects that require
   email confirmation before a session exists.
3. **Errors keep the backend envelope.** `ApiError` now carries `detail.code`
   alongside `status` and the server's `detail.message`. Known codes without a
   message (for example `consent_required`, `rate_limited`,
   `import_file_too_large`) fall back to the copy in `CODE_FALLBACKS`; the
   screens' existing error states render the result unchanged.
4. **Wire differences fixed on the frontend:**
   - `ResumeResponse.targetId` is `string | null`; `ResumeSchema` accepted only
     `string | undefined`, so the live standard resume failed validation. It is
     now `.nullish()` (ADR-017 already documented the wire as the contract).
   - The mock confirmed an import card with `POST /workspace/items` per item plus
     `PATCH /imports/{id}/items/{id}`; the backend has an atomic
     `POST /imports/{id}/items/{id}/confirm` returning `{item, review}`. Live
     now uses that route; the mock path is preserved inside the same
     `api.confirmImportItem` method, and a new Zod
     `ImportConfirmResponseSchema` validates the body.
   - The run status enum (`running|succeeded|failed`) and the analysis report
     shapes already matched (ADR-031); no change. Additive `aiUsed` is stripped
     by the schema today and is not displayed.
5. **Skills cards remain a known contract gap.** The backend confirm maps one
   review item to one workspace item and requires a title; a frontend skills
   card is one card holding N chips with no title. In live mode that card creates
   one `skill` item per chip through `POST /workspace/items`, then marks the card
   confirmed with `PATCH /imports/{id}/items/{id}`. This is the only place the
   live client does not use the atomic route; a future backend change (one
   confirm -> many items, or a skills-specific route) should replace it.
6. **Consent has no backend route yet.** The backend enforces consent by reading
   `consent_records`, but the OpenAPI has no consent endpoint. In live mode the
   browser writes/reads that table through the Supabase Data API with the user's
   own JWT; RLS policies (`consent_records_owner_*`) restrict every row to that
   user. Granting inserts a `granted=true` row; revoking stamps `revoked_at` on
   every open grant before recording the denial, so the backend cannot still see
   an older grant.
7. **Honest gaps stay visible.** `GET /targets/{id}/resume`, `GET /resumes`,
   `/privacy/export` and `DELETE /privacy/account` are not in the live backend.
   Their client methods reject with `not_available_in_live_mode` (501) instead of
   calling a non-existent endpoint or pretending success.
8. **Mock-only UI is hidden, not merely disabled.** In live mode the workspace
   dev bar, simulated-failure banner, "Load sample targets" button, import
   "Sample" tags, simulated-demo banner and its copy, and the OAuth buttons (not
   configured live) are not rendered. The import copy instead says the server
   read the document. `startMocks()` and `QueryProvider` also refuse to start
   MSW in live mode.
9. **Privacy.** No request/response body, token or file content is logged. The
   token provider returns the Supabase access token to the API client only; the
   file is sent once, as multipart, to `POST /imports`. Supabase session
   persistence is its own storage, not ours.

Rejected alternatives:

- **A second `liveApi` object.** Every screen/hook would need to branch and the
  two shapes could drift. One validated client keeps a single contract.
- **Static `import "@supabase/supabase-js"` at module scope.** It would ship
  Supabase into chunks the landing page can load, and the budget/no-leak checks
  exist for that reason.
- **Bypassing the confirm route for every card** because skills are awkward.
  Normal cards get the backend's transactional path; only skills need the
  documented fallback.
- **Deleting consent rows instead of revoking them.** The backend checks
  `revoked_at is null`; an audit trail of grants and revocations is also more
  honest than erasure.

Consequences: `NEXT_PUBLIC_API_MODE` is build-time (Next inlines
`NEXT_PUBLIC_*`); changing it requires a restart/rebuild. Live E2E is opt-in and
skipped by default. The skills-card and consent gaps are recorded here so a
later backend milestone can close them without rediscovering them.

## ADR-034 - 2026-10-20 - Migration 0006: repair the targets.length default and index jobs.target_id

Context: while verifying B4 (`0005_analysis.sql`) against the live project, two
schema follow-ups surfaced. `0005` changed `targets.length` to the wire values
`one_page`/`two_page` and replaced the check constraint, but left the column
default at the old `one-page`, which the new constraint rejects. Any insert that
omitted `length` failed with `23514` instead of taking a default. Separately,
`jobs.target_id` is a foreign key added in `0005`, but the only index containing
it is `jobs_target_created_idx (user_id, kind, target_id, created_at DESC)`.
Because `target_id` is not the leading column, a target-only lookup cannot use
it, and the Supabase performance advisor reports an unindexed foreign key.

Decision: add `backend/db/migrations/0006_fixes.sql`, authored but **not applied
by this change**. It runs after 0005 and contains exactly two idempotent
statements:

- `ALTER TABLE public.targets ALTER COLUMN length SET DEFAULT 'one_page'`.
- `CREATE INDEX IF NOT EXISTS jobs_target_idx ON public.jobs (target_id)`.

`backend/tests/test_migrations.py` reads the migration text, collapses
whitespace and asserts both statements with regular expressions; it also rejects
the old `'one-page'` default. The test needs no database, so it runs in the
normal suite.

Rejected alternatives:

- **Editing 0005 in place.** Migrations are forward-only; 0005 may already be
  applied. A new file is the only replayable fix.
- **Extending the composite index to `(target_id, ...)`.** Replacing it would
  harm the existing user/kind/created queries. A small target-only index is
  cheaper and leaves the composite path untouched.
- **Applying the migration from this repository.** The project is shared state;
  the SQL editor/CLI step stays explicit. Until it is applied, the existing
  behavior is unchanged and the database still rejects a defaulted insert.

Consequences: after 0006 is applied, inserts that omit `length` get the wire
default, target-only lookups can use `jobs_target_idx`, and the performance
advisor's unindexed-FK finding should clear. Nothing changes in application code
or in mock mode. The migration still has to be applied manually, then verified
with the advisor and the opt-in integration tests.

## ADR-035 - 2026-10-20 - Supabase latency from this Windows machine: not reproducible, not server-side

Context: live B4 verification earlier reported roughly 30 s per request from this
Windows machine to the Supabase project. I probed DNS, TCP/TLS, curl, the
Windows network configuration and Python `httpx` (configured like the backend:
`timeout=10`, no HTTP/2, default `trust_env=True`, default limits, a new
`AsyncClient` per request). No keys, tokens, `.env` contents or personal data
were read or printed; unauthenticated `HEAD`/`GET` requests return `401` and are
enough for timing.

Measurements on 2026-10-20 (three runs unless noted):

| Probe | Result |
| --- | --- |
| DNS A / AAAA | 4-21 ms; A = two Cloudflare addresses; AAAA = `64:ff9b::/96` DNS64/NAT64 translations of those IPv4 addresses |
| TCP 443, IPv4 | 60-267 ms (first connect 267 ms) |
| TCP 443, IPv6 | 100-168 ms |
| `curl.exe` default | total 0.164-0.566 s, `http=401` |
| `curl.exe -4` | total 0.150-0.237 s |
| `curl.exe -6` | total 0.186 s |
| `Invoke-WebRequest` | first 4.45 s, then 0.03-0.09 s (warm `HttpClient` connection) |
| `httpx` default, new client | 0.179-0.581 s |
| `httpx`, `local_address="0.0.0.0"` | 0.187-0.379 s |
| `httpx`, `trust_env=False` | 0.194-0.278 s |
| `httpx`, one reused client | 0.059-0.166 s |
| 8 alternating new clients | default 0.108-0.228 s; forced IPv4 0.109-0.202 s |

Network configuration: WinHTTP is direct (no proxy), WinINET `ProxyEnable=0`,
no `HTTP(S)_PROXY`/`ALL_PROXY` variables are set, and no VPN adapter is present.
The only physical adapter is Wi-Fi. An IPv6 default route exists and works
(`curl -6` succeeds); the AAAA answers are DNS64-synthesized NAT64 addresses.

Server side: the MCP project tools expose the API URL but no region field. The
database server address is in `2406:da1a::/32`, which is AWS `ap-south-1`
(Mumbai); the edge logs report `HYD` (Hyderabad) as the serving Cloudflare colo.
Over the last 24 hours, edge logs show origin time p50 67 ms, p95 104 ms and max
1.2 s across all REST/Auth paths (`/rest/v1/workspace_items`: p50 67 ms, p95
104 ms, max 727 ms). That includes the period of the earlier slow runs, so the
30 s was not Supabase processing and is not explained by the region. Expected
client total from Hyderabad is roughly 0.15-0.3 s, which is what the probes now
measure.

One cold `httpx` attempt hit the 10 s read timeout before any warm connection;
it was not reproducible in the next 16 new-client requests, all under 0.6 s. The
most plausible explanation is a transient local path problem, for example a
stalled Wi-Fi/NAT64 flow or a machine wake/network switch, not a deterministic
client setting. I did **not** add `SUPABASE_FORCE_IPV4` (or any other latency
setting): forcing IPv4 did not remove a reproducible delay, and default `httpx`
is already sub-second in 16/16 new-client attempts after the one cold failure.
Adding a default-off knob with no measurable effect would be dead configuration.

Re-timed with the local opt-in integration gate enabled: the full backend suite
ran 311 tests in about 88 s (311 passed, 0 skipped, 0 failed, exit 0). The live
integration tests were 4.8-10.1 s each; none showed a 30 s request. The fact
that the earlier 30 s runs and these sub-second runs use the same backend client
settings points away from the client configuration.

Options if the 30 s stalls recur:

1. **Force IPv4** with an `httpx.AsyncHTTPTransport(local_address="0.0.0.0")`
   behind a documented `SUPABASE_FORCE_IPV4` setting (default false). The probe
   shows this path is viable and marginally faster, but there is no current
   delay for it to remove, so it is not in this change.
2. **Bypass DNS64/NAT64** on the machine or router (use an IPv4-only resolver or
   a network that does not synthesize `64:ff9b::/96`), then repeat the probe.
3. **Keep the current timeouts and add one bounded retry** for idempotent reads.
   This hides a transient stall but does not diagnose it; prefer 1 or 2 first.
4. **Capture a failing interval** with the probe commands below, then check
   whether all traffic (including `curl -4`) or only Python is affected. That
   distinguishes a client issue from the Wi-Fi/ISP path.
5. Region change is not indicated: the database is already in `ap-south-1` and
   the edge is `HYD`; server origin time is well under 1.2 s.

Reproduction commands (no credentials): `Resolve-DnsName <project>.supabase.co
-Type A/AAAA`; `curl.exe -sS -o NUL -w "dns=%{time_namelookup} connect=%{time_connect}
tls=%{time_appconnect} total=%{time_total} ip=%{remote_ip}\n" -4|-6
https://<project>.supabase.co/rest/v1/`; and an `httpx.AsyncClient(timeout=10)`
GET of the same URL, once with default transport and once with
`local_address="0.0.0.0"`. `backend/.env` must not be read for this.

## ADR-036 - 2026-10-20 - Analysis poll rate and expired-session handling (S-04, S-05)

Context: the stack audit found the live UI polled an analysis run every 300 ms
while the backend allows 60 requests/minute per IP, and that a failed Supabase
refresh left screens on the raw 401 with no way back to sign-in. The 300 ms
interval came from the 5s mock run; the real backend acquired a per-IP limiter
after that choice was made.

Decision:

- Live analysis polling is **2 s** (`LIVE_ANALYSIS_POLL_MS`); mock keeps 300 ms
  so the demo still shows real, wall-clock progress. 2 s leaves headroom under
  60/minute for two tabs or a shared IP. A 429 carries `Retry-After`, which
  `ApiError.retryAfterMs` preserves and `analysisPollDelay` uses as a floor for
  the next poll (capped at one day by the header parser). The backend limiter is
  unchanged: it protects every endpoint, not just the poll.
- A 401 is treated as session expiry, not a generic API error. The auth provider
  registers one handler with the API client, clears the session, signs out, and
  performs a **full-page navigation** to
  `/signin?reason=expired&next=<current path>`. A full navigation is deliberate:
  a client-side push would leave React Query caches that still belong to the
  expired session. The handler does nothing extra on `/signin`, `/signup` and
  `/forgot-password`, so a 401 cannot loop. The sign-in page renders an
  "expired" alert from the query parameter.
- The live auth client exposes `subscribe`, backed by Supabase
  `onAuthStateChange` (with `INITIAL_SESSION` ignored because the provider reads
  the persisted session itself on mount). The provider follows sign-out and
  refresh events, so a session removed in another tab is reflected here.

Alternatives rejected: polling at 1 s (exactly the 60/minute budget with no room
for other requests), SSE/long-poll (no backend stream), `router.push` (stale
query cache), and clearing every query manually (easy to miss a cache key and
still leaves in-flight requests running).

Consequences: a live analysis updates less often than the mock (acceptable for a
multi-stage run that takes seconds), and expiry causes a reload that drops
unsaved local UI state. The reload is the safer trade: an expired token cannot
save anyway, and the next= parameter returns the user to the page they left.

## ADR-037 - 2026-10-20 - Mobile shell, consent lookups and typed tests (S-06, S-09, S-11, S-14)

Context: the second stack audit found the 360px shell drew a fixed bottom
navigator over the page (the only action on `/resume` and the JD field on
`/targets/new`), the consent gate rendered before its lookup resolved, and the
test suite was outside `mypy` so error paths in tests were unchecked.

Decision:

- The mobile app shell owns the viewport (`h-dvh`, `position: fixed` on small
  screens only). The header and page live in an internal `overflow-y-auto`
  region and the navigator is a normal `shrink-0` sibling below it. A fixed
  navigator was rejected because no amount of page padding stops content from
  passing underneath it mid-scroll; the static row reserves its own space and
  the inner scroller clips content, so a control can never be drawn under it.
  Desktop keeps the document scroll (`md:` resets height, position and
  overflow) so deep links, print and the existing layout are unchanged.
- The consent gate only renders after the consent lookup has **resolved with
  no grant**. Loading shows a status skeleton; a failed lookup shows a
  retryable error. Submitting the target form during the lookup reports
  "still checking" instead of opening the gate, which avoids asking for a
  grant that may already exist. Live auth calls get a 20 s deadline and
  consent calls 15 s (`withTimeout`), reported as network failures so the
  existing retry copy applies.
- Hydration-sensitive client state (the resolved session) is read through
  `useHydrated` (`useSyncExternalStore`), so the first client render matches
  the server skeleton instead of regenerating the tree.
- `tests/` is type-checked with the application (`mypy app tests` in CI).
  Fixing the helpers was preferred over a per-module ignore list because the
  errors were mostly missing annotations on shared doubles, and an ignore list
  would keep new test code unchecked.

Consequences: mobile uses nested scrolling (a normal app-shell pattern) and
`window.scrollY` stays 0 inside the shell, so tests must scroll the app region,
not the window. `NODE_ENV`-only development fixtures are now also gated on
mock mode, so live `next dev` sessions never offer fictional postings.

## ADR-038 - 2026-10-21 - Auth forms never carry credentials in the URL

Context: opening the dev server through a LAN IP made Next block `/_next`
resources, so `/signin` rendered its server HTML but never hydrated. The form
had no method/action and its React submit handler was the only thing preventing
navigation, so pressing "Sign in" performed a native GET and put the email and
password in the address bar, browser history and any URL-based logging.

Decision:

1. `CredentialForm` owns every email/password form (sign in, sign up, forgot
   password). It renders `method="post"`, a non-submitting `action="#"` and
   `noValidate`, calls `preventDefault()` before React Hook Form, and ignores
   submits until hydration. `CredentialSubmitButton` is disabled in the server
   HTML and shows "Preparing a secure form..." only if hydration takes longer
   than 400 ms.
2. `src/proxy.ts` redirects auth-page requests with credential-looking query
   parameters to the same URL without them (plus `notice=credentials`) before
   the route renders. This is required in addition to `history.replaceState`:
   the first RSC payload serialises the request URL, so a client-only cleanup
   would leave the secret inside the document's script tags. `303` is used so a
   no-JavaScript POST fallback becomes a GET instead of being replayed.
3. `CredentialQueryGuard` runs inside `AuthCard` for client-side navigations
   and restored URLs, calls `history.replaceState`, and shows "Never put your
   password in a link. Change it if you typed it into the address bar." It
   never stores the removed values.
4. The scrubber is intentionally broad (password/pass/pwd, token, secret,
   credential, api key, jwt, otp, session, code, email, including hash
   fragments). False positives only drop query parameters; false negatives
   leak. `next`, `reason` and the internal `notice` marker are preserved.

Consequences: social/reset redirects that rely on a token in the URL fragment
must be handled on a non-auth route before reaching these screens, and
credential links no longer prefill anything. No analytics or logging code
records request URLs today; Playwright now asserts that the only request that
can carry the test secret is the user's own navigation and that neither the
console nor the DOM retains it. The README documents opening
`http://localhost:3000` and the opt-in `allowedDevOrigins` setting for
same-network phones.

## ADR-039 - 2026-10-21 - B5 resumes: derive the standard, snapshot the tailored

Context: PRD section 6.8 (RG-1..RG-6) needs tailored resumes, history, diff and
refresh while `resumes`, `resume_versions` and `resume_claims` already exist from
0001.
The standard resume must always reflect the current workspace and must never
keep a deleted item; a tailored resume must not silently change under the user.

Decision:

1. The standard resume is **never persisted**. It is derived from the current,
   non-deleted workspace on every read (the existing B1 derivation) and keeps the
   stable id `resume-standard`. `GET /resume/standard` stays as an alias, and the
   resume list returns the derived standard first. This makes SYN-2 structural:
   there is no row that could retain a deleted item.
2. A tailored resume is a persisted snapshot: `sections` JSON is canonical for
   rendering, and `source_evidence` stores the cited items with a content
   fingerprint (position excluded). `resume_claims` mirrors each visible claim
   with its section, position and `ai_rewritten` flag so the evidence link is
   queryable. Migration `0007_resumes.sql` adds those columns (plus `title`,
   `ai_used`, `ats`, `edited_sections`); it is committed but not applied here.
3. `resume_versions` remains insert-only. Generate/edit/refresh append a version
   with `reason`; restore copies an old snapshot into the current row and appends
   a new `restored` version. Nothing is deleted or updated in history, and the
   snapshot's `workspaceVersion` is preserved so restoring pre-change content is
   reported as stale.
4. Sections JSON and claim rows are written in two PostgREST calls. On the free
   single-instance host this is accepted (the doc notes the trade-off); a later
   `SECURITY INVOKER` function can make the pair atomic without a wire change.

Consequences: listing resumes costs one workspace read for the standard; storing
the evidence snapshot duplicates some workspace text, but that is what makes
diff, removal flags and restore work after the source item is edited/deleted.
The client never receives `source_evidence`.

## ADR-040 - 2026-10-21 - B5 generation, refresh and AI-rewrite rules

Context: tailored generation must be deterministic, visibly different across
job descriptions, never invent facts, and stay useful after the workspace moves.
AI rewording is optional and must not become a second source of truth.

Decision:

1. Selection is deterministic and report-driven: within each section, matched
   required evidence (100) ranks before matched preferred (80), partial required
   (50), partial preferred (30); ties keep workspace order. Personal items are
   always kept; remaining items are appended in workspace order when the match
   is thin, so the resume is never empty. Items are grouped by a fixed tailored
   section order and bullets are ordered by target-term overlap. Budgets are 28
   claims/2 bullets per item for one page and 44/3 for two pages. Only
   reorder/trim: every header and bullet is copied verbatim from the user's item.
2. Generation requires the report's `workspaceVersion` to equal the current
   workspace version (`409 analysis_stale` otherwise). A tailored resume records
   the version it was built from; `stale` is computed on read when the workspace
   moves on, plus a stored flag set by `POST /resumes/{id}/stale`.
3. Edits replace one section and must pass the B3 claim validator against the
   cited active items; rejected claims return `422 resume_claim_ungrounded` and
   write nothing. Edited sections are recorded and refresh skips them with
   `reason: "edited"` unless the request names them in
   `overwriteEditedSections` (which clears the mark). Refresh uses the latest
   report even if stale -- catching up is its purpose -- rebuilds only unedited
   sections, drops deleted items from them, and leaves deleted citations in
   skipped edited sections visible with `removed: true`.
4. AI rewording is per-request, consent-gated and provider-gated. Only bullet
   claims are sent (one `rewrite_bullet` call each) with exactly the cited item as
   evidence. Every candidate is re-validated against that evidence; a failed
   call or ungrounded candidate keeps the original text. Generation never fails
   because the optional layer failed, and `aiUsed` is true only when at least one
   rewritten claim survives.
5. Logs carry ids, section keys, counts and booleans only. Resume, claim,
   workspace and job text are never logged.

Consequences: two different postings with different evidence produce different
item order and bullet order (the tests assert this); a posting with no matches
still yields a workspace-ordered fallback resume. AI output cannot introduce a
metric/title/date/technology because the same validator that protects B3 runs
per claim, and `aiUsed` is evidence of visible output, not of an attempted call.

## ADR-041 - 2026-10-21 - B6 capabilities, resume summaries, deletion and purge

Context: the F5 resume studio needs to know which optional features exist, needs
to see "contains removed information" without fetching every full resume, and
needs explicit delete/purge actions for a historical snapshot that cites a
workspace item the user has since deleted (PRD §6.8 RG-6, PRD §6.9).

Decision:

1. `GET /capabilities` reports booleans only: AI configured (and the two AI-backed
   features), PDF export, data export and account data deletion. No provider
   name, model id, base URL, key or key length is returned. The AI flags mean
   "at least one key is configured", never "the provider is healthy".
2. `ResumeSummary` and `ResumeVersion` expose `removedEvidenceIds`; versions also
   expose `stale`. Both are computed on read against the current workspace (they
   are not stored), so the list and the history screen can warn and offer purge
   without a second request. `GET /resumes/{id}/versions` is contractually
   newest-first (`createdAt` descending).
3. Normal mutations stay append-only. `DELETE /resumes/{id}` removes a tailored
   resume (claims/versions cascade in Postgres). `DELETE …/versions/{id}` removes
   one saved version and leaves the current resume untouched. The standard
   resume is rejected with `409 resume_not_tailored`.
4. `POST …/purge` and `POST …/versions/{id}/purge` remove only claims whose cited
   item no longer exists. Surviving statements are copied verbatim (no rewrite or
   reorder), empty sections and newly unused evidence are dropped,
   `editedSections` keeps survivors, and a `purged` version is appended only when
   the current resume changed. The operation is idempotent and a no-op reports
   zero counts.
5. `resume_versions` keeps its insert-only default; migration 0008 adds one
   owner-scoped DELETE policy for the explicit version delete and a narrow
   `SECURITY DEFINER` `api_resume_version_purge` that changes only `snapshot`
   after checking `auth.uid()` and the resume id. Broad UPDATE on a history table
   is deliberately not granted.

Consequences: the UI can offer accurate, scoped deletion/purge actions, and a
deleted workspace item can never be silently republished by a restore or an
export. The purge response says exactly how many claims and versions changed.

## ADR-042 - 2026-10-21 - B6 PDF export: licence, layout and round-trip check

Context: PRD §6.9 EX-1 requires a server-generated, ATS-safe, text-selectable PDF
with no fabricated content, no storage and no AGPL dependency.

Decision:

1. Rendering uses `reportlab` (BSD-3-Clause); verification uses `pypdf`
   (BSD-3-Clause) to extract the text back. The bundled `DejaVuSans.ttf` font is
   Bitstream Vera / public-domain DejaVu, with its licence file next to it. No
   AGPL component is used, and the PDF is never written to disk or object storage.
2. The layout is deliberately minimal: A4, single column, plain paragraphs,
   conventional section headings (`Contact`, `Experience`, `Projects`,
   `Education`, `Skills`, …), black text, no tables, images, columns, watermark
   or branding. The only body content is `resume.sections[].claims` text.
3. Claims flagged `removed` (their workspace item was deleted) are omitted: the
   export must not republish deleted information. This is the same rule as purge,
   applied at render time.
4. After rendering, the bytes are read back with `pypdf`; every rendered heading
   and claim must be found in the extracted, whitespace-normalised text. The
   counts are returned in `X-Export-*` headers. A failed check returns
   `502 export_verification_failed` and never serves the PDF. Headers carry counts
   only, never claim text.
5. The standard resume (`resume-standard`) and tailored resumes both export
   through the same route; the derived standard is never persisted by this path.

Consequences: an export either round-trips its own text layer or fails loudly.
Adding a decorative element means extending the verification, which keeps the
ATS guarantee honest rather than aspirational.

## ADR-043 - 2026-10-21 - B6 data export and account deletion: no service-role key

Context: PRD §6.9 EX-2 requires a complete data export and account deletion.
Supabase's self-service API has no "delete my auth user" call for a normal access
token. Adding a service-role key to the backend only to finish that step would
put an RLS-bypassing credential in every request process.

Decision:

1. `GET /export` returns `resumeiq.data-export.v1`: one `select=*` query per
   public table that can hold the caller's data, plus the profile row. Keys are
   explicit; adding a user-owned table requires adding it to `EXPORT_TABLES` and
   to contract §9. `userId`/`email` come from the verified token, not from
   `auth.users`. No auth row, token, key or other user's row is included.
2. `DELETE /account` requires the trimmed, case-insensitive phrase
   `delete my account`; anything else is `400 account_confirmation_required` and
   deletes nothing. It calls migration 0008's
   `api_account_delete_data()`: SECURITY DEFINER, no arguments, resolves
   `auth.uid()`, deletes public rows in dependency order (claims → versions →
   resumes; import items → sessions; requirements/reports/jobs → targets;
   evidence → workspace; relations → skills; then versions, change log, consent,
   audit, profile) and returns per-table counts.

   Privileges required, and why: the function must be created by the migration
   role (the schema owner, normally `postgres`/`supabase_admin`) because it is
   `SECURITY DEFINER` and must delete from `resume_versions`, `change_log`,
   `analysis_reports` and `audit_events`, which intentionally have no DELETE
   policy. It needs only DELETE/SELECT on the `public` tables it names -- no
   role membership, no `auth` schema write and no service-role key. EXECUTE is
   revoked from `PUBLIC`/`anon` and granted only to `authenticated`, so the
   definer rights are reachable only through a verified user token, and the
   no-argument signature means the caller cannot choose whose rows are removed.
   Deleting the `auth.users` identity additionally needs the Supabase Admin API
   with a `service_role` key; that key is held by an operator outside this
   service and never enters the repository, the backend process or the frontend.
3. The function cannot touch `auth.users` and takes no user id, so it cannot
   select another account. It exists because four history tables intentionally
   have no DELETE policy; the function is the only path that can remove them.
4. `authUserDeleted` is `false` and `remainingStep: "auth_user"` on every B6
   response. Completing the auth-identity deletion is a documented operator step
   using a privileged admin API outside this service. The process holds no
   service-role key and the frontend receives none.
5. Neither route logs row contents, the confirmation phrase or a token. Failures
   use the standard error envelope.

Consequences: the API never claims a complete account deletion it did not
perform. Data deletion is real, idempotent and isolated, while the remaining
identity step is explicit in the response and in the operator documentation.
