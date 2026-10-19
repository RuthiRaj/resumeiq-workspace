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
 * It only ever gates the MSW mock API (`failIfEnabled()` in `./context`), and
 * the `/api/v1/dev/failures` route that sets it 404s outside `next dev`
 * (ADR-024), so production can neither enable nor be affected by it.
 */
let failuresEnabledFlag = false;

export function failuresEnabled(): boolean {
  return failuresEnabledFlag;
}

export function setFailures(enabled: boolean): void {
  failuresEnabledFlag = enabled;
}
