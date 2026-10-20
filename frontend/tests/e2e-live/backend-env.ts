import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Read the live E2E gate and user A credentials from `backend/.env.test`.
 *
 * Why this exists: the live specs used to need `LIVE_E2E_EMAIL` and
 * `LIVE_E2E_PASSWORD` typed into a shell. The backend integration tests already
 * keep those values in the git-ignored `backend/.env.test` as
 * `SUPABASE_TEST_EMAIL_A` / `SUPABASE_TEST_PASSWORD_A`, so the browser spec
 * reads the same file instead. Shell variables still win when present (useful
 * for CI). Values are returned to the test process only; nothing here logs or
 * prints them.
 */

let cache: Record<string, string> | null = null;

/** Walk up from the working directory so this works from `frontend/` or the repo root. */
function findBackendTestEnv(): string | null {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, "backend", ".env.test");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

/** Parse `backend/.env.test` into a plain object; empty when the file is absent. */
export function backendTestEnv(): Record<string, string> {
  if (cache) return cache;
  cache = {};

  const file = findBackendTestEnv();
  if (!file) return cache;

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return cache;
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equals = assignment.indexOf("=");
    if (equals <= 0) continue;

    const key = assignment.slice(0, equals).trim();
    if (!key) continue;

    let value = assignment.slice(equals + 1).trim();
    const doubleQuoted = value.startsWith('"') && value.endsWith('"');
    const singleQuoted = value.startsWith("'") && value.endsWith("'");
    if (value.length >= 2 && (doubleQuoted || singleQuoted)) {
      value = value.slice(1, -1);
    }
    cache[key] = value;
  }

  return cache;
}

/** Opt-in gate: `RUN_LIVE_E2E=1` in the shell or in `backend/.env.test`. */
export function liveE2eEnabled(): boolean {
  return (
    process.env.RUN_LIVE_E2E === "1" || backendTestEnv().RUN_LIVE_E2E === "1"
  );
}

/** User A credentials, with exported `LIVE_E2E_*` values as an override. */
export function liveE2eCredentials(): {
  email?: string;
  password?: string;
} {
  const env = backendTestEnv();
  return {
    email: process.env.LIVE_E2E_EMAIL || env.SUPABASE_TEST_EMAIL_A || undefined,
    password:
      process.env.LIVE_E2E_PASSWORD || env.SUPABASE_TEST_PASSWORD_A || undefined,
  };
}
