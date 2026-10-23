# F6 privacy/export contract gaps

Status: B6 is merged (`docs/api/openapi.json`, contract-proposals §9). F6 uses
the merged routes in mock and live mode and does not modify backend code. These
gaps remain in the contract or in what a browser can honestly claim.

## 1. Capabilities cannot disclose the AI provider (PRD EX-3)

`GET /capabilities` returns feature switches only; the OpenAPI description and
contract-proposals §9.1 explicitly forbid a provider name, model, URL or key.
PRD EX-3 asks the privacy centre to disclose *which* AI provider processes
content, so the UI cannot satisfy that sentence from the API alone.

**Current behaviour:** `/privacy` says the server does not disclose a provider
through capabilities and tells the user to ask the operator for the provider
and its data-handling terms. Each AI feature is described from its capability
flag. No provider is guessed.

**Resolution:** add a non-secret disclosure block, for example
`ai: { configured, resumeRewording, analysisEnrichment, providerLabel,
dataHandlingUrl, retentionNote }`, or publish a deployment-level privacy page
and link to it from capabilities. Do not put keys, base URLs or model ids in
the response.

## 2. PDF extraction-check headers are prose, not schema

The 200 and 502 responses describe `X-Export-*` in the `description` field
only. Generated clients cannot discover the header names or types, so F6 parses
`X-Export-Text-Check`, `X-Export-Sections-Checked`, `X-Export-Sections-Missing`,
`X-Export-Claims-Checked`, `X-Export-Claims-Missing` and
`Content-Disposition` from contract-proposals §9.2.

**Current behaviour:** `lib/export/pdf-export.ts` treats a missing or
unreadable header as `unknown`, never as "passed". A 200 with a failed check is
refused client-side as well as server-side.

**Resolution:** declare the headers under the 200 and 502 responses in
OpenAPI, including that the 502 carries the same headers, and add an enum for
`passed | failed`.

## 3. `deletedCounts` keys are open-ended

`AccountDeletionResult.deletedCounts` is a map of string to integer. F6 can
display the known categories in a stable order but silently ignores unknown
keys, so a future backend category would not appear in the summary.

**Current behaviour:** the result panel lists the six known categories with
non-zero counts and says "No stored rows remained" when all are zero. The
server's `message` and `authUserDeleted` still drive the outcome copy.

**Resolution:** define the count keys as a closed object (or return an array of
`{ category, count }`) so clients cannot drift.

## 4. Account deletion splits one user action across the operator

`authUserDeletion` is false in B6 by design (ADR-043): the API deletes every
public row but cannot delete the Supabase auth identity. A user who typed
"delete my account" still has a working sign-in with an empty workspace.

**Current behaviour:** the confirmation dialog lists what is deleted now and
what is not; the result says the sign-in email still exists and the operator
must remove it. The mock deletes the same stores but deliberately keeps the
mock identity, returning `authUserDeleted: false`, so mock and live agree.

**Resolution:** keep the honest split until a privileged deletion path exists.
If one is added, return `authUserDeleted: true` and update the copy; do not
claim complete account deletion while the field is false.

## 5. Nothing schedules retention or purges automatically

The contract has no retention endpoint or expiry field. F6 states that stored
data stays until the user deletes it and that purges happen only on request.

**Resolution:** if retention is introduced, expose it in capabilities (for
example `retention: { workspaceDays, exportDays }`) so the privacy centre can
render the real policy instead of a static explanation.
