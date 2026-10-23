# Contract proposals — imports, targets, analysis, report, resumes and privacy (F4/B5/B6)

Status: **§2 (imports) implemented** by the backend (B2), **§3–§5 (targets,
analysis, report) implemented** by B4, **§6 (resumes) implemented** by B5 and
**§9 (export, capabilities, deletion) implemented** by B6; all are exported into
`docs/api/openapi.json`. The dev-only routes in §7 exist only in the frontend
mock API (MSW). The frontend Zod schemas + MSW handlers get reconciled against
that export before the mock layer is removed at B7 (see ADR-013, ADR-021,
ADR-028, ADR-039, ADR-041).

This document is the contract the F4 frontend already speaks. It complements
`docs/api/openapi.json`, which contains the B0/B1 routes (`/health`,
`/api/v1/me`, `/api/v1/workspace*`, `/api/v1/resume/standard`), the B2 import
routes (`/api/v1/imports*`), the B4 target/analysis routes, the B5 resume
routes and the B6 privacy/export routes (`/api/v1/capabilities`,
`/api/v1/export`, `/api/v1/account`, resume delete/purge/PDF export).

Source of truth on the frontend:

| Area | Zod schema | Mock handlers |
|---|---|---|
| Uploads + extraction review | `frontend/src/lib/schemas/imports.ts` | `frontend/src/mocks/import-handlers.ts`, `imports-store.ts`, `import-fixtures.ts` |
| Targets, run, report | `frontend/src/lib/schemas/analysis.ts` | `frontend/src/mocks/target-handlers.ts`, `targets-store.ts` |
| Resumes | `frontend/src/lib/schemas/resume.ts` | `frontend/src/mocks/handlers.ts`, `fixtures.ts` (B1 standard; B5 tailored arrives at B7) |
| Analysis engine | — (server-side logic) | `frontend/src/lib/analysis/*` (reference implementation) |

---

## 1. Conventions

1. **Base path**: `/api/v1`. All routes below are relative to it. Auth is the
   Supabase JWT (B0/ADR-010); every row is RLS-scoped to the caller. No
   user id is ever accepted in a path or body.
2. **Content type**: JSON except `POST /imports`, which is
   `multipart/form-data` with a single `file` field.
3. **Errors** use the B1 envelope:

   ```json
   { "detail": { "code": "import_not_found", "message": "That import no longer exists." } }
   ```

   Validation errors return `422` with the same envelope plus FastAPI's
   `detail` list is **not** exposed; the frontend reads `detail.message` and
   falls back to a generic retry message.
4. **Dates on the wire are month precision** (`YYYY-MM`) for anything a user
   types into a month input — `startDate`, `endDate`, and an import's
   `endDate` when it means "issued". This is the F3 audit decision (ADR-019 §2,
   ADR-017 §2): the DB may store day precision, the wire never does.
   Day precision must be rejected (422), not silently truncated.
5. **Timestamps** (`createdAt`, `updatedAt`, `generatedAt`, `startedAt`,
   `finishedAt`, `decidedAt`, `analysedAt`) are ISO 8601 UTC strings with
   milliseconds, e.g. `2026-10-17T09:00:00.000Z`.
6. **Nullable vs absent**: fields the database can hold as `null` are sent as
   an explicit `null` on the wire and modelled `.nullish()` in Zod
   (`organization`, `company`, `startDate`, `endDate`, `location`,
   `template`, `length`, `analysis`, `support`, `decidedAt`, `gapType`,
   `pattern`, `finishedAt`, `failure`, `report`). Fields that are simply not
   applicable yet may be absent; Zod applies the documented default. Never use
   `""` for "unset".
7. **Arrays are `[]`, never `null`.** `requiredSkills`, `bullets`, `tags`,
   `links`, `attachments`, `evidenceIds`, `factors`, `requirements`, etc.
8. **Scores are 0–100 integers** and are explainable weighted sums or
   deterministic count-based values. They are never a probability of being
   hired and never an ATS guarantee. The methodology strings travel in the
   report (`methodology`), so a backend change to the wording reaches the UI
   without a frontend release.
9. **Unknown fields are tolerated** by the frontend schemas (Zod strips them),
   so additive backend fields are safe; renames are not.

---

## 2. Imports and extraction review (B2)

### 2.1 Endpoints

| Method | Path | Request | Success | Errors |
|---|---|---|---|---|
| `POST` | `/imports` | multipart `file` | `201 { "import": ImportSession }` | `400 import_file_required`, `400 import_file_rejected`, `413 import_file_too_large`, `415 import_file_type_unsupported`, `503 extraction_unavailable` |
| `GET` | `/imports` | — | `200 ImportSummary[]` | `503` |
| `GET` | `/imports/{import_id}` | — | `200 ImportSession` | `404 import_not_found` |
| `PATCH` | `/imports/{import_id}/items/{item_id}` | `ImportItemPatch` | `200 ImportReviewItem` | `404 import_not_found`, `404 import_item_not_found`, `422 values_invalid` |

Upload limits (client **and** server, PRD §11): PDF or DOCX only, 5 MiB
(`MAX_IMPORT_BYTES = 5 * 1024 * 1024`), non-empty file. Content sniffing must
match the extension; a renamed `.exe` is not a PDF.

### 2.2 `ImportSession`

