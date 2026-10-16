# ResumeIQ Workspace — AI Resume Analyzer

Your truth, in every resume. Keep one private Master Workspace of everything you can
truthfully claim, keep a standard resume automatically synchronized, and generate
tailored, evidence-based resumes — with job-match analysis, skill gaps, ATS readability
and an improvement roadmap — for every application. Never fabricated: every claim traces
to workspace evidence.

## Folder map

- `/frontend` — the Next.js App Router app (all UI, mocks, tests, configs).
- `/backend` — placeholder for the later FastAPI app (not started).
- `/docs` — `PRD.md` (source of truth) and `DECISIONS.md` (architecture records).
- `/.github` — CI workflows.
- `/AGENTS.md` — working agreement for coding agents.

## Run the frontend

```sh
cd frontend
npm install
npm run dev
```

Other commands (run inside `/frontend`): `npm run build`, `npm run lint`,
`npm run typecheck`, `npm run test`, `npm run e2e`, `npm run budget`.

## Current phase

FRONTEND first, against typed mock data (milestones F0–F7). No backend work and no
real AI calls until the frontend milestones are accepted by the owner.

The default branch is `master`. Never merge to it without review — work on feature
branches and open PRs.
