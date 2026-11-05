import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const source = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

function background({ apiKey = "", fallbackToLocal = true, fail = false } = {}) {
  const local = { typesafeApiKey: apiKey };
  const settings = { fallbackToLocal };
  let now = Date.now();
  let listener;
  let calls = 0;
  let shouldFail = fail;
  const storage = data => ({
    async get(keys) {
      if (keys == null) return { ...data };
      if (typeof keys === "string") return { [keys]: data[keys] };
      return { ...keys, ...data };
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; }
  });
  class Clock extends Date {
    static now() { return now; }
  }
  const context = vm.createContext({
    TextEncoder,
    crypto: webcrypto,
    Date: Clock,
    importScripts() {},
    JevLensJev: {
      MODEL: "jev-latest",
      async evaluate({ apiKey }) {
        calls++;
        if (!apiKey) throw new Error("missing API key");
        if (shouldFail) throw new Error("temporary service failure");
        return { source: "jev_direct", labels: {}, risk: {} };
      }
    },
    JevLensHeuristics: { social: () => ({ labels: {}, risk: {} }) },
    chrome: {
      storage: { local: storage(local), sync: storage(settings) },
      runtime: { onMessage: { addListener(value) { listener = value; } } }
    }
  });
  vm.runInContext(source, context, { filename: "background.js" });
  return {
    local,
    settings,
    get calls() { return calls; },
    recover() { shouldFail = false; },
    advance(ms) { now += ms; },
    classify() {
      return new Promise(resolve => listener({
        type: "CLASSIFY", kind: "social", features: { text: "synthetic cache fixture" }
      }, {}, resolve));
    }
  };
}

test("adding an API key retries Jev instead of reusing a cached local fallback", async () => {
  const app = background();
  assert.equal((await app.classify()).result.source, "local_fallback");
  app.local.typesafeApiKey = "synthetic-test-key";
  const response = await app.classify();
  assert.equal(response.result.source, "jev_direct");
  assert.equal(app.calls, 2);
});

test("a recovered Jev service is retried immediately after a fallback", async () => {
  const app = background({ apiKey: "synthetic-test-key", fail: true });
  assert.equal((await app.classify()).result.source, "local_fallback");
  app.recover();
  assert.equal((await app.classify()).result.source, "jev_direct");
  assert.equal(app.calls, 2);
});

test("disabling fallback rejects failures even when a local result is cached", async () => {
  const app = background();
  assert.equal((await app.classify()).result.source, "local_fallback");
  app.settings.fallbackToLocal = false;
  const response = await app.classify();
  assert.equal(response.ok, false);
  assert.equal(response.error, "missing API key");
  assert.equal(app.calls, 2);
});

test("no-key local fallbacks retain their short cache window", async () => {
  const app = background();
  await app.classify();
  const response = await app.classify();
  assert.equal(response.result.source, "local_fallback");
  assert.equal(response.result.cached, true);
  assert.equal(app.calls, 1);
  app.advance(5 * 60 * 1000);
  assert.equal((await app.classify()).result.cached, undefined);
  assert.equal(app.calls, 2);
});

test("successful Jev results retain their configured cache window", async () => {
  const app = background({ apiKey: "synthetic-test-key" });
  await app.classify();
  assert.equal((await app.classify()).result.cached, true);
  assert.equal(app.calls, 1);
  app.advance(24 * 3600 * 1000);
  assert.equal((await app.classify()).result.cached, undefined);
  assert.equal(app.calls, 2);
});
