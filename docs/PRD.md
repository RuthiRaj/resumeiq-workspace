# PRD: AI Resume Analyzer Workspace ("ResumeIQ Workspace")

Version 0.2 · 16 Oct 2026 · Pasted into OpenCode as project context (saved as `docs/PRD.md`).

**Build order:** FRONTEND UI/UX FIRST (against typed mock data) → then backend (FastAPI) and API/AI integrations.
**Rule for agents:** do not start backend work until the frontend milestones F0–F7 are accepted by the owner.

---

## 1. Product summary

Users keep one private **Master Workspace** containing everything they can truthfully claim: personal details, education, skills, projects, internships, work experience, achievements, certificates, courses, publications and training.

- A **standard resume** is generated from the workspace and **stays automatically synchronized** whenever information is added, edited, deleted or reorganized.
- For a target job (role, company, job description) the product generates a **tailored resume** plus an **AI report**: job-match score, skill matches, skill gaps, ATS readability and a job-specific improvement roadmap.
- Tailored resumes are saved as **historical versions** for past applications.

**Central principle:** maintain career information once, keep the standard resume synchronized, and generate a tailored, evidence-based resume whenever you apply.

**Non-negotiable rule:** the product NEVER fabricates skills, qualifications, titles, employers, dates, certificates, achievements or numbers. Every generated claim must trace to a workspace item. Unsupported items are shown as *missing* or *needs your confirmation*.

**Free to users:** no subscriptions, billing, credits, paywalls or pricing UI anywhere.

## 2. Decisions and assumptions (defaults; owner may change)

| Topic | Default decision |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript (strict) |
| Backend (later) | Python + FastAPI |
| Database (later) | Supabase (Auth + Postgres with Row Level Security + Storage). Firebase is NOT used. |
| Project type | Personal / portfolio project (so Vercel Hobby is acceptable; move host before any monetisation) |
| Theme | Dark cinematic theme only at launch (light theme later) |
| Language | English resumes only in MVP |
| Export | PDF in MVP; DOCX is a stretch goal |
| 3D | One lazy-loaded 3D/shader hero on the landing page only; calm 2D motion elsewhere |
| Build mode | Vibe coding with OpenCode; coding-assistant model is separate from the app's AI provider |

## 3. Users and success metrics

Primary users: students/freshers and early-career applicants. Secondary: career switchers. Out of scope: recruiters, teams, enterprises.

| Goal | MVP target |
|---|---|
| Factual integrity | 0 unsupported claims on the golden test set; every generated bullet links to evidence |
| Speed | Workspace import to tailored resume in under 3 minutes |
| AI reliability | 95%+ schema-valid AI outputs after retries |
| Usability | 80% of test users finish the full flow unaided |
| UI quality | Lighthouse performance 90+ on core pages; WCAG 2.2 AA |
| Cost | $0 fixed monthly infrastructure at launch scale |

## 4. Core concepts and business rules

1. The workspace is the authoritative source of current career information.
2. Evidence states on every workspace item: **Verified** (document or link attached), **User-attested** (typed by the user), **Related-but-unverified**, **Missing**.
3. Skill taxonomy treats adjacent technologies as *related, not equivalent*: JavaScript ≠ TypeScript, React ≠ Angular, Docker ≠ Kubernetes, ML ≠ DL, C ≠ C++ ≠ C#.
4. Workspace changes invalidate or update affected generated content.
5. The standard resume never retains deleted information after sync completes.
6. Historical versions follow explicit retention rules (see 6.8).
7. Scores (job-match, ATS) must be explainable and based on defined checks. They are never a hiring probability or an ATS guarantee.
8. Each user's data and uploads are private and access-controlled.

### Standard resume vs tailored resume

| | Standard resume | Tailored resume |
|---|---|---|
| Source | Workspace, regenerated on every add, edit, delete or reorder | Workspace snapshot at generation time plus user edits |
| Editing | Template, length, section order and visibility; wording is edited in the workspace so it stays the single source of truth | Fully editable |
| On workspace change | Updates automatically | Marked **Stale** with a diff; refreshed per section on confirmation; edited sections never overwritten without explicit choice |
| Retention | One current copy | Saved history until the user deletes it |

## 5. MVP scope

