import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const entry = "  const observer = new MutationObserver";
const at = source.lastIndexOf(entry);
assert.ok(at >= 0, "content-script bootstrap marker exists");
const script = source.slice(0, at) + "  globalThis.showFixture = collapse;\n})();";

function element() {
  const labels = new Set();
  return {
    children: [], dataset: {}, removed: false,
    appendChild(child) { this.children.push(child); },
    prepend(child) { this.children.unshift(child); },
    remove() { this.removed = true; },
    classList: { contains: label => labels.has(label), add: label => labels.add(label) }
  };
}

function fixture() {
  const calls = [];
  const runtime = { sendMessage(message, done) { calls.push({ message, done }); } };
  const context = vm.createContext({
    JevLensSignals: {},
    chrome: { runtime, storage: { onChanged: { addListener() {} } } },
    document: { createElement: element }
  });
  vm.runInContext(script, context);
  const post = element();
  context.showFixture(post, "fixture", "@alice");
  return { calls, runtime, post, button: post.children[0].children[1] };
}

for (const scenario of ["storage error", "disconnected worker", "no reply payload"]) {
  test(`local block is retryable without removing the post after ${scenario}`, async () => {
    const { calls, runtime, post, button } = fixture();
    const click = button.onclick();
    assert.equal(calls[0].message.type, "LOCAL_BLOCK");
    assert.equal(calls[0].message.handle, "@alice");
    if (scenario === "storage error") {
      calls[0].done({ ok: false, error: "synthetic quota error" });
    } else {
      if (scenario === "disconnected worker") runtime.lastError = { message: "synthetic disconnect" };
      calls[0].done();
      delete runtime.lastError;
    }
    await click;
    assert.equal(post.removed, false);
    assert.equal(button.disabled, false);
    assert.match(button.textContent, /重試/);
    const retry = button.onclick();
    calls[1].done({ ok: true });
    await retry;
    assert.equal(post.removed, true);
  });
}

test("local block disables duplicate clicks until success is acknowledged", async () => {
  const { calls, post, button } = fixture();
  const first = button.onclick();
  const wasDisabled = button.disabled;
  const second = button.onclick();
  calls.forEach(call => call.done({ ok: true }));
  await Promise.all([first, second]);
  assert.equal(wasDisabled, true);
  assert.equal(calls.length, 1);
  assert.equal(post.removed, true);
});
