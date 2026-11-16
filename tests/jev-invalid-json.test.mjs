import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

await import("../extension/lib/jev.js");
const J = globalThis.JevLensJev;
const options = { apiKey: "synthetic-key", kind: "social", features: { text: "fixture" } };

for (const kind of ["social", "article"]) {
  for (const raw of ["<html>temporary gateway page</html>", '{"answers":', ""]) {
    test(`${kind} rejects malformed success body ${JSON.stringify(raw)}`, async () => {
      let calls = 0;
      await assert.rejects(J.evaluate({ ...options, kind, retries: 2, fetchImpl: async () => {
        calls++;
        return new Response(raw, { status: 200 });
      } }), /TypeSafe returned invalid JSON/);
      assert.equal(calls, 1, "invalid successful payload is not automatically retried");
    });
  }
}

test("non-JSON authentication errors retain status diagnostics and do not retry", async () => {
  let calls = 0;
  await assert.rejects(J.evaluate({ ...options, fetchImpl: async () => {
    calls++;
    return new Response("unauthorized", { status: 401 });
  } }), error => error.status === 401 && /TypeSafe HTTP 401/.test(error.message));
  assert.equal(calls, 1);
});

test("non-JSON rate limits still retry and normalize the valid success", async () => {
  let calls = 0;
  const result = await J.evaluate({ ...options, retries: 1, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response("busy", { status: 429 }) : new Response(JSON.stringify({
      answers: { spam: { choice: "likely", probabilities: { likely: 0.9, possible: 0.1 } } }
    }), { status: 200 });
  } });
  assert.equal(calls, 2);
  assert.equal(result.source, "jev_direct");
  assert.equal(result.labels.spam, "likely");
  assert.ok(Math.abs(result.risk.spam - 0.95) < 1e-12);
});

for (const fallbackToLocal of [false, true]) {
  test(`background does not cache malformed JSON as direct Jev (fallback=${fallbackToLocal})`, async () => {
    let listener;
    const saved = {};
    const context = vm.createContext({
      TextEncoder, AbortController, setTimeout, clearTimeout, crypto: webcrypto,
      fetch: async () => new Response("<html>synthetic private content</html>", { status: 200 }),
      importScripts() {},
      JevLensHeuristics: { social: () => ({ kind: "social", labels: {}, risk: {} }) },
      chrome: {
        storage: {
          sync: { get: async defaults => ({ ...defaults, fallbackToLocal, imageAnalysisEnabled: false }) },
          local: {
            get: async key => typeof key === "object" ? { typesafeApiKey: "synthetic-key" } : {},
            set: async values => Object.assign(saved, structuredClone(values))
          }
        },
        runtime: { onMessage: { addListener(fn) { listener = fn; } } }
      }
    });
    vm.runInContext(fs.readFileSync(new URL("../extension/lib/jev.js", import.meta.url), "utf8"), context);
    vm.runInContext(fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8"), context);
    const response = await new Promise(resolve => listener(
      { type: "CLASSIFY", kind: "social", features: { text: "fixture" } }, {}, resolve
    ));
    if (fallbackToLocal) {
      assert.equal(response.ok, true);
      assert.equal(response.result.source, "local_fallback");
      assert.match(response.result.fallback_reason, /TypeSafe returned invalid JSON/);
      assert.equal(Object.values(saved)[0].value.source, "local_fallback");
    } else {
      assert.equal(response.ok, false);
      assert.match(response.error, /TypeSafe returned invalid JSON/);
      assert.deepEqual(saved, {});
    }
    assert.ok(!JSON.stringify(response).includes("synthetic private content"));
  });
}
