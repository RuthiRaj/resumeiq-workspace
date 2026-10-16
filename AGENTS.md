<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

Project: AI Resume Analyzer Workspace (see docs/PRD.md; it is the source of truth).
Current phase: FRONTEND ONLY. Do not build backend or call real AI APIs until told.

Stack: Next.js App Router + React + TypeScript strict, Tailwind, shadcn/ui, Motion,
React Three Fiber (landing only), TanStack Query, Zod, MSW mocks, Vitest, Playwright.

Hard product rules:
- Never fabricate qualifications, titles, employers, dates, metrics or certificates.
  Mock data must model evidence states (verified, attested, related, missing).
- No billing, pricing, credits or paywall UI.
- Scores are never hiring probabilities or ATS guarantees; always show methodology.

UI rules: dark cinematic theme using tokens in src/styles/tokens.css; honor
prefers-reduced-motion; 3D only on "/", lazy-loaded; every action gives visible
feedback; every screen has loading, empty, error and stale states; no dead buttons;
inputs must not lose focus while typing.

Workflow:
- Work one milestone (F0..F7) at a time. Meet its acceptance criteria before stopping.
- Proceed on your own for routine steps; do not ask me to confirm file edits, installs,
  or test runs. Ask only when a decision changes the PRD.
- Use a feature branch or git worktree per milestone and open a PR. NEVER merge or push to main.
- Run lint, typecheck, tests and build before declaring done; report results honestly.
- No secrets in code or prompts; use .env.local (git-ignored).
- Record non-obvious decisions in docs/DECISIONS.md.
