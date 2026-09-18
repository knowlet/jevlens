import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const content = fs.readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const background = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const signals = fs.readFileSync(new URL("../extension/lib/signals.js", import.meta.url), "utf8");

test("social feed rendering distinguishes post from reply", () => {
  assert.match(content, /textContent = "貼文"/);
  assert.match(content, /features\?\.isReply/);
});

test("reply detection is not based only on permalink URL", () => {
  assert.doesNotMatch(content, /isReply:\s*location\.pathname\.includes\("\/post\/"\)/);
  assert.match(content, /explicitReplySignal/);
});

test("classifier cache includes a schema version", () => {
  assert.match(background, /CLASSIFIER_SCHEMA/);
  assert.match(background, /schema:\s*CLASSIFIER_SCHEMA/);
});


test("social extraction and background pipeline include image analysis", () => {
  assert.match(content, /function extractMedia/);
  assert.match(content, /images:\s*extractMedia\(article\)/);
  assert.match(signals, /成人內容/);
  assert.match(background, /ANALYZE_IMAGES/);
  assert.match(background, /imageAnalysisEnabled/);
  assert.match(background, /image_evidence/);
});

test("the feed row renders only the highest-scoring categories", () => {
  assert.match(content, /renderSignalChips\(mount, result, s\)/);
  assert.match(signals, /DEFAULT_LIMIT = 3/);
  assert.doesNotMatch(content, /resultChip\("垃圾"/);
});

test("the feed row is mounted inside the post text column", () => {
  assert.match(content, /mountInto\(el, mount, platform, features\)/);
  assert.match(signals, /function mountInto/);
  assert.doesNotMatch(content, /insertAdjacentElement\("afterend", mount\)/);
});
