import test from "node:test";
import assert from "node:assert/strict";
import "../extension/lib/signals.js";

const S = globalThis.JevLensSignals;

// --- minimal DOM -------------------------------------------------------------------------------

function matchSelector(node, selector) {
  const attr = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
  if (attr) return String(node.attributes?.[attr[1]] ?? "") === attr[2];
  if (selector.startsWith(".")) return String(node.className || "").split(/\s+/).includes(selector.slice(1));
  return node.tagName === selector.toLowerCase();
}

function el(tag, options = {}) {
  const node = {
    tagName: tag.toLowerCase(),
    className: options.className || "",
    attributes: options.attributes || {},
    dataset: {},
    children: [],
    parentElement: null,
    display: options.display || "block",
    ownText: options.text || ""
  };

  node.appendChild = (child) => {
    child.parentElement = node;
    node.children.push(child);
    return child;
  };
  node.insertBefore = (child, ref) => {
    const index = ref ? node.children.indexOf(ref) : -1;
    if (index < 0) return node.appendChild(child);
    child.parentElement = node;
    node.children.splice(index, 0, child);
    return child;
  };
  node.prepend = (child) => node.insertBefore(child, node.children[0]);
  node.contains = (other) => {
    for (let cur = other; cur; cur = cur.parentElement) if (cur === node) return true;
    return false;
  };
  node.closest = (selector) => {
    for (let cur = node; cur; cur = cur.parentElement) if (matchSelector(cur, selector)) return cur;
    return null;
  };
  node.querySelectorAll = (selector) => {
    const out = [];
    const walk = (current) => {
      for (const child of current.children) {
        if (matchSelector(child, selector)) out.push(child);
        walk(child);
      }
    };
    walk(node);
    return out;
  };
  node.querySelector = (selector) => node.querySelectorAll(selector)[0] || null;
  Object.defineProperty(node, "textContent", {
    get: () => node.children.map(child => child.textContent).join("") + node.ownText,
    set: (value) => {
      node.children = [];
      node.ownText = value;
    }
  });

  for (const child of options.children || []) node.appendChild(child);
  return node;
}

globalThis.document = { createElement: (tag) => el(tag) };
globalThis.getComputedStyle = (node) => ({ display: node.display });

// --- ranking ------------------------------------------------------------------------------------

const cleanPost = {
  source: "jev_direct",
  labels: { political_content: "non_political", spam: "unlikely", bot_like: "unlikely" },
  risk: { spam: 0.04, bot_like: 0.02, adult_content: 0, adult_promo: 0, ai_farm: 0.05, traffic_manipulation: 0.03 },
  confidence: { political_content: 0.9, spam: 0.8 }
};

test("ranked keeps only the three highest-scoring categories, in order", () => {
  const result = {
    source: "jev_direct",
    labels: { political_content: "non_political" },
    risk: { spam: 0.81, bot_like: 0.42, adult_content: 0.1, adult_promo: 0.62, ai_farm: 0.3, traffic_manipulation: 0.55 },
    confidence: {}
  };
  const chips = S.ranked(result, {});
  assert.deepEqual(chips.map(c => c.key), ["spam", "adult_promo", "traffic_manipulation"]);
  assert.deepEqual(chips.map(c => c.score), [0.81, 0.62, 0.55]);
});

test("disabled display settings drop the category from the ranking", () => {
  const result = {
    source: "jev_direct",
    labels: {},
    risk: { spam: 0.81, bot_like: 0.42, adult_content: 0.7, adult_promo: 0.62, ai_farm: 0.3, traffic_manipulation: 0.55 },
    confidence: {}
  };
  const keys = S.ranked(result, { showSpam: false, showAdultContent: false }).map(c => c.key);
  assert.ok(!keys.includes("spam"));
  assert.ok(!keys.includes("adult_content"));
  assert.deepEqual(keys, ["adult_promo", "traffic_manipulation", "bot_like"]);
});

