/**
 * Dev-only failure simulation state (PRD §7.7 error states, §8.4).
 *
 * Deliberately **in-memory**: the previous implementation kept the flag in
 * `localStorage`, so once a developer switched "Failures on" every API request
 * failed on every later page load until they found the toggle again — a
 * self-inflicted broken app with no obvious way back. A module variable is
 * reset by the browser on every fresh page load, which is exactly the intended
 * lifetime: inject failures now, to observe an error state, and be clean after
 * a reload.
 *
 * A scope lets an E2E isolate one failing surface without blanking the whole
 * app:
 *  - `all`          every mock endpoint (the original behaviour);
 *  - `capabilities` only `GET /capabilities` fails.
 *
 * It only ever gates the MSW mock API (`failIfEnabled()` in `./context`), and
 * the `/api/v1/dev/failures` route that sets it 404s outside `next dev`
 * (ADR-024), so production can neither enable nor be affected by it.
 */
export type FailureScope = "all" | "capabilities";

let failuresEnabledFlag = false;
let failureScope: FailureScope = "all";

export function failuresEnabled(): boolean {
  return failuresEnabledFlag;
}

export function currentFailureScope(): FailureScope {
  return failureScope;
}

export function setFailures(
  enabled: boolean,
  scope: FailureScope = "all",
): void {
  failuresEnabledFlag = enabled;
  failureScope = scope;
}

/**
 * True when a request for `scope` should fail. A toggle scoped to one surface
 * never breaks the others; scoped to `all`, every surface fails.
 */
export function shouldFail(scope: FailureScope = "all"): boolean {
  if (!failuresEnabledFlag) return false;
  return failureScope === "all" || failureScope === scope;
}
