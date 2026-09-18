import { casesForProvider, scoreCase } from "./lib/eval-score.mjs";

await import("../extension/lib/heuristics.js");
await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");

const H = globalThis.JevLensHeuristics;
const cases = globalThis.JevLensEvalCases;
// Fixtures scoped to another provider (providers: ["jev"]) are skipped here on purpose: they exist
// to measure the model, and this deterministic baseline must not be tuned to answer them.
const selected = casesForProvider(cases, "local");

const groups = new Map();
let failures = 0;
for (const tc of selected) {
  const result = H[tc.kind](tc.features);
  const { checks } = scoreCase(tc, result);
  const split = tc.split || "regression";
  if (!groups.has(split)) groups.set(split, { passed: 0, total: 0, casesPassed: 0, casesTotal: 0 });
  const g = groups.get(split);
  g.casesTotal++;
  let casePass = true;
  for (const c of checks) {
    g.total++;
    if (c.ok) g.passed++;
    else {
      casePass = false;
      failures++;
      console.log(`FAIL ${tc.id} ${c.field}: got=${JSON.stringify(c.actual)} expected=${JSON.stringify(c.expected)}`);
    }
  }
  if (casePass) g.casesPassed++;
}

for (const [split, g] of groups) {
  console.log(`${split}: fields ${g.passed}/${g.total} (${(g.passed / g.total * 100).toFixed(1)}%), cases ${g.casesPassed}/${g.casesTotal}`);
}
const localCaseCount = cases.filter(tc => !Array.isArray(tc.providers) || tc.providers.includes("local")).length;
console.log(`total local-applicable cases: ${localCaseCount}, failed checks: ${failures}`);
