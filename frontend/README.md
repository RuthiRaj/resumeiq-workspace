# ResumeIQ Workspace — frontend

Next.js App Router + React + TypeScript (strict) app for the AI Resume Analyzer
Workspace. See `/docs/PRD.md` (repo root) — it is the source of truth — and
`/AGENTS.md` for the working agreement.

## Develop

```sh
npm install
npm run dev        # http://localhost:3000
```

## Verify

```sh
npm run lint
npm run typecheck
npm run test       # Vitest
npm run e2e        # Playwright (installs browsers on first run)
npm run build
npm run budget     # "/" initial-JS gzip budget check (ADR-005)
```

Key routes: `/` (cinematic landing), `/design-system` (tokens + components),
`/workspace`, `/resume`, `/targets`, `/history`, `/privacy`, `/settings`.