```json
{
  "id": "imp-3f2a",
  "fileName": "example-cv.pdf",
  "fileType": "pdf",
  "fileSize": 418273,
  "pageCount": 1,
  "sourceText": "EXAMPLE CANDIDATE\nExample City · example.candidate@example.com\n…",
  "previewAvailable": true,
  "items": [ImportReviewItem],
  "createdAt": "2026-10-17T09:00:00.000Z",
  "updatedAt": "2026-10-17T09:00:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `fileType` | `"pdf" \| "docx"` | enum |
| `fileSize` | integer ≥ 0 | bytes |
| `pageCount` | integer ≥ 1 | |
| `sourceText` | string | plain text used by the side-by-side preview. May be `""` when `previewAvailable` is false (scanned documents). |
| `previewAvailable` | boolean | false when the parser produced no text |
| `items` | `ImportReviewItem[]` | `[]` is a valid, designed state |

The mock's `sourceText` is **simulated document content** and the UI labels it
as such. B2 must return the real extracted text; if the document is image-only,
return `previewAvailable: false`, `sourceText: ""`, `items: []` rather than
inventing content.

### 2.3 `ImportReviewItem`

```json
{
  "id": "ext-internship",
  "extraction": {
    "id": "ext-internship",
    "section": "internship",
    "fields": [
      { "key": "title", "label": "Role", "value": "Backend Intern", "confidence": 0.94, "sourceLine": 5 },
      { "key": "organization", "label": "Employer", "value": "Example Payments Ltd", "confidence": 0.68, "sourceLine": 6 },
      { "key": "startDate", "label": "Start", "value": "2024-06", "confidence": 0.9, "sourceLine": 7 },
      { "key": "endDate", "label": "End", "value": "2024-09", "confidence": 0.55, "sourceLine": 7 }
    ],
    "bullets": ["Built an internal reporting endpoint used by the support team."],
    "tags": ["testing"],
    "confidence": 0.55
  },
  "values": {
    "title": "Backend Intern",
    "organization": "Example Payments Ltd",
    "startDate": "2024-06",
    "endDate": "2024-09",
    "location": "",
    "bullets": [],
    "tags": []
  },
  "status": "pending",
  "support": null,
  "decidedAt": null
}
```

Rules:

* `extraction` is immutable — what the parser read, kept for the review. The
  user edits `values` only. `values` is what gets confirmed.
* `values` fields are strings; unset is `""` (a form value, not a wire-null).
  `startDate`/`endDate` must match `^\d{4}-(0[1-9]|1[0-2])$` or be `""`.
  `startDate > endDate` is a `422`.
* `status`: `"pending" | "confirmed" | "rejected"`. The server is the source of
  truth; the client optimistically shows the mutation's response.
* `confidence` is 0–1 per field and per item. **The whole item's confidence is
  the weakest field's confidence** (conservative reading). The UI flags fields
  below `UNCERTAIN_CONFIDENCE = 0.75` and links each to `sourceLine`.
* `sourceLine` is a 1-based line index into `sourceText`. It must exist; a flag
  pointing at a line that does not exist is a bug (the review screen cannot be
  checked against its source).
* `support` is `null`, `{"kind":"file","name":"…"}`, or
  `{"kind":"link","url":"…"}`. Attaching support never changes `status`.

### 2.4 `ImportItemPatch`

```json
{ "values": ImportItemValues, "status": "confirmed", "support": null }
```

All three keys are optional; at least one must be present. `support: null`
removes a previously attached certificate. `values` is always validated whole.

### 2.5 Confirmation → workspace item (IM-2/IM-3)

The frontend deliberately splits confirmation into two calls:

1. `POST /workspace/items` with the reviewed values, and
2. `PATCH /imports/{id}/items/{itemId}` with `status: "confirmed"`.

Order matters: if the create fails the item stays `pending` and nothing
pretends to be saved (see `useConfirmImportItem`). Consequences the backend must
respect:

* **Nothing reaches the workspace before confirmation** — the upload and the
  review session live in their own tables, never in `workspace_items`.
* **Evidence rule (IM-3)**: confirmed items are `attested`; they are `verified`
  **only** when `support` is a certificate file or link. A file becomes an
  attachment (stored in private Storage); a link becomes an `evidence_links`
  row. `verified` without support is rejected by the workspace API (ADR-017 §7).
* The two-call sequence can leave a created workspace item with a `pending`
  review row if the second call fails. The UI re-enables confirm, which would
  then create a duplicate item.

**Proposed B2 addition (not implemented in the frontend yet):**

```
POST /imports/{import_id}/items/{item_id}/confirm
  → 201 { "item": WorkspaceItem, "review": ImportReviewItem }
