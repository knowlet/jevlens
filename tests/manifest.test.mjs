import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("manifest injects into current Threads domains", () => {
  const matches = manifest.content_scripts?.[0]?.matches || [];
  assert.ok(matches.includes("https://threads.com/*"));
  assert.ok(matches.includes("https://www.threads.com/*"));
});

test("manifest injects into X and permits direct TypeSafe API", () => {
  const matches = manifest.content_scripts?.[0]?.matches || [];
  assert.ok(matches.includes("https://x.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.typesafe.ai/*"));
});


test("manifest enables offscreen local image analysis and social media CDNs", () => {
  assert.ok(manifest.permissions.includes("offscreen"));
  assert.ok(manifest.host_permissions.includes("https://pbs.twimg.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.cdninstagram.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.fbcdn.net/*"));
});

test("signal helpers load before the feed content script", () => {
  const js = manifest.content_scripts?.[0]?.js || [];
  assert.ok(js.includes("lib/signals.js"));
  assert.ok(js.indexOf("lib/signals.js") < js.indexOf("content.js"));
});
