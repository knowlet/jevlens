await import("../extension/lib/heuristics.js");
await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");

const H = globalThis.JevLensHeuristics;
const cases = globalThis.JevLensEvalCases;

function allowed(v) { return Array.isArray(v) ? v : [v]; }
function score(tc, result) {
  const checks = [];
  for (const [field, expected] of Object.entries(tc.expected?.labels || {})) {
    const actual = result.labels?.[field];
    checks.push({ field, ok: allowed(expected).includes(actual), actual, expected: allowed(expected) });
  }
  for (const [field, rule] of Object.entries(tc.expected?.risk || {})) {
    const actual = Number(result.risk?.[field]);
    let ok = Number.isFinite(actual);
    if (rule.min != null) ok = ok && actual >= Number(rule.min);
    if (rule.max != null) ok = ok && actual <= Number(rule.max);
    checks.push({ field: `risk.${field}`, ok, actual, expected: rule });
  }
  return checks;
}

const groups = new Map();
let failures = 0;
for (const tc of cases) {
  if (Array.isArray(tc.providers) && !tc.providers.includes("local")) continue;
  const result = H[tc.kind](tc.features);
  const checks = score(tc, result);
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