```

An atomic, idempotent confirm (server creates the workspace item from the
reviewed values and flips the review status in one transaction, keyed by the
review item id). If B2 implements it, the frontend replaces the two-call
composition at B7; the risk above is the reason to prefer it.

### 2.6 `ImportSummary` (list row)

```json
{
  "id": "imp-3f2a",
  "fileName": "example-cv.pdf",
  "fileType": "pdf",
  "itemCount": 7,
  "pendingCount": 3,
  "confirmedCount": 4,
  "createdAt": "2026-10-17T09:00:00.000Z"
}
```

---

## 3. Targets (B4)

### 3.1 Endpoints

| Method | Path | Request | Success | Errors |
|---|---|---|---|---|
| `GET` | `/targets` | — | `200 JobTarget[]` | `503` |
| `POST` | `/targets` | `TargetCreate` | `201 JobTarget` | `422 target_invalid` |
| `GET` | `/targets/{target_id}` | — | `200 JobTarget` | `404 target_not_found` |
| `POST` | `/targets/{target_id}/analysis` | — (empty body) | `202 { "run": AnalysisRun, "report": null }` | `403 consent_required`, `404 target_not_found`, `409 analysis_already_running` |
| `GET` | `/targets/{target_id}/analysis/run` | — | `200 { "run": AnalysisRun, "report": AnalysisReport \| null }` | `404 target_not_found`, `404 analysis_run_not_found` |
| `GET` | `/targets/{target_id}/analysis` | — | `200 AnalysisReport` | `404 target_not_found`, `404 report_not_ready` |

`POST …/analysis` is the only mutating call; it starts (or restarts) a run.
Polling is `GET …/analysis/run` every ~300 ms while `run.status === "running"`.
A run that is already running returns the existing run (`200` on the POST would
also be acceptable; the mock reuses it). Stale detection is derived from
`report.workspaceVersion` vs the workspace's current version — the client also
receives `target.analysis.stale` so the list needs one request.

### 3.2 `JobTarget`

```json
{
  "id": "tgt-senior-frontend-engineer-1",
  "role": "Senior Frontend Engineer",
  "company": "Halcyon Systems",
  "jobDescription": "Senior Frontend Engineer — Halcyon Systems\n\nResponsibilities\n…",
  "requiredSkills": ["TypeScript", "React"],
  "template": "precision",
  "length": "one_page",
  "status": "ready",
  "analysis": {
    "score": 78,
    "analysedAt": "2026-10-17T09:00:00.000Z",
    "workspaceVersion": 12,
    "stale": false
  },
  "sample": false,
  "createdAt": "2026-10-17T08:55:00.000Z",
  "updatedAt": "2026-10-17T09:00:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `company` | `string \| null` | optional; `null` when not given |
| `requiredSkills` | `string[]` | optional; each ≤ 40 chars, ≤ 25 entries, duplicates case-insensitively rejected client-side |
| `template` | `"precision" \| "classic" \| "compact" \| null` | |
| `length` | `"one_page" \| "two_page" \| null` | |
| `status` | `"draft" \| "analyzing" \| "ready" \| "failed"` | |
| `analysis` | `TargetAnalysisSummary \| null` | `null` until a run succeeds; never a placeholder score |
| `sample` | boolean | dev fixtures only; `false` for real users (absence defaults to false) |

### 3.3 `TargetCreate`

```json
{
  "role": "Senior Frontend Engineer",
  "company": "Halcyon Systems",
  "jobDescription": "…at least 40 characters…",
  "requiredSkills": ["TypeScript", "React"],
  "template": "precision",
  "length": "one_page"
}
```

Validation (the frontend form and the API must agree): `role` 2–120 chars,
`company` ≤ 120, `jobDescription` 40–20,000 chars, `requiredSkills` ≤ 25 ×
≤ 40 chars, `template` and `length` from the enums. Trim before storing.

### 3.4 Consent (PRD §6.9 EX-3)

The frontend never calls `POST …/analysis` without recorded AI-processing
consent; it shows the consent gate instead. **B4 must enforce this too**: with
no `aiProcessing: true` consent row for the caller, `POST …/analysis` returns
`403 {"detail":{"code":"consent_required","message":"Record AI-processing consent before running an analysis."}}`.
The mock cannot enforce this because consent lives in the F2 browser store; the
real backend can and should.

---

## 4. Analysis run (B4)

### 4.1 Stages

The theatre renders exactly these six stages, in order (PRD §7.4.4). Keys are
part of the contract; labels may change wording but not meaning.

| # | `key` | Label |
|---|---|---|
| 1 | `reading` | Reading the job |
| 2 | `extracting` | Extracting requirements |
| 3 | `searching` | Searching your workspace |
| 4 | `matching` | Matching evidence |
| 5 | `scoring` | Scoring |
| 6 | `writing` | Writing report |

### 4.2 `AnalysisRun`

```json
{
  "id": "run-tgt-…-1760691600000",
  "targetId": "tgt-…",
  "status": "running",
  "stage": "matching",
  "stageIndex": 3,
  "stageCount": 6,
  "progress": 62,
  "workspaceVersion": 12,
  "startedAt": "2026-10-17T09:00:00.000Z",
  "updatedAt": "2026-10-17T09:00:03.200Z",
  "finishedAt": null,
  "failure": null
}
```

* `status`: `"running" | "succeeded" | "failed"`.
* `stageIndex` is 0-based; `stageCount` is 6. `progress` is 0–100.
* On failure: `status: "failed"`, `stage`/`stageIndex` identify the failed stage,
  `finishedAt` is set, and `failure` is:

  ```json
  { "code": "provider_unavailable", "message": "…", "stage": "matching" }
  ```

  `report` stays `null`; nothing partial is saved. The client offers retry,
  which starts a **new** run from stage 1. Proposed error codes:
  `provider_unavailable`, `provider_timeout`, `output_invalid`,
  `workspace_unavailable`, `internal_error`.
* A run that has succeeded keeps returning `{run, report}`; `GET …/analysis` is
  the cheaper report-only read.

### 4.3 Determinism (JD-5)

For the same `target` + same `workspaceVersion` + same items, these must be
byte-identical across runs: `score`, `factors`, `requirements`, `skills`,
`included`, `excluded`, `content`, `roadmap`, `ats`. Only `generatedAt`,
`run.id`, `startedAt`, `updatedAt`, `finishedAt` and `analysedAt` may differ.
This is tested on the frontend for the reference engine
(`analysis-fixtures.test.ts`, `analysis.test.ts`).

---

## 5. Report (B4)

### 5.1 `AnalysisReport`

```json
{
  "targetId": "tgt-…",
  "workspaceVersion": 12,
  "generatedAt": "2026-10-17T09:00:05.100Z",
  "score": 78,
  "factors": [ScoreFactor],
  "methodology": {
    "note": "Weighted average of the factors below. …",
    "scoreDisclaimer": "This is not a probability of being hired.",
    "atsDisclaimer": "Based on defined checks. Not a guarantee for any employer's ATS.",
    "atsNote": "Deterministic checks only — no LLM scored this. …"
  },
  "requirements": [Requirement],
  "skills": {
    "documented": [{ "name": "TypeScript", "itemIds": ["item-…"] }],
    "demonstrated": [{ "name": "React", "itemIds": ["item-…"] }],
    "notEvidenced": [{ "name": "Kubernetes", "reason": "…" }],
    "toDevelop": [{ "name": "Kubernetes", "reason": "…" }]
  },
  "included": [{ "itemId": "item-…", "reason": "Evidence for TypeScript, React." }],
  "excluded": [{ "itemId": "item-…", "reason": "No requirement in this posting mentions this skill." }],
  "content": {
    "supportedRequirementIds": ["req-…"],
    "needsEvidenceRequirementIds": ["req-…"],
    "sectionsToImprove": [{ "section": "project", "reason": "…" }]
  },
  "roadmap": [{ "priority": 1, "action": "…", "reason": "…" }],
  "ats": { "score": 88, "keywordCoverage": 75, "keywords": [], "checks": [], "issues": [], "examples": [] }
}
```

#### Score methodology (PRD §6.5)

Starting weights: required skills **0.40**, preferred skills **0.15**, relevant
experience and internships **0.20**, education **0.10**, projects and
achievements **0.15**. A factor's value is the mean of its requirements mapped
as `matched = 1`, `partial = 0.5`, `unsupported = 0` × 100. When the posting has
no requirement for a factor, the factor falls back to workspace depth
(experience/internship and project/achievement depth scale by count up to 2;
education is presence-based), and a factor with nothing at all to compare is
**dropped**, after which the remaining weights are renormalised to sum to 1.
`score = round(Σ(weight × value) / Σweight)`, clamped 0–100.

The server returns the **effective** (renormalised) weights in `factors[].weight`
plus the fixed-weight explanation in `methodology.note`. The UI must never show
a raw weight that disagrees with the displayed sum.

#### `Requirement` (PRD §6.4 JD-2..JD-4)

```json
{
  "id": "req-typescript",
  "text": "Strong TypeScript and React skills.",
  "kind": "required",
  "pattern": null,
  "status": "partial",
  "gapType": null,
  "evidenceIds": ["item-…"],
  "explanation": "TypeScript is mentioned, but the evidence on those items is related or missing — it can't be claimed until you verify it."
}
```

* `kind`: `"required" | "preferred"`.
* `pattern`: `null` for skill requirements; `"experience" | "education" | "seniority"`
  for prose requirements (they feed the factor of the same area and are not
  ATS keywords).
* `status`: `"matched" | "partial" | "unsupported"`.
  * matched — an item evidences it with `verified` or `attested` evidence.
  * partial — mentioned only by items whose evidence is `related` or `missing`.
  * unsupported — not found at all.
* `gapType` is present **only** when `status === "unsupported"`:
  * `not_evidenced` — an adjacent skill or another nearby item exists, so the
    skill may simply be undocumented. Adjacent is **never** equivalent
    (PRD §4.3; JavaScript ≠ TypeScript, React ≠ Angular, Docker ≠ Kubernetes).
  * `genuinely_missing` — nothing nearby.
* `evidenceIds` links to workspace items and must be readable by the caller.
  Empty when unsupported.
* `explanation` is shown verbatim next to the status — classifications are
  never a black box.
* `text` quotes the posting (or the optional required-skills input) as written.
  The report never rewrites an employer's requirement.

#### `ScoreFactor`

```json
{ "name": "Required skills", "weight": 0.4444, "value": 67, "detail": "2 matched, 1 partially matched, 1 unsupported of 4 required skill requirement(s)." }
```

`weight` is the effective fraction (0–1, 4 dp) and the weights in `factors` sum
to 1. `value` is 0–100.

#### Roadmap

`priority` is 1-based, ordered by impact for **this** posting (max 6 steps).
`action` names a job-specific move (learn a named technology, build a named
project, earn a certificate, sharpen a bullet); `reason` cites the requirement
or item it comes from. Generic career advice is out of contract.

#### `ats`

Deterministic, no LLM (PRD §6.7):

* `score` starts at 100 and subtracts **12 / 7 / 3** for each high / medium /
  low issue, clamped 0–100.
* `keywordCoverage` counts **skill requirements only** (prose requirements are
  not keywords); a keyword is present when its label or a taxonomy alias occurs
  as a whole word in the resume text built from workspace items.
* `checks` lists every named check with `status: "pass" | "issue" | "not_checked"`
  and the issues it produced. Layout and PDF-round-trip checks return
  `not_checked` until export ships (F5/B6) — the panel shows "not checked yet"
  rather than claiming a pass.
* `issues[].fix` is a concrete action; `before`/`after` examples are
  **presentational rewrites of the same facts**, never new claims.
* `keywords[]`, `checks[]`, `issues[]`, `examples[]` default to `[]`.

The report UI always renders `methodology.scoreDisclaimer`
("This is not a probability of being hired.") with the score and
`methodology.atsDisclaimer`
("Based on defined checks. Not a guarantee for any employer's ATS.") with the
ATS panel. B4 must return both strings; the frontend falls back to the constants
in `analysis.ts` if an older payload omits them.

---

## 6. Resumes (B5)

A *standard* resume is derived from the current workspace on every read and is
never persisted. A *tailored* resume is a snapshot generated for one job target,
with the workspace version, the source evidence and an insert-only history. The
two use the same `Resume` shape; only tailored resumes accept mutations.

### 6.1 Endpoints

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| `POST` | `/targets/{target_id}/resume` | `ResumeGenerateRequest` | `201 Resume` | `403 ai_consent_required`, `404 target_not_found`, `409 analysis_required \| analysis_stale`, `503 ai_not_configured` |
| `GET` | `/resumes` | — | `200 ResumeSummary[]` | — |
| `GET` | `/resumes/{resume_id}` | — | `200 Resume` | `404 resume_not_found` |
| `PATCH` | `/resumes/{resume_id}/sections/{section_key}` | `ResumeSectionEdit` | `200 Resume` | `404 resume_not_found \| resume_section_not_found`, `409 resume_not_tailored`, `422 resume_evidence_not_found \| resume_claim_ungrounded` |
| `GET` | `/resumes/{resume_id}/versions` | — | `200 ResumeVersion[]` | `404 resume_not_found` |
| `POST` | `/resumes/{resume_id}/versions/{version_id}/restore` | — | `200 Resume` | `404 resume_not_found \| resume_version_not_found`, `409 resume_not_tailored` |
| `POST` | `/resumes/{resume_id}/stale` | — | `200 Resume` | `404 resume_not_found`, `409 resume_not_tailored` |
| `GET` | `/resumes/{resume_id}/diff` | — | `200 ResumeDiff` | `404 resume_not_found` |
| `POST` | `/resumes/{resume_id}/refresh` | `ResumeRefreshRequest` | `200 ResumeRefreshResult` | `403 ai_consent_required`, `404 resume_not_found \| target_not_found`, `409 resume_not_tailored \| analysis_required`, `422 resume_section_invalid`, `503 ai_not_configured` |
| `DELETE` | `/resumes/{resume_id}` | — | `204` | `404 resume_not_found`, `409 resume_not_tailored` |
| `DELETE` | `/resumes/{resume_id}/versions/{version_id}` | — | `204` | `404 resume_not_found \| resume_version_not_found`, `409 resume_not_tailored` |
| `POST` | `/resumes/{resume_id}/purge` | — | `200 ResumePurgeResult` | `404 resume_not_found`, `409 resume_not_tailored` |
| `POST` | `/resumes/{resume_id}/versions/{version_id}/purge` | — | `200 ResumeVersionPurgeResult` | `404 resume_not_found \| resume_version_not_found`, `409 resume_not_tailored` |
| `GET` | `/resumes/{resume_id}/export.pdf` | — | `200 application/pdf` | `404 resume_not_found`, `502 export_verification_failed` |

The standard resume's id is the stable `resume-standard` (the B1
`GET /resume/standard` route remains available for the same derived resume).
`GET /resumes` returns it
first, followed by tailored resumes newest-first. `GET /resumes/resume-standard`
is always current and `stale: false`; its `/versions` list is empty.

