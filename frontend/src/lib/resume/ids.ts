/**
 * The standard resume has a stable id on the B5 wire. It is derived from the
 * workspace on every read and is never persisted, so this id never points at a
 * stored snapshot.
 */
export function standardResumeId(): string {
  return "resume-standard";
}
