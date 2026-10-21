# F5 resume-studio contract gaps

Status: F5 consumes the **unmerged** B5 contract on
`feat/b5-tailored-resume` (commit `a38143f`). These are the places where the
exported contract is missing, ambiguous, or cannot support the required UI. F5
does not modify backend code. Each item states the temporary frontend behaviour
and what should change in the contract.

## 1. `master` has no B5 routes

`docs/api/openapi.json` on `master` contains only the B0/B1 routes and the B2
imports. It has no `/api/v1/resumes*` and no
`/api/v1/targets/{target_id}/resume`. The B5 export on the feature branch does.

**Temporary behaviour:** schemas and MSW handlers follow the B5 branch, and the
live client calls the B5 paths. A live check against `master` returns `404` for
all of them.

**Resolution:** merge B5, regenerate `docs/api/openapi.json`, then run
`npm run e2e:live` with `RUN_LIVE_E2E=1`.

## 2. No AI-provider capability endpoint

`ResumeGenerateRequest.rewordWithAi` can return `503 ai_not_configured`, but
there is no read endpoint that tells the UI whether a provider exists. The
client cannot know before the user opts in, and the consent gate must not be
bypassed to discover it.

**Temporary behaviour:** live mode reads the build-time
`NEXT_PUBLIC_AI_REWORDING_CONFIGURED` flag (default `false`) and mock mode
reports a deterministic stand-in provider. The optional switch is disabled with
an explanation when the flag is off.

**Resolution:** add a capability field to `GET /api/v1/me` (or
`GET /api/v1/resumes/capabilities`) such as
`{ "aiRewording": { "configured": true } }` and use it instead of the build
flag.

## 3. No delete/purge endpoint

History can restore but cannot delete a resume or a version. B5 says versions
are insert-only, and the OpenAPI file has no `DELETE /resumes/{id}` or version
purge route.

**Temporary behaviour:** no purge button is rendered. The history panel says
"Purge is coming" and explains that restore is non-destructive. This avoids a
dead control.

**Resolution:** decide whether users may delete a whole resume or only purge
old snapshots, then add the endpoint and document the retention rule before the
UI adds a control.

## 4. `ResumeSummary` cannot drive the removed-information warning

`ResumeSummary` omits `sections`, `ats` and `removedEvidenceIds`. The history
list therefore cannot know whether a saved snapshot cites a workspace item that
was deleted unless it fetches the full resume.

**Temporary behaviour:** `/history` fetches the detail of every saved tailored
resume and computes the warning from `removedEvidenceIds`. This is correct but
costs one request per snapshot.

**Resolution:** add a cheap `removedCount` (or `hasRemovedEvidence`) to
`ResumeSummary`, or add an explicit `needsReview` boolean.

## 5. Version rows have no removed/stale summary

`ResumeVersionResponse` has `workspaceVersion`, `sections`, `ats` and
`editedSections`, but no `removedEvidenceIds` and no per-version `stale` flag.
A restored snapshot can legitimately be stale, so a version list cannot warn
without reading the current resume.

**Temporary behaviour:** the current resume detail drives the warning; version
rows describe the snapshot and the restore button is always non-destructive.

**Resolution:** add `removedEvidenceIds` and `stale` to `ResumeVersionResponse`,
or document that version warnings are intentionally derived from the current
resume only.

## 6. Version ordering is not specified

`GET /resumes/{resume_id}/versions` returns an array but the contract does not
say newest-first or oldest-first.

**Temporary behaviour:** the mock returns newest-first and the UI renders the
array as received, then restores the version the user clicked. A live server
that returns oldest-first would not break correctness, but the first row would
change meaning.

**Resolution:** document `createdAt` descending (newest first) in §6.5 and
assert it in the backend tests.
