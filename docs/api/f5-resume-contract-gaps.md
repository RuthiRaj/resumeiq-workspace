# F5 resume-studio contract gaps

Status: closed. F5 was built against the merged B5 export; the five gaps it
recorded were all resolved by B6, which is now on `master` (PR #29, merge commit
`52cba07`) and exported in `docs/api/openapi.json`. This branch merged that
`master`, so each gap below records what the contract now contains, what the
frontend does instead of the old workaround, and what is deliberately left to
F6. F5 does not modify backend code.

Endpoints added by B6 that are relevant here: `GET /api/v1/capabilities`,
`DELETE /api/v1/resumes/{resume_id}`,
`DELETE /api/v1/resumes/{resume_id}/versions/{version_id}`,
`POST /api/v1/resumes/{resume_id}/purge`,
`POST /api/v1/resumes/{resume_id}/versions/{version_id}/purge`,
`GET /api/v1/resumes/{resume_id}/export.pdf`, `GET /api/v1/export` and
`DELETE /api/v1/account` (ADR-041 to ADR-043).

## 1. No AI-provider capability endpoint

**Was:** `ResumeGenerateRequest.rewordWithAi` can return `503 ai_not_configured`,
but there was no read endpoint telling the UI whether a provider exists, so live
mode used the build-time `NEXT_PUBLIC_AI_REWORDING_CONFIGURED` flag.

**Now:** `GET /api/v1/capabilities` reports `ai.configured`,
`ai.analysisEnrichment` and `ai.resumeRewording` as booleans (never a provider
name, model id, URL or key). The frontend calls it through
`api.getCapabilities()` with `CapabilitiesSchema`
(`frontend/src/lib/schemas/capabilities.ts`) and `useCapabilities()`
(`frontend/src/features/resume/use-resume.ts`). The environment flag is gone.
`aiRewordAvailability(consent, providerConfigured)` now takes the capability
value, and a failed or missing read is treated as all-false, so the switch stays
disabled with an explanation instead of guessing. Mock mode answers the same
route with its deterministic stand-in reworder.

## 2. No delete/purge endpoint

**Was:** history could restore but not delete a resume or a version, so the page
said "Purge is coming" and rendered no control.

**Now:** `DELETE /resumes/{id}`, `DELETE /resumes/{id}/versions/{version_id}`,
`POST /resumes/{id}/purge` and `POST /resumes/{id}/versions/{version_id}/purge`
exist. Purge removes only claims whose cited workspace item is gone, copies
survivors verbatim, and reports what changed (ADR-041).

**Left for F6:** the delete/purge controls and their confirmation dialogs. This
page states that deletion/purge is coming in F6 rather than rendering a dead
button; no F5 code calls these routes yet. The `purged` version reason is
accepted by `ResumeVersionSchema` now so a live history read cannot fail on a
version that B6 already purged.

## 3. `ResumeSummary` could not drive the removed-information warning

**Was:** `ResumeSummary` omitted `sections`, `ats` and `removedEvidenceIds`, so
`/history` fetched the detail of every saved tailored resume (one request per
snapshot) just to count removed sources.

**Now:** `ResumeSummary` carries `removedEvidenceIds` (and `stale`) in the
exported schema. `ResumeSummarySchema` mirrors it, the mock computes it on read,
and `/history` renders its warnings from the list response. The per-resume
detail fan-out (`useResumeDetails`) was removed; History now makes one list
request plus one versions request for the selected resume.

## 4. Version rows had no removed/stale summary

**Was:** `ResumeVersionResponse` had no `removedEvidenceIds` and no per-version
`stale` flag, so an old snapshot could not warn until it was restored.

**Now:** the exported `ResumeVersionResponse` has `stale` and
`removedEvidenceIds`, computed on read against the current workspace (not
stored). `ResumeVersionSchema` mirrors both, the mock decorates every version
the same way, and each version row in the history panel shows "Older workspace
version" and/or "N cited item(s) removed" without a second request.

## 5. Version ordering was not specified

**Was:** the contract did not say whether `GET /resumes/{id}/versions` returned
newest-first or oldest-first, so the UI rendered the array as received and
relied on the mock's order.

**Now:** the exported `ResumeVersionResponse` description states that versions
are returned newest-first by every endpoint (`createdAt` descending); the mock
sorts that way and `listVersions` is covered by a unit test. The UI relies on
the documented order instead of guessing.

## Left for F6 (not F5 workarounds)

* Delete/purge UI (gap 2 above).
* Server PDF export (`GET /resumes/{id}/export.pdf`) — F5's print view stays the
  client-side path; the PDF button and its `X-Export-*` feedback belong to F6.
* Data export and account deletion (`GET /export`, `DELETE /account`); the
  privacy settings placeholders still say "Coming in F6".
