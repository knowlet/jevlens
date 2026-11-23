// Geometry check for the injected feed row.
//
// The feed row is the part users complain about visually, so this script renders mock Threads/X
// posts in headless Chrome with the real content.css and the real lib/signals.js inlined, injects
// the row the same way the content script does, and measures the resulting boxes.
//
// Checks per scenario:
//   - the post text does not move when the row is injected (no sideways shift)
//   - the row's left edge lines up with the post text column
//   - the row never extends past the column, even with every category chip rendered
//   - the page gains no horizontal overflow
//
// Usage: node scripts/layout-check.mjs            (override the binary with JEVLENS_CHROME)

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.join(here, "..", "extension");
const chrome = process.env.JEVLENS_CHROME || "google-chrome";

const css = readFileSync(path.join(extensionDir, "content.css"), "utf8");
const signals = readFileSync(path.join(extensionDir, "lib", "signals.js"), "utf8");
const content = readFileSync(path.join(extensionDir, "content.js"), "utf8");

const PAGE_SCRIPT = `
const RESULTS = [];
const STAGE_WIDTH = 420;
const POST_TEXT = "一開始叫在內湖工作的人搬去內湖，現在又說要蓋自行車橋解決內湖塞車，這不是何不食肉糜嗎？";
const RESULT = {
  source: "jev_direct",
  labels: {
    political_content: "political",
    ideological_tilt: "right_leaning",
    rhetorical_style: "high_arousal_opinion",
    spam: "likely",
    bot_like: "possible",
    adult_content: "possible",
    adult_promo: "unclear",
    ai_farm: "unlikely",
    traffic_manipulation: "possible",
    reply_quality: "not_applicable"
  },
  risk: { spam: 0.81, bot_like: 0.42, adult_content: 0.35, adult_promo: 0.12, ai_farm: 0.06, traffic_manipulation: 0.55 },
  confidence: { political_content: 0.9, spam: 0.78, bot_like: 0.61 },
  image_evidence: { analyzedCount: 1, visionStatus: "available", images: [] }
};

function buildPost(platform, articleDisplay) {
  const stage = document.createElement("div");
  stage.style.width = STAGE_WIDTH + "px";
  stage.style.boxSizing = "border-box";
  stage.style.margin = "0 0 24px";

  const article = document.createElement("article");
  article.style.display = articleDisplay;
  article.style.boxSizing = "border-box";
  article.style.padding = "16px";
  article.style.gap = "12px";
  article.style.background = "#fff";
  article.style.border = "1px solid #ddd";

  const avatar = document.createElement("div");
  avatar.style.flex = "0 0 40px";
  avatar.style.width = "40px";
  avatar.style.height = "40px";
  avatar.style.borderRadius = "50%";
  avatar.style.background = "#ccc";

  const column = document.createElement("div");
  column.style.flex = "1 1 auto";
  column.style.display = "flex";
  column.style.flexDirection = "column";
  column.style.minWidth = "0";

  const header = document.createElement("span");
  header.textContent = "@someone";
  column.appendChild(header);

  let textNode;
  if (platform === "x") {
    const userName = document.createElement("div");
    userName.setAttribute("data-testid", "User-Name");
    userName.textContent = "@someone";
    column.appendChild(userName);
    textNode = document.createElement("div");
    textNode.setAttribute("data-testid", "tweetText");
    column.appendChild(textNode);
  } else {
    textNode = document.createElement("span");
    textNode.setAttribute("dir", "auto");
    textNode.style.display = "inline";
    column.appendChild(textNode);
  }
  textNode.textContent = POST_TEXT;

  article.appendChild(avatar);
  article.appendChild(column);
  stage.appendChild(article);
  document.body.appendChild(stage);
  return { stage, article, avatar, column, textNode };
}

function buildRow(limit) {
  const mount = document.createElement("div");
  mount.className = "jevlens-analysis";
  mount.dataset.state = "high";

  const source = document.createElement("span");
  source.className = "jevlens-source";
  source.textContent = "Jev ✓";
  const kind = document.createElement("span");
  kind.className = "jevlens-quality";
  kind.textContent = "貼文";
  mount.appendChild(source);
  mount.appendChild(kind);
  mount.appendChild(JevLensSignals.textChip("圖", "1/1", "image analysis=available"));
  JevLensSignals.renderSignalChips(mount, RESULT, { threshold: 0.68 }, limit);
  return mount;
}

function rect(node) {
  const r = node.getBoundingClientRect();
  return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
}

for (const platform of ["threads", "x"]) {
  for (const articleDisplay of ["flex", "block"]) {
    for (const variant of ["top3", "all"]) {
      const post = buildPost(platform, articleDisplay);
      const before = rect(post.textNode);
      const mount = buildRow(variant === "top3" ? 3 : 99);
      const where = JevLensSignals.mountInto(post.article, mount, platform, { text: POST_TEXT });
      const after = rect(post.textNode);

      RESULTS.push({
        id: [platform, articleDisplay, variant].join("/"),
        platform,
        articleDisplay,
        variant,
        where,
        chipCount: mount.querySelectorAll(".jevlens-chip").length,
        chipText: [...mount.querySelectorAll(".jevlens-chip")].map(c => c.textContent),
        before,
        after,
        row: rect(mount),
        column: rect(post.column),
        avatar: rect(post.avatar),
        article: rect(post.article),
        stage: rect(post.stage),
        pageScrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      });
    }
  }
}

// Control case: the pre-0.5.1 injection point (prepend into the card itself). If prepending stops
// shifting the post text, the measurements above are not sensitive to the bug they are meant to catch.
{
  const post = buildPost("threads", "flex");
  const before = rect(post.textNode);
  const mount = buildRow(3);
  post.article.prepend(mount);
  RESULTS.push({
    id: "threads/flex/legacy-prepend",
    legacy: true,
    platform: "threads",
    articleDisplay: "flex",
    variant: "legacy",
    where: "legacy-prepend",
    chipCount: mount.querySelectorAll(".jevlens-chip").length,
    chipText: [...mount.querySelectorAll(".jevlens-chip")].map(c => c.textContent),
    before,
    after: rect(post.textNode),
    row: rect(mount),
    column: rect(post.column),
    avatar: rect(post.avatar),
    article: rect(post.article),
    stage: rect(post.stage),
    pageScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  });
}

document.getElementById("result").textContent = JSON.stringify(RESULTS);
`;