In scope:
1. Authentication and private account.
2. Personal workspace with structured entry and document uploads; add, edit, delete, reorder.
3. Automatic standard resume generation and synchronization.
4. Upload of resumes, certificates and course documents with extraction and a mandatory review step.
5. Job target input: role, company, job description, optional required skills, template and length preferences.
6. AI-tailored resume generation with claim validation.
7. Job-match score, skill-gap report and job-specific improvement roadmap.
8. ATS readability analysis.
9. Resume preview, editing and PDF export.
10. Resume history (current vs saved versions) and privacy controls (data export, account deletion).

Post-MVP: long-term career-path roadmaps, job discovery and job-portal integrations, interview preparation, bulk auto-refresh, extra templates, multilingual resumes, recruiter features.

Never in scope: payments, credits, paywalls, social features, anything that invents experience.

## 6. Functional requirements

### 6.1 Workspace (WS)
- WS-1 Sections: personal details, education, experience, internships, projects, skills, achievements and awards, extracurricular activities, certificates and courses, publications, training.
- WS-2 Each item has an evidence state (section 4) and optional attachments and links.
- WS-3 Structured fields per item: title, organisation, dates, location, bullets, tags, links.
- WS-4 Workspace has a monotonically increasing version number and an append-only change log.
- WS-5 Delete is a soft delete; the standard resume updates immediately; tailored resumes flag as stale.
- WS-6 Drag-and-drop reordering within and across allowed sections.

### 6.2 Upload and extraction (IM)
- IM-1 PDF/DOCX upload with type and size limits.
- IM-2 Extracted fields appear in a side-by-side review screen; uncertain fields are highlighted for verification; nothing enters the workspace until the user confirms each item.
- IM-3 Imported items are User-attested unless supporting evidence (certificate file or link) is attached, in which case Verified.

### 6.3 Standard resume sync (SYN)
- SYN-1 Add, edit, delete or reorder in the workspace updates the standard resume automatically and visibly (live preview, "Synced" indicator with timestamp).
- SYN-2 Deleted information is excluded from the standard resume and from all future generated resumes.
- SYN-3 The UI clearly separates "Current standard resume" from "Saved application versions".

### 6.4 Job targets and analysis (JD)
- JD-1 Inputs: target role, company, job description (paste), optional required skills, optional template and length.
- JD-2 Extract requirements: must-have skills, nice-to-haves, seniority, responsibilities, keywords.
- JD-3 Matching classifies each requirement as **Matched**, **Partially matched** or **Unsupported**, with links to the evidence used.
- JD-4 Unsupported skills are split into **Not evidenced yet** (may be undocumented, so add it) and **Genuinely missing**.
- JD-5 Scores are reproducible for identical inputs.

### 6.5 Job-match score methodology
Transparent weighted score (proposed starting weights, tuned later on a golden set):
required skills 40%, preferred skills 15%, relevant experience and internships 20%, education 10%, projects and achievements 15%.
The UI shows the factor breakdown and states: "This is not a probability of being hired."

### 6.6 AI report
1. **Compatibility score** with explanation of how it was calculated; matched / partial / unsupported listed separately.
2. **Skills analysis:** documented skills, skills demonstrated by projects or experience, requirements not evidenced, skills to develop.
3. **Resume content report:** what was included, what was excluded and why, which requirements are supported, which need more evidence, which sections to improve.
4. **Improvement roadmap:** prioritised, job-specific actions (learn a technology, build a project, earn a certification, sharpen an achievement). Never generic career advice.

### 6.7 ATS readability (deterministic checks, no LLM)
Checks: standard section headings; readable text and consistent formatting; keyword coverage; clear education and experience; consistent dates and titles; problematic layouts (multi-column, heavy graphics, complex tables); text-extraction round trip on the exported PDF (and DOCX if supported); missing or incomplete information.
Output: ATS-readability score, keyword coverage, formatting issues, missing or unclear sections, suggested fixes, before-and-after examples where useful.
Disclaimer shown: "Based on defined checks. Not a guarantee for any employer's ATS."

