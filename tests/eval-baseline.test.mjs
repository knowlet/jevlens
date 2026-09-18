import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { casesForProvider, scoreCase } from "../scripts/lib/eval-score.mjs";

await import("../extension/lib/heuristics.js");
await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");

const H = globalThis.JevLensHeuristics;
const cases = globalThis.JevLensEvalCases;

function score(split) {
  const selected = casesForProvider(cases, "local", { split });
  const all = selected.flatMap(tc => scoreCase(tc, H[tc.kind](tc.features)).checks.map(check => check.ok));
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

test("the real-world coded adult-spam case is gated on Jev, not on the local baseline", () => {
  const jevScoped = casesForProvider(cases, "jev", { onlyProviderScoped: true });
  assert.deepEqual(jevScoped.map(c => c.id), ["threads-coded-adult-spam-038"]);

  // It must stay out of the local baseline: teaching the keyword rules this one caption is overfitting.
  assert.ok(!casesForProvider(cases, "local").some(c => c.id === "threads-coded-adult-spam-038"));

  // ...which means the Jev gate is the only automated way to verify it, so it has to exist.
  assert.equal(fs.existsSync(new URL("../scripts/jev-eval.mjs", import.meta.url)), true);
});
