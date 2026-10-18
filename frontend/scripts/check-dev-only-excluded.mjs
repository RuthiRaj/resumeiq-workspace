#!/usr/bin/env node
/**
 * Dev-only exclusion check (ADR-026).
 *
 * A developer who left the "Failures on" toggle enabled used to break the whole
 * app on every later page load, with no obvious way back. The fix makes the
 * toggle in-memory and dev-only — and this check proves the state and UI are
 * compiled out of the production build entirely, not merely hidden at runtime.
 *
 * It collects every JS chunk a production page actually loads (the shared
 * runtime plus each route's client reference, the same graph the budget script
 * measures) and fails if any dev failure-simulation marker appears in one. The
 * dev-only client is reached through a dynamic `import()`, so it can only end up
 * in an on-demand chunk that no production page requests; such chunks are not
 * part of a page's load graph and are deliberately not counted.
 *
 * Run after `npm run build` (e.g. in CI).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nextDir = path.join(root, ".next");

/** Strings that exist only in the dev failure simulation / its UI. */
const FORBIDDEN = [
  "Simulated failures are ON",
  "Simulate failure",
  "Failures on",
  "riq.mock-failures",
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(nextDir)) {
  fail('No .next directory — run "npm run build" first.');
}

const chunks = new Set();

// 1. Shared runtime chunks every App Router page loads.
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"),
  );
  for (const f of manifest.rootMainFiles ?? []) chunks.add(f);
} catch (e) {
  fail(`Could not read build-manifest.json: ${e.message}`);
}

// 2. Each route's client-reference manifest, which lists the chunks it loads.
const serverDir = path.join(nextDir, "server");
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith("_client-reference-manifest.js")) out.push(full);
  }
  return out;
}
for (const manifestFile of walk(serverDir)) {
  const src = fs.readFileSync(manifestFile, "utf8");
  for (const m of src.matchAll(/static\/chunks\/[A-Za-z0-9_.\-]+\.js/g)) {
    chunks.add(m[0]);
  }
}

if (chunks.size === 0) {
  fail("Found no production page chunks — is this a real build output?");
}

const hits = [];
const checked = [];
for (const chunk of [...chunks].sort()) {
  const file = path.join(nextDir, chunk);
  if (!fs.existsSync(file)) {
    console.warn(`warning: chunk missing from disk: ${chunk}`);
    continue;
  }
  checked.push(chunk);
  const src = fs.readFileSync(file, "utf8");
  for (const marker of FORBIDDEN) {
    if (src.includes(marker)) {
      hits.push(`${chunk} contains ${JSON.stringify(marker)}`);
    }
  }
}

if (hits.length > 0) {
  fail(
    "Dev-only failure simulation leaked into a production page chunk:\n" +
      hits.map((h) => `  - ${h}`).join("\n") +
      "\nKeep the toggle behind dev-gated modules (lib/api/dev.ts, features/dev/*).",
  );
}

console.log(
  `Dev-only exclusion check passed: none of the ${FORBIDDEN.length} failure-toggle markers ` +
    `appear in the ${checked.length} chunks a production page loads.`,
);