**Version ordering is part of the contract:** `GET /resumes/{resume_id}/versions`
returns snapshots **newest first** (`createdAt` descending; the deletion/purge
routes preserve that order). The first row is therefore always the most recent
snapshot. The standard resume has no versions (`[]`).

B6 adds user-initiated deletion and purge on top of B5's append-only rules:
normal generation/edit/restore/refresh still append, never rewrite, history;
only the explicit `DELETE` and `purge` routes below remove or rewrite saved
information, and they are documented in §6.5 and ADR-041.

### 6.2 `Resume`

```json
{
  "id": "uuid | resume-standard",
  "kind": "standard | tailored",
  "targetId": "uuid | null",
  "title": "Senior Frontend Engineer at Halcyon Systems | null",
  "workspaceVersion": 12,
  "stale": false,
  "sections": [
    { "key": "experience",
      "claims": [
        { "text": "Senior Frontend Engineer · Acme · 2021-01 – 2024-01",
          "evidenceIds": ["item-uuid"], "confirmed": true,
          "aiRewritten": false, "removed": false }
      ] }
  ],
  "createdAt": "2026-10-21T10:00:00.000Z",
  "updatedAt": "2026-10-21T10:00:00.000Z",
  "aiUsed": false,
  "ats": { "...": "AtsReport (contract §5.1)" },
  "editedSections": ["experience"],
  "removedEvidenceIds": []
}
```

