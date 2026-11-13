import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function harness(initial = ["@existing"]) {
  let listener;
  const state = { localBlockedHandles: [...initial], threshold: 0.42 };
  const calls = { reads: 0, writes: 0 };
  const sync = {
    async get(defaults) {
      calls.reads++;
      return structuredClone({ ...defaults, ...state });
    },
    async set(items) { calls.writes++; Object.assign(state, structuredClone(items)); }
  };
  const context = vm.createContext({
    importScripts() {},
    chrome: { storage: { sync }, runtime: { onMessage: { addListener(fn) { listener = fn; } } } }
  });
  vm.runInContext(source, context);
  function send(handle) {
    return new Promise(resolve => {
      assert.equal(listener({ type: "LOCAL_BLOCK", handle }, {}, r => resolve(structuredClone(r))), true);
    });
  }
  return { state, calls, sync, send };
}

test("concurrent different handles are all saved in request order", async () => {
  const h = harness();
  const replies = await Promise.all([h.send("@Alice"), h.send("@Bob"), h.send("@Carol")]);
  assert.deepEqual(replies.map(r => r.ok), [true, true, true]);
  assert.deepEqual(h.state.localBlockedHandles, ["@existing", "@alice", "@bob", "@carol"]);
  assert.deepEqual(replies[0].handles, ["@existing", "@alice"]);
  assert.equal(h.state.threshold, 0.42);
});

test("concurrent repeated handles remain deduplicated", async () => {
  const h = harness();
  const replies = await Promise.all([h.send("@ALICE"), h.send("@alice"), h.send("@Alice")]);
  assert.ok(replies.every(r => r.ok));
  assert.deepEqual(h.state.localBlockedHandles, ["@existing", "@alice"]);
});

test("a pending write finishes before the next operation reads", async () => {
  const h = harness();
  const gate = deferred();
  const set = h.sync.set;
  let first = true;
  h.sync.set = async items => {
    if (first) { first = false; await gate.promise; }
    return set(items);
  };
  const a = h.send("@alice");
  await settle();
  const b = h.send("@bob");
  await settle();
  // Always release the held operation, even if the serialization assertion fails.
  const readsWhileWritePending = h.calls.reads;
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(readsWhileWritePending, 1);
  assert.deepEqual(h.state.localBlockedHandles, ["@existing", "@alice", "@bob"]);
});

for (const operation of ["get", "set"]) {
  test(`${operation} failure does not poison queued or later requests`, async () => {
    const h = harness();
    const original = h.sync[operation];
    let first = true;
    h.sync[operation] = async (...args) => {
      if (first) { first = false; throw new Error(`${operation} failed`); }
      return original(...args);
    };
    const [failed, recovered] = await Promise.all([h.send("@failed"), h.send("@next")]);
    assert.deepEqual(failed, { ok: false, error: `${operation} failed` });
    assert.deepEqual(recovered, { ok: true, handles: ["@existing", "@next"] });
    assert.deepEqual(await h.send("@later"), { ok: true, handles: ["@existing", "@next", "@later"] });
    assert.deepEqual(h.state.localBlockedHandles, ["@existing", "@next", "@later"]);
  });
}

test("existing order, exact deduplication and falsy filtering are preserved", async () => {
  const h = harness(["@z", "@a", "@z", "", "@UPPER"]);
  assert.deepEqual(await h.send("@A"), { ok: true, handles: ["@z", "@a", "@UPPER"] });
  assert.deepEqual(await h.send(""), { ok: true, handles: ["@z", "@a", "@UPPER"] });
  assert.deepEqual(await h.send(" @B "), { ok: true, handles: ["@z", "@a", "@UPPER", " @b "] });
});

test("the existing list is retained without introducing an item cap", async () => {
  const initial = Array.from({ length: 200 }, (_, i) => `@handle${i}`);
  const h = harness(initial);
  await Promise.all([h.send("@new1"), h.send("@new2")]);
  assert.deepEqual(h.state.localBlockedHandles, [...initial, "@new1", "@new2"]);
});
