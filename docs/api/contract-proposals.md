# Contract proposals — imports, targets, analysis and report (F4)

Status: **§2 (imports) implemented** by the backend (B2, exported into
`docs/api/openapi.json`); the rest is still implemented only by the frontend mock
API (MSW).
Owner of the next step: backend B4 (targets, analysis, report).

This document is the contract the F4 frontend already speaks. It complements
`docs/api/openapi.json`, which contains the B0/B1 routes (`/health`,
`/api/v1/me`, `/api/v1/workspace*`, `/api/v1/resume/standard`) plus the B2 import
routes (`/api/v1/imports*`). The remaining proposed paths are exported when B4
ships, and the frontend Zod schemas + MSW handlers get reconciled against that
export before the mock layer is removed at B7 (see ADR-013, ADR-021, ADR-028).

Source of truth on the frontend:

| Area | Zod schema | Mock handlers |
|---|---|---|
| Uploads + extraction review | `frontend/src/lib/schemas/imports.ts` | `frontend/src/mocks/import-handlers.ts`, `imports-store.ts`, `import-fixtures.ts` |
| Targets, run, report | `frontend/src/lib/schemas/analysis.ts` | `frontend/src/mocks/target-handlers.ts`, `targets-store.ts` |
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

## 6. Dev-only endpoints (not part of the backend contract)

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

## 7. Open questions for B2/B4

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
