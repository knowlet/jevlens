// Jev-backed release gate.
//
// The deterministic local baseline cannot cover fixtures scoped to Jev (`providers: ["jev"]`), and
// that is exactly where the real-world semantic misses live: a fixture the rules are intentionally
// not allowed to solve with keywords can only be verified against the live model.
//
// Usage:
//   TYPESAFE_API_KEY=... npm run eval:jev
//   TYPESAFE_API_KEY=... npm run eval:jev -- --all              # every fixture Jev is asked about
//   TYPESAFE_API_KEY=... npm run eval:jev -- --split holdout
//
// The key is read from the environment only; it is never printed, logged, or written to disk.
// Exits non-zero when any case fails, so it can gate a release in CI.

import { casesForProvider, scoreCase } from "./lib/eval-score.mjs";

await import("../extension/lib/jev.js");
await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");

const Jev = globalThis.JevLensJev;
const cases = globalThis.JevLensEvalCases;

const argv = process.argv.slice(2);
const runAll = argv.includes("--all");
const splitIndex = argv.indexOf("--split");
const split = splitIndex >= 0 ? String(argv[splitIndex + 1] || "all") : "all";
const apiKey = String(process.env.TYPESAFE_API_KEY || "").trim();

if (!apiKey) {
  console.error("TYPESAFE_API_KEY is not set. Pass it for this command only, e.g.");
  console.error("  TYPESAFE_API_KEY=... npm run eval:jev");
  process.exit(2);
}

const selected = casesForProvider(cases, "jev", { split, onlyProviderScoped: !runAll });
if (!selected.length) {
  console.error(`no Jev fixtures for split=${split}${runAll ? "" : " that are scoped to providers: [\"jev\"]"}`);
  process.exit(2);
}

console.log(`${selected.length} fixture(s) · split=${split} · ${runAll ? "all Jev-applicable" : "Jev-scoped only"}`);

let failedCases = 0;
let failedChecks = 0;
let totalChecks = 0;

for (const testCase of selected) {
  process.stdout.write(`${testCase.id} ... `);

  let result = null;
  let error = null;
  try {
    result = await Jev.evaluate({
      apiKey,
      kind: testCase.kind,
      features: testCase.features,
      timeoutMs: 20000,
      retries: 1
    });
  } catch (err) {
    error = String(err?.message || err);
  }

  if (error) {
    failedCases++;
    console.log(`ERROR ${error}`);
    continue;
  }

  const { checks, pass } = scoreCase(testCase, result);
  totalChecks += checks.length;
  const failed = checks.filter(check => !check.ok);
  failedChecks += failed.length;
  if (!pass) failedCases++;

  console.log(pass ? "PASS" : "FAIL");
  for (const check of failed) {
    console.log(`    ${check.field}: got=${JSON.stringify(check.actual)} expected=${JSON.stringify(check.expected)}`);
  }
}

console.log(`\n${selected.length - failedCases}/${selected.length} cases passed · ${totalChecks - failedChecks}/${totalChecks} field checks passed`);
process.exit(failedCases ? 1 : 0);