test("political chip only appears for political content and carries the tilt", () => {
  const political = {
    source: "jev_direct",
    labels: { political_content: "political", ideological_tilt: "right_leaning" },
    risk: { spam: 0.02, bot_like: 0, adult_content: 0, adult_promo: 0, ai_farm: 0, traffic_manipulation: 0.3 },
    confidence: { political_content: 0.88 },
    diagnostics: { answer_choices: { politicalContent: { probabilities: { political: 0.93, non_political: 0.05 } } } }
  };
  const top = S.ranked(political, {})[0];
  assert.equal(top.key, "political");
  assert.equal(top.label, "政治 · 偏右");
  assert.equal(S.pct(top.score), "93%");
  assert.match(top.title, /tilt=right_leaning/);

  assert.equal(S.politicalLikelihood(cleanPost), 0);
  assert.deepEqual(S.ranked(cleanPost, {}).map(c => c.key), ["ai_farm", "spam", "traffic_manipulation"]);
});

test("a non-political choice never produces a political chip, even with residual probability", () => {
  const result = {
    source: "jev_direct",
    labels: { political_content: "non_political" },
    risk: { spam: 0.4, bot_like: 0.3, adult_content: 0.2, adult_promo: 0.1, ai_farm: 0.05, traffic_manipulation: 0.6 },
    confidence: { political_content: 0.9 },
    diagnostics: { answer_choices: { politicalContent: { probabilities: { political: 0.18, non_political: 0.78, unclear: 0.04 } } } }
  };
  assert.equal(S.politicalLikelihood(result), 0);
  assert.ok(!S.candidates(result, {}).some(c => c.key === "political"));
  assert.ok(!S.ranked(result, {}).some(c => c.key === "political"));
  assert.doesNotMatch(S.describeCandidates(result, {}), /政治/);
});

test("an unclear political choice is shown as a question with its own probability", () => {
  const result = {
    source: "jev_direct",
    labels: { political_content: "unclear", ideological_tilt: "unclear" },
    risk: { spam: 0.05, bot_like: 0, adult_content: 0, adult_promo: 0, ai_farm: 0, traffic_manipulation: 0.1 },
    confidence: { political_content: 0.52 },
    diagnostics: { answer_choices: { politicalContent: { probabilities: { political: 0.52, non_political: 0.3, unclear: 0.18 } } } }
  };
  const top = S.ranked(result, {})[0];
  assert.equal(top.key, "political");
  assert.equal(top.label, "政治？");
  assert.equal(S.pct(top.score), "52%");
});

test("presentation follows the action mode and releases state it no longer wants", () => {
  assert.deepEqual(S.riskPresentation(0.9, { threshold: 0.68, actionMode: "dim" }), { risky: true, dim: true, collapse: false });
  assert.deepEqual(S.riskPresentation(0.9, { threshold: 0.68, actionMode: "collapse" }), { risky: true, dim: false, collapse: true });
  assert.deepEqual(S.riskPresentation(0.9, { threshold: 0.68, actionMode: "mark" }), { risky: true, dim: false, collapse: false });
  assert.deepEqual(S.riskPresentation(0.4, { threshold: 0.68, actionMode: "collapse" }), { risky: false, dim: false, collapse: false });
  assert.deepEqual(S.riskPresentation(0.4, { threshold: 0.3, actionMode: "dim" }), { risky: true, dim: true, collapse: false });
});

test("a post with no meaningful signal renders one muted chip instead of zeros", () => {
  const flat = {
    source: "local_fallback",
    labels: {},
    risk: { spam: 0, bot_like: 0, adult_content: 0, adult_promo: 0, ai_farm: 0, traffic_manipulation: 0 },
    confidence: {}
  };
  assert.deepEqual(S.ranked(flat, {}), []);

  const mount = el("div");
  S.renderSignalChips(mount, flat, {});
  assert.equal(mount.children.length, 1);
  assert.equal(mount.children[0].textContent, "無明顯訊號");
  assert.equal(mount.children[0].dataset.kind, "empty");
});

