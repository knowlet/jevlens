import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const content = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const signals = fs.readFileSync(new URL("../extension/lib/signals.js", import.meta.url), "utf8");

// Small, offline DOM fixture. Run the unmodified content-script entry point and real signals,
// with controllable Chrome replies/timers so interrupted feed analysis is deterministic.
function element(tag, attributes = {}, value = "") {
  const node = {
    tagName: tag, attributes, dataset: {}, children: [], parentElement: null,
    className: "", ownText: value,
    get isConnected() { return this.root || Boolean(this.parentElement?.isConnected); },
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(""); },
    set textContent(value) { this.replaceChildren(); this.ownText = value; },
    get innerText() { return this.textContent; },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1]; },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) {
      if (key.startsWith("data-")) {
        const name = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return this.dataset[name] ?? this.attributes[key] ?? null;
      }
      return this.attributes[key] ?? null;
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    },
    insertBefore(child, ref) {
      child.remove();
      const index = this.children.indexOf(ref);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      child.parentElement = this;
      return child;
    },
    appendChild(child) { return this.insertBefore(child, null); },
    append(...children) { children.forEach(child => this.appendChild(child)); },
    prepend(child) { this.insertBefore(child, this.children[0]); },
    replaceChildren(...children) {
      this.children.forEach(child => { child.parentElement = null; });
      this.children = [];
      this.ownText = "";
      this.append(...children);
    },
    contains(other) {
      for (let n = other; n; n = n.parentElement) if (n === this) return true;
      return false;
    },
    closest(selector) {
      for (let n = this; n; n = n.parentElement) if (matches(n, selector)) return n;
      return null;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(",").map(s => s.trim());
      const out = [];
      const walk = parent => parent.children.forEach(child => {
        if (selectors.some(s => s.startsWith(":scope > ")
          ? parent === this && matches(child, s.slice(9)) : matches(child, s))) out.push(child);
        walk(child);
      });
      walk(this);
      return out;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  node.classList = {
    contains: c => node.className.split(/\s+/).includes(c),
    add: c => { if (!node.classList.contains(c)) node.className = `${node.className} ${c}`.trim(); },
    remove: c => { node.className = node.className.split(/\s+/).filter(x => x !== c).join(" "); }
  };
  return node;
}

function matches(node, selector) {
  const tag = selector.match(/^[\w-]+/)?.[0];
  if (tag && tag !== node.tagName) return false;
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) {
    if (!node.classList.contains(name)) return false;
  }
  for (const [, key, op, value] of selector.matchAll(/\[([\w-]+)(?:([*^]?=)"([^"]*)")?\]/g)) {
    const actual = node.getAttribute(key);
    if (actual == null || (op === "=" && actual !== value)
      || (op === "^=" && !actual.startsWith(value)) || (op === "*=" && !actual.includes(value))) return false;
  }
  return true;
}

function fixture({ count = 1, settings = {}, deferSettings = false } = {}) {
  let current = { enabled: true, threshold: 0.68, actionMode: "collapse", ...settings };
  let onChanged;
  let onMutation;
  let nextTimer;
  const messages = [];
  const pendingSettings = [];
  const root = element("html");
  root.root = true;
  const hud = element("div");
  const status = element("span");
  status.className = "jevlens-hud-status";
  hud.append(status);
  root.append(hud);
  const posts = Array.from({ length: count }, (_, i) => {
    const post = element("article", { "data-testid": "tweet" });
    const column = element("div");
    column.append(element("span", { "data-testid": "User-Name" }, `@user${i}`));
    column.append(element("div", { "data-testid": "tweetText" }, `Synthetic post ${i}`));
    post.append(column);
    root.append(post);
    return post;
  });
  const context = {
    document: {
      documentElement: root,
      getElementById: () => hud,
      createElement: tag => element(tag),
      querySelectorAll: selector => root.querySelectorAll(selector)
    },
    getComputedStyle: () => ({ display: "block" }),
    location: { hostname: "x.com", href: "https://x.com/home" },
    chrome: {
      runtime: { sendMessage(message, callback) {
        if (message.type === "GET_SETTINGS") {
          if (deferSettings) pendingSettings.push({ callback, settings: { ...current } });
          else callback({ ok: true, settings: { ...current } });
        } else {
          assert.equal(message.type, "CLASSIFY");
          messages.push({ ...message, callback });
        }
      } },
      storage: { onChanged: { addListener(listener) { onChanged = listener; } } }
    },
    MutationObserver: class { constructor(callback) { onMutation = callback; } observe() {} },
    setTimeout(fn) { nextTimer = fn; return 1; },
    clearTimeout() { nextTimer = null; },
    setInterval() {}
  };
  vm.runInNewContext(signals + "\n" + content, context);
  return {
    posts, hud, status, messages, pendingSettings,
    async scan() { const fn = nextTimer; nextTimer = null; fn?.(); await settle(); },
    async rescan() { onMutation(); await this.scan(); },
    change(values, area = "sync") {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) =>
        [key, { oldValue: current[key], newValue: value }]));
      current = { ...current, ...values };
      onChanged(changes, area);
    },
    reply(index, risk = 0.9) {
      messages[index].callback({ ok: true, result: { source: "jev_direct", risk: { spam: risk }, labels: {} } });
    }
  };
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); }
function assertReleased(post) {
  assert.equal(post.classList.contains("jevlens-dim"), false);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.dataset.jevlensCollapse, undefined);
  assert.equal(post.querySelector(".jevlens-reveal"), null);
  assert.equal(post.querySelector('.jevlens-analysis[data-owner="jevlens"]'), null);
  assert.equal(post.dataset.jevlensDone, "0");
}