### 6.8 Resume generation and history (RG)
- RG-1 Pipeline: JD analysis → retrieve relevant workspace evidence → compare → select and prioritise → generate → claim validation → ATS check → editable draft → save version.
- RG-2 Generator may only use workspace items. No new employers, titles, dates, numbers, certificates or technologies.
- RG-3 Claim validator compares each generated statement with cited evidence; unsupported statements are removed or flagged "needs your confirmation".
- RG-4 Rewording (verbs, concision, ordering) is allowed; adding facts is not.
- RG-5 Different job descriptions must yield different, relevant resumes.
- RG-6 History: saved tailored versions are snapshots. Deleting a workspace item does not silently rewrite them; the history screen shows "contains removed information" with one-click purge. Account deletion removes everything. (Proposed defaults.)

### 6.9 Export and privacy (EX)
- EX-1 PDF export: selectable text, single column, ATS-safe, no watermark.
- EX-2 Full data export (JSON) and permanent account deletion.
- EX-3 Disclose which AI provider processes content; capture consent before the first AI call.

## 7. FRONTEND UI/UX SPECIFICATION (build first)

### 7.1 Design direction: "cinematic, professional"
Think film-title-sequence polish inside a serious productivity tool: a deep near-black canvas, soft volumetric light, glass panels, razor-sharp typography, and slow, deliberate motion. Trustworthy first, spectacular second. Motion explains state (analysis progress, sync, staleness); it never blocks the user.

### 7.2 Design tokens
| Token | Value |
|---|---|
| bg | #07080C |
| surface | #0F1117 |
| elevated | #161924 |
| border | rgba(255,255,255,0.08) |
| text | #E8EAF0 |
| muted | #8A90A2 |
| accent-violet | #7C5CFF |
| action (filled-button violet, see note) | #5F48D8 |
| accent-cyan | #22D3EE |
| evidence-verified | #34D399 |
| evidence-attested | #60A5FA |
| evidence-related | #FBBF24 |
| evidence-missing | #FB7185 |

Fonts: Geist Sans (UI), Geist Mono (scores, data), Instrument Serif (hero and display headlines). Radius 12–20px. Glass: `backdrop-blur-xl` + 6% white fill + 1px hairline border. Glow: violet/cyan radial gradients at 10–20% opacity behind key content. Subtle film-grain overlay (static noise PNG/SVG, 3–4% opacity).