* Every claim carries the workspace item id(s) that evidence it; there are no
  claims without evidence.
* `confirmed` is true for verified/user-attested evidence (and for a
  user-authored edit); it is false for related/missing evidence.
* `aiRewritten` marks the individual line; `aiUsed` is true only if at least one
  such line survives in the visible resume.
* `removed` is computed on read: a cited item was deleted after the snapshot.
  `removedEvidenceIds` lists all such items. Neither the claim nor its text is
  silently dropped.
* `stale` is `true` when the stored `stale` flag is set **or**
  `workspaceVersion` is older than the current workspace version.
* `editedSections` lists hand-edited section keys; refresh will not touch them
  without an explicit per-section choice.
* `ats` is the deterministic `AtsReport` computed at generation/refresh time
  from the selected items and the report's requirements. It is never a
  guarantee and always carries the methodology disclaimer.

`ResumeSummary` is the same object without `sections` or `ats` (it keeps `id`,
`kind`, `targetId`, `title`, `workspaceVersion`, `stale`, `aiUsed`,
`editedSections`, `removedEvidenceIds`, `createdAt`, `updatedAt`). B6 added
`removedEvidenceIds` to the list row so the history screen can show "contains
removed information" and offer purge without fetching every full resume
(ADR-041).

### 6.3 Generation (deterministic first)

