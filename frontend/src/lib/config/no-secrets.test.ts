import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Repo guard: no private/secret key value may be committed anywhere.
 *
 * Fails `npm run test` if a secret-shaped value appears in any tracked file (or
 * a new, not-git-ignored one). It matches *values*, not words, so documentation
 * that says "the service_role key is never used" is allowed while an assigned
 * service_role key is not.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "supabase secret key", pattern: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  {
    name: "service_role key assignment",
    pattern: /(?:SUPABASE_)?SERVICE_ROLE(?:_KEY)?\s*[=:]\s*["']?[A-Za-z0-9._-]{16,}/i,
  },
  { name: "groq api key", pattern: /gsk_[A-Za-z0-9]{16,}/ },
  { name: "nvidia api key", pattern: /nvapi-[A-Za-z0-9_-]{16,}/ },
  { name: "github token", pattern: /github_pat_[A-Za-z0-9_]{16,}/ },
  { name: "openai-style key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "google api key", pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".cfg",
  ".css",
  ".example",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".mts",
  ".ps1",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const TEXT_FILENAMES = new Set(["Dockerfile", ".gitignore", ".prettierignore", ".prettierrc"]);

/** Names of every secret shape found in `text` (never the matched value). */
function scanText(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/** Repo root, derived from this file (`frontend/src/lib/config/`). */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** Tracked files plus new files that are not git-ignored. */
function listRepoFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function isScannable(file: string): boolean {
  const base = path.basename(file);
  return TEXT_FILENAMES.has(base) || TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

describe("repo secret guard", () => {
  it("detects the key shapes it claims to guard against", () => {
    // Built at runtime so this file itself never contains a literal secret shape.
    const serviceRole = ["SUPABASE_SERVICE_ROLE_KEY=", "x".repeat(40)].join("");
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "signature"].join(".");
    expect(scanText(serviceRole)).toContain("service_role key assignment");
    expect(scanText(jwt)).toContain("jwt");
    // Prose that names the key without assigning a value is allowed.
    expect(scanText("the service_role key is never used")).toEqual([]);
  });

  it("finds no secret-shaped value anywhere in the repo", () => {
    const root = repoRoot();
    const findings: string[] = [];
    for (const file of listRepoFiles(root)) {
      if (!isScannable(file)) continue;
      const text = readFileSync(path.join(root, file), "utf8");
      if (text.includes("\0")) continue; // binary
      for (const name of scanText(text)) findings.push(`${file} -> ${name}`);
    }
    expect(findings).toEqual([]);
  });
});