test("rendered chips carry the score and the risk level", () => {
  const result = {
    source: "jev_direct",
    labels: { political_content: "non_political", spam: "likely" },
    risk: { spam: 0.81, bot_like: 0.42, adult_content: 0, adult_promo: 0, ai_farm: 0, traffic_manipulation: 0 },
    confidence: { spam: 0.77 }
  };
  const mount = el("div");
  const chips = S.renderSignalChips(mount, result, { threshold: 0.68 });
  assert.deepEqual(mount.children.map(c => c.textContent), ["垃圾 81%", "Bot-like 42%"]);
  assert.equal(mount.children[0].dataset.risk, "high");
  assert.equal(mount.children[1].dataset.risk, "medium");
  assert.match(chips[0].title, /Jev confidence: 77%/);
});

test("local fallback results are not labelled as Jev confidence", () => {
  const result = {
    source: "local_fallback",
    labels: { spam: "likely" },
    risk: { spam: 0.8 },
    confidence: { spam: 0.6 }
  };
  assert.match(S.ranked(result, {})[0].title, /local confidence: 60%/);
});

// --- mount placement ----------------------------------------------------------------------------

test("threads row mounts above the post text inside the text column", () => {
  const article = el("article");
  const row = el("div", { display: "flex" });
  const avatar = el("div");
  const column = el("div", { display: "flex" });
  const header = el("span", { text: "@someone" });
  const body = el("span", { attributes: { dir: "auto" }, display: "inline", text: "內湖交通真的沒救" });
  column.appendChild(header);
  column.appendChild(body);
  row.appendChild(avatar);
  row.appendChild(column);
  article.appendChild(row);

  const mount = el("div", { className: "jevlens-analysis" });
  const where = S.mountInto(article, mount, "threads", { text: "內湖交通真的沒救" });

  assert.equal(where, "column");
  assert.equal(mount.parentElement, column);
  assert.deepEqual(column.children.map(c => c.ownText), ["@someone", "", "內湖交通真的沒救"]);
  assert.equal(article.children[0].children[0], avatar, "avatar must stay the first column of the row");
});

test("inline wrappers are skipped so the row never lands inside a link", () => {
  const article = el("article");
  const column = el("div");
  const anchor = el("a", { display: "inline" });
  const body = el("span", { attributes: { dir: "auto" }, display: "inline", text: "長文本" });
  anchor.appendChild(body);
  column.appendChild(anchor);
  article.appendChild(column);

  const mount = el("div");
  assert.equal(S.mountInto(article, mount, "threads", { text: "長文本" }), "column");
  assert.equal(mount.parentElement, column);
});

test("x row mounts directly above the tweet text", () => {
  const article = el("article", { attributes: { "data-testid": "tweet" } });
  const row = el("div", { display: "flex" });
  const avatar = el("div");
  const column = el("div", { display: "flex" });
  const userName = el("div", { attributes: { "data-testid": "User-Name" } });
  const text = el("div", { attributes: { "data-testid": "tweetText" }, text: "hello world" });
  column.appendChild(userName);
  column.appendChild(text);
  row.appendChild(avatar);
  row.appendChild(column);
  article.appendChild(row);

  const mount = el("div");
  assert.equal(S.mountInto(article, mount, "x", {}), "column");
  assert.equal(mount.parentElement, column);
  assert.deepEqual(column.children.map(c => c.tagName), ["div", "div", "div"]);
  assert.equal(column.children[1], mount);
});

test("post text blocks already injected by JevLens are ignored when re-mounting", () => {
  const article = el("article");
  const column = el("div");
  const body = el("span", { attributes: { dir: "auto" }, display: "inline", text: "真正的貼文" });
  const previous = el("div", { className: "jevlens-analysis" });
  previous.appendChild(el("span", { attributes: { dir: "auto" }, text: "圖 1/1 垃圾 80%" }));
  column.appendChild(body);
  column.appendChild(previous);
  article.appendChild(column);

  const mount = el("div");
  assert.equal(S.mountInto(article, mount, "threads", { text: "真正的貼文" }), "column");
  assert.equal(mount.parentElement, column);
});