```json
// POST /targets/{target_id}/resume
{ "title": "Optional label", "rewordWithAi": false }
```

Generation requires a successful report whose `workspaceVersion` equals the
current workspace version; otherwise `409 analysis_required` (no report) or
`409 analysis_stale` (workspace moved on). Re-run the analysis first.

The engine selects and orders the user's own current items, using the report:

1. within each section, items cited by matched **required** requirements rank
   first, then matched preferred, partial required, partial preferred; ties keep
   workspace order;
2. personal/contact items are always kept, and remaining items are appended in
   workspace order when the job matches little, so the resume is never empty;
3. section order is personal, experience, internship, project, education,
   certificate, course, training, skill, achievement, publication,
   extracurricular;
4. bullets inside an item are ordered by how many target-requirement words they
   contain, then by their original order;
5. the target `length` caps the result: one page = 28 claims / 2 bullets per
   item, two pages = 44 claims / 3 bullets per item.

Only reordering and trimming happen: every header value and every bullet is
copied verbatim from the workspace item. No employer, title, date, metric,
technology or certificate is ever invented (RG-2). The same target, workspace
version and report always produce the same resume.

### 6.4 Editing and grounding

```json
// PATCH /resumes/{id}/sections/experience
{ "claims": [
  { "text": "Led the React migration for the customer dashboard.",
    "evidenceIds": ["item-uuid"] }
] }
```

The body **replaces** that section's claims. Every cited id must be an active
item in the caller's workspace (`422 resume_evidence_not_found`). Every claim is
run through the B3 claim validator against exactly those items; a new number,
technology, organization, title or date is rejected with
`422 resume_claim_ungrounded` and nothing is written. Accepted claims are marked
`confirmed: true`, the section is added to `editedSections`, and a new version
with `reason: "edited"` is appended.

### 6.5 Versions and restore

`ResumeVersion` = `{ id, resumeId, workspaceVersion, createdAt, reason, title,
aiUsed, sections, ats, editedSections, stale, removedEvidenceIds }`; `reason`
is `generated`, `edited`, `restored`, `refreshed` or `purged`. Versions are
returned newest-first. `stale` and `removedEvidenceIds` are computed on read
against the current workspace (they are not stored): a version is stale when
its `workspaceVersion` is older than the current workspace version, and
`removedEvidenceIds` lists cited items that no longer exist. Reading a version
therefore has the same warning information as reading the current resume.

`POST …/versions/{version_id}/restore` copies that snapshot into the current
resume (same resume id, new `updatedAt`) and appends a new version with
`reason: "restored"`. History therefore grows by one; the restored version's
`workspaceVersion` is preserved, so a restore from before a workspace change is
reported as stale.

**Deletion and purge (B6).** Normal mutations never delete history. The
following are explicit user actions:

* `DELETE /resumes/{resume_id}` permanently deletes a tailored resume, its
  claims and its saved versions (the standard resume is rejected with
  `409 resume_not_tailored`). Returns `204`.
* `DELETE /resumes/{resume_id}/versions/{version_id}` permanently deletes one
  saved version and leaves the current resume unchanged. Returns `204`.
* `POST /resumes/{resume_id}/purge` is the "remove removed information"
  operation (PRD §6.8 RG-6). It rewrites the current resume **and every saved
  version** so no claim that cites a workspace item deleted after the snapshot
  survives. Sections left with no claims are dropped, cited evidence for the
  removed items is dropped, `editedSections` only keeps surviving sections, and
  a new version with `reason: "purged"` is appended when the current resume
  changed. The response is:

  ```json
  {
    "resume": Resume,
    "purgedVersions": 2,
    "removedClaims": 5,
    "removedEvidenceIds": ["item-uuid"]
  }
  ```

* `POST /resumes/{resume_id}/versions/{version_id}/purge` rewrites exactly one
  snapshot. The response is
  `{ "version": ResumeVersion, "removedClaims": 2, "removedEvidenceIds": ["item-uuid"] }`.

Purge never invents, rewrites or reorders surviving statements: it only removes
claims whose evidence no longer exists. A purge with nothing to remove is a
no-op (`200`, zero counts) and does not append a version. Purge is idempotent:
the second call reports zero removed claims.

### 6.6 Stale, diff and refresh

`POST /resumes/{id}/stale` sets the stored stale flag (idempotent). It is not
needed when the workspace has already moved on, because `stale` is computed on
every read. The standard resume cannot be marked stale (`409 resume_not_tailored`).