for (const mode of ["collapse", "dim"]) {
  test(`disabling restores an already ${mode}-filtered post and re-enabling analyzes again`, async () => {
    const f = fixture({ settings: { actionMode: mode } });
    await f.scan();
    f.reply(0);
    await settle();
    assert.equal(f.posts[0].classList.contains(mode === "dim" ? "jevlens-dim" : "jevlens-collapsed"), true);
    f.change({ enabled: false });
    await f.scan();
    assertReleased(f.posts[0]);
    assert.equal(f.status.textContent, "已停用");
    f.change({ enabled: true });
    await f.scan();
    assert.equal(f.messages.length, 2);
    f.reply(1, 0);
    await settle();
    assert.equal(f.posts[0].dataset.jevlensDone, "1");
    assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
    assert.equal(f.posts[0].classList.contains("jevlens-dim"), false);
  });
}

test("disabling releases locally blocked posts without classifying", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), true);
  assert.equal(f.messages.length, 0);
  f.change({ enabled: false });
  await f.scan();
  assertReleased(f.posts[0]);
});

test("late classifications cannot restore filtering or replace the disabled HUD", async () => {
  const f = fixture();
  await f.scan();
  f.change({ enabled: false });
  await f.scan();
  f.reply(0);
  await settle();
  assertReleased(f.posts[0]);
  assert.equal(f.status.textContent, "已停用");
  assert.notEqual(f.hud.dataset.state, "working");
});

test("disabling clears queued posts and ignores late errors", async () => {
  const f = fixture({ count: 6 });
  await f.scan();
  assert.equal(f.messages.length, 4);
  f.change({ enabled: false });
  await f.scan();
  for (const message of [...f.messages]) message.callback({ ok: false, error: "late failure" });
  await settle();
  assert.equal(f.messages.length, 4);
  f.posts.forEach(assertReleased);
  assert.equal(f.status.textContent, "已停用");
  assert.equal(f.hud.dataset.state, "ready");
  f.change({ enabled: true });
  await f.scan();
  assert.equal(f.messages.length, 8);
  for (let i = 4; i < 8; i++) f.reply(i, 0);
  await settle();
  assert.equal(f.messages.length, 10);
  f.reply(8, 0);
  f.reply(9, 0);
  await settle();
  assert.ok(f.posts.every(post => post.dataset.jevlensDone === "1"));
});

test("rapid disable/re-enable rejects older results without dropping the new pending key", async () => {
  const f = fixture();
  await f.scan();
  f.change({ enabled: false });
  f.change({ enabled: true });
  await f.scan();
  assert.equal(f.messages.length, 2);
  f.reply(0);
  await settle();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  assert.equal(f.posts[0].dataset.jevlensDone, "0");
  await f.rescan();
  assert.equal(f.messages.length, 2);
  f.reply(1, 0);
  await settle();
  assert.equal(f.posts[0].dataset.jevlensDone, "1");
});

test("an in-flight settings response cannot undo disabling", async () => {
  const f = fixture({ deferSettings: true });
  await f.scan();
  assert.equal(f.pendingSettings.length, 1);
  f.change({ enabled: false });
  await f.scan();
  f.pendingSettings[0].callback({ ok: true, settings: f.pendingSettings[0].settings });
  await settle();
  assert.equal(f.messages.length, 0);
  assert.equal(f.status.textContent, "已停用");
  assert.equal(f.posts[0].querySelector(".jevlens-analysis"), null);
});

test("changed action settings invalidate an older classification", async () => {
  const f = fixture();
  await f.scan();
  f.change({ actionMode: "mark" });
  await f.scan();
  assert.equal(f.messages.length, 2);
  f.reply(1);
  await settle();
  f.reply(0);
  await settle();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  assert.equal(f.posts[0].dataset.jevlensDone, "1");
});

test("background cache writes do not discard a valid classification", async () => {
  const f = fixture();
  await f.scan();
  f.change({ cache: {} }, "local");
  f.reply(0);
  await settle();
  assert.equal(f.messages.length, 1);
  assert.equal(f.posts[0].dataset.jevlensDone, "1");
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), true);
});