Note (ADR-004): white text on `accent-violet` measures 4.35:1 and fails WCAG AA, so filled buttons use the derived `action` token (#5F48D8, 6.2:1). The `accent-violet` token itself is unchanged for glows, gradients and scores.

### 7.3 Motion principles
- Library: Motion (`motion/react`). Smooth scroll: Lenis on marketing pages only.
- Durations 200–400ms for UI, 600–1200ms for hero and report reveals; ease-out curves; stagger lists 40–60ms.
- Always honor `prefers-reduced-motion` (fade only, no parallax, no 3D animation, static hero image).
- Never animate layout-heavy elements on scroll in the app shell. Target 60fps on a mid-range laptop.

### 7.4 Signature moments
1. **Landing hero:** lazy-loaded React Three Fiber scene (floating translucent "document" planes drifting in a violet/cyan volumetric haze, slow parallax to pointer). Fallback: static gradient image when reduced-motion, low-power, or no WebGL. Headline in serif: "Your truth, in every resume."
2. **Scroll narrative** (landing): Workspace → Evidence → Match → Tailored resume → ATS → Export, each as a pinned scene with a mock UI card animating in.
3. **Workspace as a living map:** section cards with evidence-state glows, drag reorder, live "Synced" pulse when the standard resume updates.
4. **Analysis theatre:** after submitting a job target, a staged progress sequence (Reading the job → Extracting requirements → Searching your workspace → Matching evidence → Scoring → Writing report). Each stage has a micro-animation; the result reveals with an animated score ring and a skill-match constellation.
5. **Resume Studio:** split view, editable resume canvas on the left, live ATS meter and evidence chips on the right; a diff drawer for stale sections.
6. **Evidence chips:** every claim in a tailored resume has a coloured chip; clicking opens the source workspace item in a side sheet.
7. **Warm-up screen:** branded loading sequence for slow first backend responses (free hosting can take about a minute to wake).

### 7.5 Pages and key contents
| Route | Purpose and contents |
|---|---|
| `/` | Cinematic landing: hero, scroll narrative, trust section ("never fabricates"), free-forever note, FAQ, footer |
| `/signin`, `/signup` | Glass auth card, password + OAuth buttons (mocked), validation states |
| `/onboarding` | Choose: import documents or start manually; extraction review lives at `/workspace/import` |
| `/workspace` | Dashboard: completeness ring, section cards, recent changes, "Synced" status, quick actions |
| `/workspace/[section]` | Section list and editor (sheet or page), evidence state selector, attachments, drag reorder |
| `/workspace/import` | Side-by-side: source document vs extracted fields, uncertain fields flagged, confirm per item |
| `/resume` | Standard resume: live preview, template, length, section order and visibility, sync indicator, PDF export |
| `/targets` | List of job targets with status, score and linked versions |
| `/targets/new` | Role, company, job description, optional skills, template and length preferences |
| `/targets/[id]` | Analysis theatre then AI report: score ring and factor breakdown, matched/partial/unsupported, gaps (not evidenced vs missing), content report, improvement roadmap, ATS panel |
| `/targets/[id]/resume` | Resume Studio for the tailored resume with evidence chips, stale badge and diff drawer |
| `/history` | Current standard resume vs saved application versions, restore, purge, "contains removed information" warnings |
| `/privacy` | AI-processing consent and provider disclosure, data export, delete account |
| `/settings` | Profile, preferences, security |

### 7.6 Component inventory (build once, reuse)
AppShell (sidebar + topbar + command palette), GlassCard, SectionCard, EvidenceBadge, EvidenceChip, ScoreRing, FactorBar, SkillConstellation, StageProgress, ResumeCanvas, ResumePreview, DiffDrawer, StaleBadge, SyncIndicator, UploadDropzone, ReviewTable, EmptyState, ErrorState, Skeletons, Toast, ConfirmDialog, Stepper, TemplatePicker.

### 7.7 UX quality gates (apply to every milestone)
- Every action gives visible feedback (toast, inline state, progress). No silent failures, no dead buttons.
- Every screen has designed loading, empty, error and stale states.
- Forms keep focus while typing (no re-mount bugs); validate with Zod; autosave indicators on editors.
- Keyboard navigable, visible focus rings, AA contrast, ARIA labels on charts, rings and chips.
- Responsive from 360px to ultrawide; mobile uses bottom sheet patterns.
- Performance: LCP < 2.5s, CLS < 0.1; the 3D scene is code-split and loaded only on `/`; app pages ship no 3D.
- Print/PDF preview is clean: no app chrome, no watermark, structured sections.

## 8. FRONTEND TECHNICAL SPECIFICATION

### 8.1 Stack (all free/open-source)
Next.js App Router, React, TypeScript strict, Tailwind CSS, shadcn/ui (Radix), Motion, React Three Fiber + drei (landing only), Lenis (landing only), TanStack Query, React Hook Form + Zod, Zustand (UI state only), dnd-kit (reorder), Lucide icons, MSW (mock API), Vitest + Testing Library, Playwright (E2E), ESLint + Prettier. Use the latest stable versions at install time and commit the lockfile.

### 8.2 Folder structure (monorepo: frontend code lives in `/frontend`)
```
frontend/              # ALL Next.js code and config
  src/
    app/               # routes (App Router)
      (marketing)/     # landing
      (app)/           # authenticated app shell
    components/
      ui/              # shadcn primitives
      domain/          # EvidenceBadge, ScoreRing, ResumeCanvas, ...
      three/           # R3F scenes (landing only, lazy)
    features/
      workspace/ resume/ targets/ history/ privacy/
    lib/
      api/             # typed client (swap mock -> real later)
      schemas/         # Zod schemas = source of truth for types
      utils/
    mocks/             # MSW handlers + fixtures
    styles/            # tokens.css, globals.css
  public/ tests/ scripts/  # static assets, Playwright specs, budget check
  package.json README.md   # run all npm scripts from /frontend
backend/               # FastAPI placeholder (see section 10)
docs/                  # PRD.md, DECISIONS.md
AGENTS.md
```

### 8.3 Contract-first data layer
All API access goes through `lib/api`. Define Zod schemas first, infer TS types, and have MSW implement the same endpoints the real FastAPI backend will expose later (so no UI rewrite). Core types:

```ts
type EvidenceState = "verified" | "attested" | "related" | "missing";

type WorkspaceItem = {
  id: string;
  section: "personal" | "education" | "experience" | "internship" | "project" |
           "skill" | "achievement" | "extracurricular" | "certificate" |
           "course" | "publication" | "training";
  title: string; organization?: string;
  startDate?: string; endDate?: string; location?: string;
  bullets: string[]; tags: string[]; links: string[];
  attachments: { id: string; name: string; url: string }[];
  evidence: EvidenceState; order: number; deletedAt?: string;
};

type Requirement = {
  id: string; text: string; kind: "required" | "preferred";
  status: "matched" | "partial" | "unsupported";
  gapType?: "not_evidenced" | "genuinely_missing";
  evidenceIds: string[];
};

type AnalysisReport = {
  score: number;                       // 0-100, never a hiring probability
  factors: { name: string; weight: number; value: number }[];
  requirements: Requirement[];
  included: { itemId: string; reason: string }[];
  excluded: { itemId: string; reason: string }[];
  roadmap: { priority: number; action: string; reason: string }[];
  ats: { score: number; keywordCoverage: number;
         issues: { id: string; severity: "low"|"med"|"high"; message: string; fix: string }[] };
};

type Resume = {
  id: string; kind: "standard" | "tailored"; targetId?: string;
  workspaceVersion: number; stale: boolean;
  sections: { key: string; claims: { text: string; evidenceIds: string[]; confirmed: boolean }[] }[];
  createdAt: string; updatedAt: string;
};
```

### 8.4 Mock behaviours to simulate
Sync (editing a workspace item updates the standard resume within 500ms), staleness (tailored resumes flip to Stale when workspace version advances), slow AI (3–8s staged analysis), AI failure (error state with retry), cold start (warm-up screen after 10s), upload extraction with uncertain fields.

### 8.5 Fixtures
Provide 2 sample workspaces (a fresher with thin experience; a mid-level developer) and 3 sample job descriptions (strong match, partial match, poor match) so every report state can be demonstrated.

## 9. FRONTEND MILESTONES (acceptance criteria)

| ID | Deliverable | Accepted when |
|---|---|---|
| F0 | Repo scaffold, tokens, theme, fonts, shadcn setup, AppShell skeleton, `AGENTS.md`, CI (lint, typecheck, build, test) | `npm run dev/build/lint/typecheck/test` (run inside `/frontend`) all pass; token page renders every token and component |
| F1 | Cinematic landing page: R3F hero with fallback, scroll narrative, trust section, FAQ | Lighthouse perf 90+ (desktop) with reduced-motion fallback working; 3D code-split |
| F2 | Auth screens, onboarding, AppShell navigation, command palette, toasts | All routes reachable; keyboard navigation works; mock auth persists across reload |
| F3 | Workspace dashboard and all section editors, evidence states, attachments UI, drag reorder | CRUD works on mock API; typing never loses focus; empty/error states exist |
| F4 | Upload and extraction review screen, target intake, analysis theatre, AI report | All three fixtures render distinct reports; score methodology visible; gap types shown |
| F5 | Standard resume page with live sync, tailored Resume Studio, evidence chips, stale badge, diff drawer, history | Editing the workspace updates the standard resume; tailored resume goes stale with a usable diff |
| F6 | Privacy centre, settings, export UI (clean print layout), all empty/error/loading states | No dead buttons; every action shows feedback |
| F7 | Accessibility, performance and responsive polish; Playwright E2E for the full flow | axe has no serious violations; E2E covers signup → workspace → target → report → export |

## 10. BACKEND AND AI PLAN (AFTER the frontend is accepted)

### 10.1 Backend stack
Python + FastAPI, Pydantic v2, pytest, Ruff, Docker. Async jobs for slow AI work with status polling or server-sent events. Typed OpenAPI contract that matches the frontend schemas.

### 10.2 Database and hosting
- **Database: Supabase** (Postgres with Row Level Security, Auth, private Storage buckets). Free projects pause after about 7 days idle, so add a scheduled keep-alive and a restore runbook.
- **Frontend host:** Vercel Hobby (personal, non-commercial only).
- **Backend host:** Render free web service (sleeps after 15 idle minutes, about a minute to wake; use the warm-up screen and async jobs). Alternatives to evaluate: Fly.io, Railway, Cloud Run.

### 10.3 AI provider research (checked Oct 2026; re-verify before launch)
Principle: resumes are personal data, so data-handling terms matter as much as price. The coding assistant's model is NOT the application's AI provider.

| Provider | Free access (reported) | Data handling | Verdict |
|---|---|---|---|
| Groq | Per-model free limits, e.g. about 30 req/min and 1,000/day on gpt-oss-120b | No retention of inputs/outputs by default; Zero Data Retention on request | Best primary candidate |
| NVIDIA-hosted (build.nvidia.com) | Free prototyping, about 40 req/min, no official increase on free tier | Trial/prototyping terms | Secondary and evaluation provider; do not rely on it alone |
| Cerebras | About 1M tokens/day reported | Check terms | Failover (can serve the same open weights as Groq); catalog changes without notice |
| Cloudflare Workers AI | About 10,000 neurons/day free | Written no-training commitment | Embeddings and small tasks |
| Mistral | Free plan with monthly credits | Training on by default; opt-out required | Only after opting out |
| Google Gemini | Free tier for Flash models | Free-tier prompts improve Google products, with human review | Not for resumes on the free tier; not the default |
| xAI Grok | No dependable free API; sources conflict on credits | SOC 2 Type 2, GDPR, CCPA reported | Optional paid fallback later; pin dated model IDs |
| OpenRouter | About 50 req/day on free models | Varies per model | Experiments only |
| Muse Spark 1.3 (Meta) | Paid ($1.25 / $4.25 per M tokens) | Contributor tier trains on prompts | Coding assistant only; never the app provider |

Design: a provider-agnostic AI gateway (OpenAI-compatible interface) with task routing, fallback, caching and quota guards. Deterministic logic first (ATS score, keyword coverage, structure and date checks, skill taxonomy). LLMs only for extraction, requirement parsing, section writing and explanation. Strip phone, email, address and links before sending text to any external model. JSON-schema outputs with validation, repair and retry. Run a one-day bake-off (golden resumes and JDs) before locking the primary provider.

### 10.4 Backend milestones
| ID | Deliverable |
|---|---|
| B0 | FastAPI scaffold, Supabase schema and RLS, auth, CI, Docker |
| B1 | Workspace API with versioning, change log and standard-resume sync |
| B2 | PDF/DOCX parsing, extraction and review API |
| B3 | AI gateway, provider bake-off, structured output with repair |
| B4 | JD analysis, matching, score methodology, deterministic ATS scoring |
| B5 | Tailored generation, claim validator, stale/diff logic, history |
| B6 | PDF export, privacy endpoints, security audit, grounding and load tests |
| B7 | Frontend integration (replace MSW), staging, production deploy |

## 11. Non-functional requirements
- Security: HTTPS; Row Level Security on every table; private buckets with signed URLs; strict CORS and CSP; upload type, size and content checks; rate limiting; secrets only in environment variables; dependency pinning and audits; no personal data in logs.
- Privacy: explicit AI-processing consent; export and deletion; no training on user data; review provider terms before enabling each provider.
- Accessibility: WCAG 2.2 AA.
- Maintainability: strict TypeScript, Zod-first contracts, lint and format in CI, tests per feature, ADRs in `docs/DECISIONS.md`.

## 12. Risks
| Risk | Impact | Mitigation |
|---|---|---|
| LLM fabrication | Critical | Evidence-only context, claim validator, golden tests, visible evidence states |
| Free AI limits or silent model removals | High | Gateway failover, caching, queueing, monitoring |
| Free tiers that train on resumes | High | Choose no-training providers, strip PII, consent screen |
| Cold starts on free hosting | Medium | Warm-up UX, async jobs |
| Cinematic UI hurts performance or accessibility | Medium | Budgets, lazy 3D, reduced-motion fallbacks |
| Scope creep | High | Strict MVP list and milestone gates |

---

## 13. OPENCODE WORKING AGREEMENT

### 13.1 Put this in `AGENTS.md` at the repo root
See `AGENTS.md` at the repo root (it is kept in sync with this section).

### 13.2 First prompt to paste into OpenCode (Milestone F0)
F0 is implemented when this document was saved. See section 9 for acceptance criteria.

### 13.3 Prompts for later milestones
For each next milestone, paste: "Implement Milestone F<n> from docs/PRD.md section 9. Meet its acceptance criteria, follow AGENTS.md, proceed on your own without asking to confirm routine steps, work on a branch and never merge to master (the default branch is `master`), then report results." Review and accept each milestone before starting the next. Parallel agents are safe only on non-overlapping features and each in its own git worktree.