```json
// GET /resumes/{id}/diff
{
  "resumeId": "uuid",
  "targetId": "uuid",
  "workspaceVersion": 12,
  "currentWorkspaceVersion": 14,
  "stale": true,
  "added":   [{ "itemId": "uuid", "section": "project", "title": "Design system" }],
  "removed": [{ "itemId": "uuid", "section": "experience", "title": "Old role" }],
  "edited":  [{ "itemId": "uuid", "section": "experience", "title": "Renamed role" }],
  "changedSections": ["experience", "project"],
  "removedEvidenceIds": ["uuid"]
}
```

* `added` = current active items the resume does not cite.
* `removed` = cited items that are deleted/missing.
* `edited` = cited items whose content fingerprint changed. Moving an item in
  the workspace is not an edit (position is excluded from the fingerprint).

```json
// POST /resumes/{id}/refresh
{ "sections": [], "overwriteEditedSections": [], "rewordWithAi": false }
```

`sections: []` means every section. Only sections the user has not edited are
rebuilt from the current workspace and the latest report (which may itself be
stale: refresh is how a resume catches up). Edited sections are skipped and
reported as `{"section": "experience", "reason": "edited"}`; naming a section in
`overwriteEditedSections` is the explicit choice to replace it, which also
clears it from `editedSections`. Removed source items disappear from refreshed
sections; in skipped edited sections their claims stay visible with
`removed: true`. The response is
`{ "resume": Resume, "refreshedSections": [...], "skippedSections": [...] }`.
A targeted refresh always updates `workspaceVersion`, clears the stored stale
flag and appends a version with `reason: "refreshed"`.

### 6.7 Optional AI rewording

AI is opt-in per request (`"rewordWithAi": true`) and only available when a
provider is configured **and** `ai_processing` consent is recorded:

* no provider → `503 ai_not_configured` before any call;
* no consent → `403 ai_consent_required` before any call.

Only bullet claims (never headers or skill names) are sent, one at a time, with
exactly the cited item as evidence. The task is the B3 `rewrite_bullet` (verb
choice and concision, no new facts). Each candidate is re-validated against that
evidence; if it adds a metric, technology, organization, title or date, or the
provider fails, the original text is kept. Generation still succeeds. `aiUsed`
is true only when at least one rewritten claim survives. AI is never required
for a deterministic resume.

### 6.8 Privacy

All reads/writes use the caller's JWT, so Postgres RLS scopes every resume,
version and claim to `auth.uid()`. The service logger records only resume/target
ids, section keys, counts and booleans -- never resume, claim, workspace or job
text.

---

## 7. Dev-only endpoints (not part of the backend contract)