const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><style>
body { margin: 0; padding: 12px; background: #f6f7f9; font: 14px/1.5 sans-serif; }
${css}
</style></head>
<body><pre id="result"></pre><pre id="smoke"></pre>
<script>${signals}</script>
<script>${PAGE_SCRIPT}</script>
<script>
// Smoke test: content.js must still initialize against lib/signals.js. location.hostname is empty
// for a file:// page, so the content script scans nothing here; this only proves it loads.
//
// Headless --dump-dom does not return until the page's task queue is idle. content.js keeps a
// repeating URL timer and a document MutationObserver, and the observer schedules another timer
// every time the script touches the DOM. Virtual time never runs out of work, so Chrome waits
// forever. The measurements above are already recorded. This block only needs the script to run,
// so its timers must not stay scheduled.
(function () {
  var smoke = { loadError: null, api: false, missing: [] };
  window.chrome = {
    runtime: {
      lastError: null,
      getURL: function (value) { return value; },
      sendMessage: function (message, callback) { if (callback) callback({ ok: false, error: "harness" }); }
    },
    storage: { onChanged: { addListener: function () {} }, sync: { get: function (defaults, callback) { if (callback) callback(defaults); } } }
  };
  window.setTimeout = function () { return 0; };
  window.setInterval = function () { return 0; };
  window.clearTimeout = function () {};
  window.clearInterval = function () {};
  // A live observer plus the URL timer never lets headless Chrome go idle, so --dump-dom never
  // returns. The geometry above is already measured. This observer only has to accept observe().
  window.MutationObserver = function () {
    this.observe = function () {};
    this.disconnect = function () {};
    this.takeRecords = function () { return []; };
  };
  try {
    ${content}
  } catch (error) {
    smoke.loadError = String((error && error.message) || error);
  }
  var api = window.JevLensSignals;
  smoke.api = !!api;
  [
    "pct", "riskLevel", "labelText", "confidenceNote", "textChip", "renderSignalChips",
    "describeCandidates", "mountInto", "candidates", "ranked"
  ].forEach(function (key) { if (!api || typeof api[key] !== "function") smoke.missing.push(key); });
  document.getElementById("smoke").textContent = JSON.stringify(smoke);
})();
</script>
</body></html>`;

const workdir = mkdtempSync(path.join(tmpdir(), "jevlens-layout-"));
const page = path.join(workdir, "layout-check.html");
writeFileSync(page, html);

const chromeArgs = [
  "--headless=old",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--disable-breakpad",
  "--hide-scrollbars",
  "--window-size=900,2200"
];

// Headless Chrome on this host prints --dump-dom / writes --screenshot and then does not exit:
// the browser process stays up on a DevTools port after the page is done. Stop the process group
// once the output is complete instead of waiting for that exit.
function stopChrome(child) {
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
}

function launchChrome(args) {
  return spawn(chrome, [...chromeArgs, ...args], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
}

const shot = path.join(workdir, "layout.png");
const shotProc = launchChrome([
  `--user-data-dir=${path.join(workdir, "profile-shot")}`,
  `--screenshot=${shot}`,
  `file://${page}`
]);
const shotDeadline = Date.now() + 20000;
let lastSize = -1;
while (Date.now() < shotDeadline) {
  await new Promise(resolve => setTimeout(resolve, 200));
  let size = -1;
  try { size = statSync(shot).size; } catch { size = -1; }
  if (size > 1000 && size === lastSize) break;
  lastSize = size;
}
stopChrome(shotProc);
if (lastSize < 1000) {
  console.error("layout-check: screenshot was not written");
  process.exit(2);
}
const proof = process.env.JEVLENS_LAYOUT_SHOT || "/opt/cursor/artifacts/jevlens-feed-layout.png";
mkdirSync(path.dirname(proof), { recursive: true });
copyFileSync(shot, proof);

