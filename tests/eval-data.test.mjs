import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../extension/eval-data.js");
await import("../extension/eval-holdout-data.js");
const cases = globalThis.JevLensEvalCases;

test("golden dataset has regression + holdout coverage", () => {
  assert.ok(Array.isArray(cases));
  assert.ok(cases.length >= 50);
  assert.ok(cases.some(c => c.split === "regression"));
  assert.ok(cases.some(c => c.split === "holdout"));
  assert.ok(cases.some(c => c.tags?.includes("politics")));
  assert.ok(cases.some(c => c.tags?.includes("spam")));
  assert.ok(cases.some(c => c.tags?.includes("adult")));
  assert.ok(cases.some(c => c.tags?.includes("ai-farm")));
  assert.ok(cases.some(c => c.tags?.includes("image")));
  assert.ok(cases.some(c => c.kind === "article"));
  assert.ok(cases.some(c => c.kind === "social"));
});

test("regression case encodes the screenshot expectation", () => {
  const c = cases.find(c => c.id === "threads-tw-policy-rage-001");
  assert.ok(c);
  assert.equal(c.features.isReply, false);
  assert.deepEqual(c.expected.labels.political_content, ["political"]);
  assert.deepEqual(c.expected.labels.ideological_tilt, ["unclear"]);
  assert.deepEqual(c.expected.labels.rhetorical_style, ["high_arousal_opinion"]);
  assert.deepEqual(c.expected.labels.reply_quality, ["not_applicable"]);
});

test("eval page assets exist", () => {
  for (const name of ["eval.html", "eval.js", "eval.css", "eval-data.js", "eval-holdout-data.js"]) {
    assert.equal(fs.existsSync(new URL(`../extension/${name}`, import.meta.url)), true, name);
  }
});


test("image adult-spam regression fixture includes deterministic visual evidence", () => {
  const c = cases.find(c => c.id === "threads-adult-image-spam-037");
  assert.ok(c);
  assert.equal(c.features.isReply, false);
  assert.equal(c.features.imageEvidence.visionStatus, "available");
  assert.equal(c.features.imageEvidence.images[0].visual.adult_visual, "explicit");
  assert.deepEqual(c.expected.labels.adult_content, ["likely"]);
  assert.deepEqual(c.expected.labels.adult_promo, ["likely"]);
});


test("real-world coded adult-spam false negative is retained as a Jev regression", () => {
  const c = cases.find(c => c.id === "threads-coded-adult-spam-038");
  assert.ok(c);
  assert.deepEqual(c.providers, ["jev"]);
  assert.equal(c.features.text, "日本有感謝季 台灣有畢業季 🌸:0918 1/2");
  assert.deepEqual(c.expected.labels.adult_promo, ["possible", "likely"]);
  assert.deepEqual(c.expected.labels.spam, ["possible", "likely"]);
});