These exist so the three fixtures and failure states are demonstrable in
`next dev`; they 404 outside development and must never be implemented against
real users (ADR-013 §4).

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/dev/workspace-persona` | — | `{ persona, failures }` |
| `POST` | `/dev/workspace-persona` | `{ "persona": "empty" \| "fresher" \| "midlevel" }` | load a sample workspace |
| `POST` | `/dev/failures` | `{ "enabled": true }` | make workspace/mutation calls 503 and fail the analysis at "Matching evidence" |
| `POST` | `/dev/sample-targets` | — | write the three sample postings |

Sample target ids are stable: `sample-target-strong`, `sample-target-partial`,
`sample-target-poor`, and `sample: true`.

---

## 8. Open questions for B2/B4/B5/B6

1. **Atomic confirm** (2.5) — implement `POST …/confirm` or accept the
   two-call sequence and idempotency keys?
2. **Run polling vs SSE** — the PRD allows either (B0 plan: "status polling or
   server-sent events"). The frontend polls every 300 ms; if B4 adds SSE, the
   `AnalysisRun` payload should be the event payload so `useAnalysisRun` swaps
   transports without a UI change.
3. **Run retention** — how long is a finished run kept? The frontend only needs
   the latest run per target; reports are the durable artefact.
4. **`sample` in production** — should the field be rejected on create, or just
   ignored? The frontend treats it as read-only.
5. **Extraction confidence calibration** — the 0.75 uncertainty threshold is a
   product choice. B2 should return calibrated confidence and the frontend
   threshold moves only with a deliberate copy change.
6. **ATS layout checks** — F5/B6 must add the rendered-PDF checks; until then
   `not_checked` is the honest value.
7. **Resume-claim rewrite atomicity** (B5) — sections JSON and
   `resume_claims` rows are written through separate PostgREST calls. The
   single-instance deployment accepts this; a later SQL function can make the
   pair transactional without changing the wire contract (ADR-039).
8. **Resume ATS reuse** — B5 reuses the report's `AtsReport` shape on the resume
   because it is the same deterministic check over the selected items. If F6
   needs resume-specific layout checks, add fields rather than a second type.

---

## 9. Export, capabilities and account privacy (B6)

B6 implements PRD §6.9 (EX-1..EX-3) and the privacy half of RG-6. Everything is
authenticated and scoped by the caller's JWT: no endpoint accepts a user id.

### 9.1 Endpoints

| Method | Path | Request | Success | Errors |
|---|---|---|---|---|
| `GET` | `/capabilities` | — | `200 Capabilities` | — |
| `GET` | `/resumes/{resume_id}/export.pdf` | — | `200 application/pdf` (streamed) | `404 resume_not_found`, `502 export_verification_failed` |
| `GET` | `/export` | — | `200 UserDataExport` | `503 data_export_unavailable` |
| `DELETE` | `/account` | `AccountDeleteRequest` | `200 AccountDeletionResult` | `400 account_confirmation_required`, `503 account_deletion_unavailable` |

`GET /capabilities` answers "can this server do X" without disclosing a provider:
no provider name, model id, base URL, key or key length appears in the body.

```json
{
  "ai": {
    "configured": true,
    "analysisEnrichment": true,
    "resumeRewording": true
  },
  "pdfExport": true,
  "dataExport": true,
  "accountDeletion": {
    "dataDeletion": true,
    "authUserDeletion": false
  }
}
```

* `ai.configured` is true when at least one AI provider key is present. The two
  feature flags say which AI-backed features may be offered; they never imply a
  provider is healthy, and a missing key turns them off before any call.
* `pdfExport`, `dataExport` and `accountDeletion.dataDeletion` describe this
  API surface and are false when the deployed server has no data access
  configured.
* `authUserDeletion` is false in B6 on purpose: deleting the Supabase auth
  identity needs a privilege this process deliberately does not hold (ADR-043).
  Clients must not offer a "complete account deletion" claim while it is false.

### 9.2 PDF export (EX-1)

`GET /resumes/{resume_id}/export.pdf` accepts the standard resume id
(`resume-standard`) or a tailored resume. The PDF is generated server-side and
**streamed; it is never stored**. It is single column, A4, has selectable text,
uses conventional uppercase-safe section headings (`Contact`, `Experience`,
`Projects`, `Education`, `Skills`, …), and carries no watermark and no invented
content. Every visible statement is one of the resume's `sections[].claims`;
the export renders no summary, score, ATS panel or branding text.

After rendering, the server extracts the text back from the generated bytes
and checks that every rendered section heading and every claim is present
(whitespace-normalized). The result is reported in response headers:

| Header | Meaning |
|---|---|
| `X-Export-Text-Check` | `passed` or `failed` |
| `X-Export-Sections-Checked` | rendered sections checked |
| `X-Export-Sections-Missing` | heading checks that failed |
| `X-Export-Claims-Checked` | visible claims checked |
| `X-Export-Claims-Missing` | claim checks that failed |
| `Content-Disposition` | `attachment; filename="<slug>.pdf"` |

A failed extraction check is **not** served as a good export: the route returns
`502 export_verification_failed` and the headers, so a client cannot silently
hand the user a PDF whose text layer is missing. Headers never contain claim
text (only counts), so no personal data leaks into logs or proxies.

### 9.3 Full data export (EX-2)

`GET /export` returns every public row owned by the caller. The response is JSON
with `Content-Disposition: attachment` and `Cache-Control: no-store`:

```json
{
  "format": "resumeiq.data-export.v1",
  "exportedAt": "2026-10-21T10:00:00.000Z",
  "userId": "uuid",
  "email": "user@example.com | null",
  "workspace": [],
  "workspaceVersions": [],
  "evidenceLinks": [],
  "changeLog": [],
  "targets": [],
  "jdRequirements": [],
  "reports": [],
  "analysisRuns": [],
  "resumes": [],
  "resumeVersions": [],
  "resumeClaims": [],
  "consentRecords": [],
  "imports": [],
  "importReviewItems": [],
  "profile": null,
  "skills": [],
  "skillRelations": [],
  "auditEvents": []
}
```

Rows are the stored JSON, so soft-deleted workspace items, month-precision
dates and provenance columns survive the export. `userId`/`email` come from the
verified access token, never from another table. The export contains **no
`auth.users` row, password, access token, refresh token, API key or service
key**, and no row belonging to another user: the query filters `user_id` and
Postgres RLS enforces the same rule. `format` is versioned so a consumer can
detect a future shape change.

### 9.4 Account deletion (EX-2)

```json
// DELETE /account
{ "confirmation": "delete my account" }
```

The confirmation phrase is compared case-insensitively after trimming; anything
else is `400 account_confirmation_required` and deletes nothing. A correct
request removes every public row the caller owns in dependency order (claims
and versions before resumes; import items before sessions; requirements and
reports before targets; evidence before workspace items; relations before
skills; then versions, change log, consent records, audit events, the profile
and the workspace), using one narrowly scoped `SECURITY DEFINER` function that
resolves `auth.uid()` and takes no user id. It then returns:

```json
{
  "dataDeleted": true,
  "authUserDeleted": false,
  "remainingStep": "auth_user",
  "deletedAt": "2026-10-21T10:00:00.000Z",
  "deletedCounts": { "workspace_items": 12, "resumes": 2, "…": 0 },
  "message": "Your ResumeIQ data was deleted. The sign-in identity still exists and must be removed by the service operator."
}
```

The response is deliberately honest: `authUserDeleted` is false and
`remainingStep` names the outstanding auth-identity deletion. This process does
not hold a service-role key and does not add one (ADR-043). Account deletion is
idempotent for data: a second call deletes zero rows and returns the same
remaining step.

### 9.5 Privacy notes

* PDFs are generated in memory per request and never persisted.
* The export and deletion routes never log row contents, tokens or the
  confirmation phrase.
* Failures return the standard `{"detail":{"code","message"}}` envelope and do
  not echo stored data.
* `DELETE /account` only removes data for the token's `sub`; a forged body,
  query parameter or header cannot select another user (no user id is accepted).