const domProc = launchChrome([
  `--user-data-dir=${path.join(workdir, "profile")}`,
  "--dump-dom",
  `file://${page}`
]);
let dom = "";
const domReady = new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    stopChrome(domProc);
    reject(new Error("layout-check: headless Chrome did not produce a DOM"));
  }, 20000);
  domProc.stdout.on("data", chunk => {
    dom += chunk;
    if (dom.includes("</html>")) {
      clearTimeout(timer);
      stopChrome(domProc);
      resolve();
    }
  });
  domProc.on("exit", () => {
    clearTimeout(timer);
    resolve();
  });
  domProc.on("error", error => {
    clearTimeout(timer);
    reject(error);
  });
});
await domReady;

const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!match || !match[1].trim()) {
  console.error("layout-check: the fixture produced no measurements");
  console.error(dom.slice(0, 2000));
  process.exit(2);
}

const results = JSON.parse(match[1]);
const EPSILON = 1.5;
let failures = 0;

const smokeMatch = dom.match(/<pre id="smoke">([\s\S]*?)<\/pre>/);
const smoke = smokeMatch && smokeMatch[1].trim() ? JSON.parse(smokeMatch[1]) : null;
if (!smoke) {
  failures++;
  console.log("FAIL  content.js smoke test  measurement missing");
} else if (smoke.loadError || !smoke.api || smoke.missing.length) {
  failures++;
  console.log(`FAIL  content.js smoke test  loadError=${smoke.loadError} api=${smoke.api} missing=${smoke.missing.join(", ")}`);
} else {
  console.log("PASS  content.js smoke test  loads against lib/signals.js");
}

for (const row of results) {
  if (row.legacy) {
    const shift = Math.abs(row.after.left - row.before.left);
    const detected = shift > EPSILON;
    failures += detected ? 0 : 1;
    console.log(`${detected ? "PASS" : "FAIL"}  ${row.id} (control)  post text shifted ${shift.toFixed(2)}px; row left ${row.row.left} vs avatar right ${row.avatar.right}`);
    continue;
  }

  const checks = [
    ["post text does not shift", Math.abs(row.after.left - row.before.left) <= EPSILON,
      `left ${row.before.left} -> ${row.after.left}`],
    ["row aligns with the text column", Math.abs(row.row.left - row.after.left) <= EPSILON,
      `row ${row.row.left} vs text ${row.after.left}`],
    ["row stays inside the column", row.row.right <= row.column.right + EPSILON,
      `row right ${row.row.right} vs column right ${row.column.right}`],
    ["row stays inside the card", row.row.right <= row.article.right - 8 + EPSILON,
      `row right ${row.row.right} vs card right ${row.article.right}`],
    ["no horizontal page overflow", row.pageScrollWidth <= row.innerWidth + EPSILON,
      `scrollWidth ${row.pageScrollWidth} vs viewport ${row.innerWidth}`]
  ];

  if (row.articleDisplay === "flex") {
    checks.push(["row never sits beside the avatar column", row.row.left >= row.avatar.right - EPSILON,
      `row left ${row.row.left} vs avatar right ${row.avatar.right}`]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  failures += failed.length;
  const status = failed.length ? "FAIL" : "PASS";
  console.log(`${status}  ${row.id}  mount=${row.where} chips=${row.chipCount} [${row.chipText.join(", ")}]`);
  for (const [name, ok, detail] of checks) {
    if (!ok) console.log(`        ✖ ${name}: ${detail}`);
  }
}

console.log(failures ? `\n${failures} layout check(s) failed` : `\nall ${results.length} scenarios passed`);
console.log(`fixture: ${page}`);
console.log(`screenshot: ${proof}`);
process.exit(failures ? 1 : 0);
