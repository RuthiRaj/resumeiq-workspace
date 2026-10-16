#!/usr/bin/env node
/**
 * Landing performance budget check (ADR-005).
 * Sums raw + gzip bytes of every JS chunk in the "/" initial graph and fails
 * when gzip exceeds the budget. Run after `npm run build` (e.g. in CI).
 *
 * Usage: node scripts/check-landing-budget.mjs [--budget-kb-gzip 150]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const nextDir = path.join(root, ".next");

const argIdx = process.argv.indexOf("--budget-kb-gzip");
const budgetKb =
  argIdx === -1 ? 150 : Number(process.argv[argIdx + 1]);
if (!Number.isFinite(budgetKb) || budgetKb <= 0) {
  console.error("Invalid --budget-kb-gzip value");
  process.exit(2);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(nextDir)) fail('No .next directory — run "npm run build" first.');

const files = new Set();

// Shared runtime chunks every App Router page loads.
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"),
  );
  for (const f of manifest.rootMainFiles ?? []) files.add(f);
} catch (e) {
  fail(`Could not read build-manifest.json: ${e.message}`);
}

// Route-specific chunks for "/" (the (marketing) page manifest).
const candidates = [
  "server/app/(marketing)/page_client-reference-manifest.js",
  "server/app/page_client-reference-manifest.js",
];
let manifestHit = null;
for (const c of candidates) {
  const p = path.join(nextDir, c);
  if (fs.existsSync(p)) {
    manifestHit = p;
    const src = fs.readFileSync(p, "utf8");
    for (const m of src.matchAll(/static\/chunks\/[A-Za-z0-9_.\-]+\.js/g)) {
      files.add(m[0]);
    }
    break;
  }
}
if (!manifestHit) fail("Could not find the (marketing) page client-reference manifest.");

let raw = 0;
let gzip = 0;
const rows = [];
for (const f of [...files].sort()) {
  const p = path.join(nextDir, f);
  if (!fs.existsSync(p)) {
    console.warn(`warning: chunk missing from disk: ${f}`);
    continue;
  }
  const buf = fs.readFileSync(p);
  const gz = zlib.gzipSync(buf).length;
  raw += buf.length;
  gzip += gz;
  rows.push({ file: f.split("/").pop(), raw: buf.length, gzip: gz });
}

console.log(`"/" initial JS (${rows.length} chunks, manifest: ${path.basename(path.dirname(manifestHit))}):`);
for (const r of rows.sort((a, b) => b.gzip - a.gzip)) {
  console.log(
    `  ${r.file}  ${(r.raw / 1024).toFixed(1)}KB raw / ${(r.gzip / 1024).toFixed(1)}KB gzip`,
  );
}
console.log(
  `TOTAL: ${(raw / 1024).toFixed(1)}KB raw / ${(gzip / 1024).toFixed(1)}KB gzip (budget: ${budgetKb}KB gzip)`,
);
if (gzip > budgetKb * 1024) {
  fail(
    `BUDGET EXCEEDED: ${(gzip / 1024).toFixed(1)}KB gzip > ${budgetKb}KB gzip. ` +
      `Cut initial JS on "/" or raise the budget deliberately (ADR-005).`,
  );
}
console.log("Budget check passed.");
