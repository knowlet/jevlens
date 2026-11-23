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
    tagName: tag, nodeType: 1, attributes, dataset: {}, children: [], parentElement: null,
    className: "", ownText: value,
    get childNodes() {
      const nodes = [];
      if (this.ownText) nodes.push({ nodeType: 3, nodeValue: this.ownText, textContent: this.ownText });
      nodes.push(...this.children);
      return nodes;
    },
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

function fixture({ count = 1, settings = {}, deferSettings = false, platform = "x" } = {}) {
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
    column.append(element(platform === "threads" ? "a" : "span", { "data-testid": "User-Name", ...(platform === "threads" ? { dir: "auto", href: `/@user${i}` } : {}) }, `@user${i}`));
    column.append(element("div", { "data-testid": "tweetText", ...(platform === "threads" ? { dir: "auto" } : {}) }, `Synthetic post ${i}`));
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
    getComputedStyle: node => {
      const style = String(node?.getAttribute?.("style") || "");
      const inlineDisplay = style.match(/display\s*:\s*([^;]+)/i)?.[1]?.trim();
      const inlineVisibility = style.match(/visibility\s*:\s*([^;]+)/i)?.[1]?.trim();
      let display = inlineDisplay || "block";
      if (!inlineDisplay && node?.parentElement?.classList?.contains("jevlens-collapsed")
        && !node?.classList?.contains("jevlens-reveal")) display = "none";
      return { display, visibility: inlineVisibility || "visible" };
    },
    location: { hostname: platform === "threads" ? "threads.com" : "x.com", href: `https://${platform === "threads" ? "threads.com" : "x.com"}/home` },
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
    attach(post) { root.append(post); },
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

function revealPost(post) {
  // The fixture supports descendant lookup through the reveal node.
  const show = post.querySelector(".jevlens-reveal").querySelector("button");
  show.onclick();
  return show;
}

test("local-block reveal survives repeated clicks and unchanged rescans", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@USER0"] } });
  await f.scan();
  const post = f.posts[0];
  const show = revealPost(post);
  show.onclick();
  for (let i = 0; i < 3; i++) await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.querySelector(".jevlens-reveal"), null);
  assert.equal(post.querySelector(".jevlens-analysis"), null);
  assert.equal(post.dataset.jevlensDone, "1");
  assert.equal(f.messages.length, 0);
});

test("a real setting change reapplies a local block and allows another reveal", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  revealPost(post);
  f.change({ threshold: 0.8 });
  await f.scan();
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  revealPost(post);
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(f.messages.length, 0);
});

test("removing and restoring a blocklist entry reprocesses the post", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  f.change({ localBlockedHandles: [] });
  await f.scan();
  assert.equal(f.messages.length, 1);
  f.reply(0, 0);
  await settle();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  f.change({ localBlockedHandles: ["@user0"] });
  await f.scan();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), true);
  revealPost(f.posts[0]);
  await f.rescan();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  assert.equal(f.messages.length, 1);
});

test("re-enabling reapplies a revealed local block without classification", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  revealPost(f.posts[0]);
  f.change({ enabled: false });
  await f.scan();
  assertReleased(f.posts[0]);
  f.change({ enabled: true });
  await f.scan();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), true);
  revealPost(f.posts[0]);
  await f.rescan();
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  assert.equal(f.messages.length, 0);
});

test("changed content and recycled authors do not inherit a local-block reveal", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  revealPost(post);
  post.querySelector('[data-testid="tweetText"]').textContent = "A different synthetic post";
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  assert.equal(f.messages.length, 0);
  revealPost(post);
  post.querySelector('[data-testid="User-Name"]').textContent = "@other";
  await f.rescan();
  assert.equal(f.messages.length, 1);
  f.reply(0, 0);
  await settle();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.dataset.jevlensDone, "1");
});

