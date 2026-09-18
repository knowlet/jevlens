import test from "node:test";
import assert from "node:assert/strict";

await import("../extension/lib/heuristics.js");
await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");

const H = globalThis.JevLensHeuristics;
const cases = globalThis.JevLensEvalCases;

function allowed(v) { return Array.isArray(v) ? v : [v]; }
function checksFor(tc, result) {
  const checks = [];
  for (const [field, expected] of Object.entries(tc.expected?.labels || {})) {
    checks.push(allowed(expected).includes(result.labels?.[field]));
  }
  for (const [field, rule] of Object.entries(tc.expected?.risk || {})) {
    const actual = Number(result.risk?.[field]);
    let ok = Number.isFinite(actual);
    if (rule.min != null) ok = ok && actual >= Number(rule.min);
    if (rule.max != null) ok = ok && actual <= Number(rule.max);
    checks.push(ok);
  }
  return checks;
}

function score(split) {
  const selected = cases.filter(c => (c.split || "regression") === split && (!Array.isArray(c.providers) || c.providers.includes("local")));
  const all = selected.flatMap(tc => checksFor(tc, H[tc.kind](tc.features)));
  return { passed: all.filter(Boolean).length, total: all.length, accuracy: all.filter(Boolean).length / all.length };
}

test("local regression dataset stays fully green", () => {
  const s = score("regression");
  assert.equal(s.passed, s.total);
});

test("local synthetic holdout remains above the baseline floor", () => {
  const s = score("holdout");
  assert.ok(s.accuracy >= 0.85, `holdout field accuracy ${(s.accuracy * 100).toFixed(1)}% fell below 85%`);
});
