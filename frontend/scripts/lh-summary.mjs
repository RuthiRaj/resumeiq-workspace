#!/usr/bin/env node
/** Print one-line Lighthouse category scores + key metrics for a report file. */
import fs from "node:fs";

const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file, "utf8"));
const m = r.audits.metrics.details.items[0];
const c = r.categories;
console.log(
  `${file}: perf ${Math.round(c.performance.score * 100)}` +
    ` a11y ${Math.round(c.accessibility.score * 100)}` +
    ` BP ${Math.round(c["best-practices"].score * 100)}` +
    ` FCP ${Math.round(m.firstContentfulPaint)}` +
    ` LCP ${Math.round(m.largestContentfulPaint)}` +
    ` TBT ${Math.round(m.totalBlockingTime)}` +
    ` CLS ${m.cumulativeLayoutShift}`,
);