test("Threads local-block reveal survives rescans and changed text is reprocessed", async () => {
  const f = fixture({ platform: "threads", settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  revealPost(post);
  await f.rescan();
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  post.querySelector('[data-testid="tweetText"]').textContent = "Changed synthetic Threads post";
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  assert.equal(f.messages.length, 0);
});

function nestQuote(outer) {
  const nested = element("article", { "data-testid": "tweet" });
  const column = element("div");
  column.append(element("span", { "data-testid": "User-Name" }, "@quoted"));
  column.append(element("div", { "data-testid": "tweetText" }, "Quoted words from an embedded post"));
  nested.append(column);
  outer.children[0].append(nested);
  return nested;
}

test("blocking an outer post leaves a nested post's pending analysis row", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  const outer = f.posts[0];
  const nested = nestQuote(outer);
  await f.scan();
  const rows = [...outer.querySelectorAll('.jevlens-analysis[data-owner="jevlens"]')];
  assert.equal(rows.length, 1);
  assert.equal(nested.contains(rows[0]), true);
  assert.equal(rows[0].dataset.state, "pending");
  assert.equal(rows[0].dataset.jevlensOwner, nested.dataset.jevlensPost);
  assert.notEqual(rows[0].dataset.jevlensOwner, outer.dataset.jevlensPost);
  assert.equal(outer.classList.contains("jevlens-collapsed"), true);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].features.handle, "@quoted");
  f.reply(0, 0);
  await settle();
  assert.equal(nested.contains(rows[0]), true);
  assert.equal(rows[0].dataset.state, "low");
  assert.equal(nested.classList.contains("jevlens-collapsed"), false);
  revealPost(outer);
  await f.rescan();
  assert.equal(outer.classList.contains("jevlens-collapsed"), false);
  assert.equal(outer.querySelector(":scope > .jevlens-reveal"), null);
  assert.equal(nested.contains(rows[0]), true);
  assert.equal(rows[0].dataset.state, "low");
  assert.equal(f.messages.length, 1);
});

test("a reused card drops the previous reveal button", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  assert.ok(post.querySelector(":scope > .jevlens-reveal"));
  post.querySelector('[data-testid="User-Name"]').textContent = "@someoneelse";
  post.querySelector('[data-testid="tweetText"]').textContent = "A recycled card with different words";
  await f.rescan();
  assert.equal(post.querySelector(".jevlens-reveal"), null);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.dataset.jevlensReveal, undefined);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].features.handle, "@someoneelse");
});

test("a detached card does not stay revealed after a settings toggle", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  revealPost(post);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  const revealed = post.dataset.jevlensReveal;
  assert.ok(revealed);
  post.remove();
  assert.equal(post.isConnected, false);
  f.change({ threshold: 0.5 });
  assert.equal(post.dataset.jevlensReveal, undefined);
  assert.equal(post.dataset.jevlensDone, "0");
  f.attach(post);
  await f.scan();
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  assert.ok(post.querySelector(":scope > .jevlens-reveal"));
  assert.notEqual(post.dataset.jevlensReveal, revealed);
});

test("video layout size does not retire a manual reveal", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  const post = f.posts[0];
  const size = { width: 320, height: 180 };
  const video = element("video", { poster: "https://cdn.example/clip.jpg" });
  video.poster = "https://cdn.example/clip.jpg";
  video.getBoundingClientRect = () => ({ width: size.width, height: size.height });
  post.append(video);
  await f.scan();
  revealPost(post);
  const key = post.dataset.jevlensKey;
  assert.equal(post.dataset.jevlensReveal, key);
  size.width = 960;
  size.height = 540;
  await f.rescan();
  assert.equal(post.dataset.jevlensKey, key);
  assert.equal(post.dataset.jevlensReveal, key);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(f.messages.length, 0);
  video.poster = "https://cdn.example/other-clip.jpg";
  video.setAttribute("poster", video.poster);
  await f.rescan();
  assert.notEqual(post.dataset.jevlensKey, key);
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
});

test("a Threads dir=auto span inside a hidden wrapper is not classified", async () => {
  const f = fixture({ platform: "threads" });
  const post = f.posts[0];
  const hidden = element("div", { style: "display: none" });
  hidden.append(element("span", { dir: "auto" }, "Hidden wrapper sentence that is longer than the visible post"));
  post.append(hidden);
  await f.scan();
  assert.equal(f.messages.length, 1);
  const body = f.messages[0].features.text;
  assert.match(body, /Synthetic post 0/);
  assert.equal(body.includes("Hidden wrapper sentence"), false);
});

test("a recycled card with a new status id does not keep a blocked reveal", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  const post = f.posts[0];
  const link = element("a", { href: "/alice/status/111" });
  post.append(link);
  await f.scan();
  revealPost(post);
  const revealed = post.dataset.jevlensReveal;
  assert.equal(post.dataset.jevlensKey, revealed);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  link.setAttribute("href", "/alice/status/222");
  await f.rescan();
  assert.notEqual(post.dataset.jevlensKey, revealed);
  assert.equal(post.dataset.jevlensReveal, undefined);
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  assert.equal(f.messages.length, 0);
});

test("detaching a card without a settings change keeps its reveal", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  await f.scan();
  const post = f.posts[0];
  revealPost(post);
  const revealed = post.dataset.jevlensReveal;
  post.remove();
  await f.rescan();
  f.attach(post);
  await f.rescan();
  assert.equal(post.dataset.jevlensReveal, revealed);
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(f.messages.length, 0);
});

test("hidden text is not sent to the classifier", async () => {
  const f = fixture();
  const post = f.posts[0];
  const tweet = post.querySelector('[data-testid="tweetText"]');
  tweet.append(element("span", { hidden: "" }, "secret hidden phrase"));
  tweet.append(element("span", { style: "display: none" }, "stylesheet hidden phrase"));
  tweet.append(element("span", { style: "visibility: hidden" }, "visibility hidden phrase"));
  await f.scan();
  assert.equal(f.messages.length, 1);
  const body = f.messages[0].features.text;
  assert.match(body, /Synthetic post 0/);
  assert.equal(body.includes("secret hidden phrase"), false);
  assert.equal(body.includes("stylesheet hidden phrase"), false);
  assert.equal(body.includes("visibility hidden phrase"), false);
});

test("a manual reveal survives the next scan", async () => {
  const f = fixture({ settings: { localBlockedHandles: ["@user0"] } });
  const post = f.posts[0];
  // No dedicated text node: the card text includes the reveal banner unless extraction ignores it.
  delete post.querySelector('[data-testid="tweetText"]').attributes["data-testid"];
  await f.scan();
  assert.equal(post.classList.contains("jevlens-collapsed"), true);
  const keyWhileOpen = post.dataset.jevlensKey;
  await f.rescan();
  assert.equal(post.dataset.jevlensKey, keyWhileOpen);
  revealPost(post);
  assert.equal(post.dataset.jevlensReveal, keyWhileOpen);
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.querySelector(":scope > .jevlens-reveal"), null);
  // The scanner has to honor the stored decision even if this version is queued again.
  post.dataset.jevlensDone = "0";
  await f.rescan();
  assert.equal(post.classList.contains("jevlens-collapsed"), false);
  assert.equal(post.querySelector(":scope > .jevlens-reveal"), null);
  assert.equal(post.dataset.jevlensReveal, keyWhileOpen);
  assert.equal(post.dataset.jevlensDone, "1");
  assert.equal(f.messages.length, 0);
});

test("a new local block replaces prior dim styling before manual reveal", async () => {
  const f = fixture({ settings: { actionMode: "dim" } });
  await f.scan();
  f.reply(0);
  await settle();
  assert.equal(f.posts[0].classList.contains("jevlens-dim"), true);
  f.change({ localBlockedHandles: ["@user0"] });
  await f.scan();
  revealPost(f.posts[0]);
  await f.rescan();
  assert.equal(f.posts[0].classList.contains("jevlens-dim"), false);
  assert.equal(f.posts[0].classList.contains("jevlens-collapsed"), false);
  assert.equal(f.posts[0].querySelector(".jevlens-analysis"), null);
  assert.equal(f.messages.length, 1);
});
