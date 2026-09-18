import test from "node:test";
import assert from "node:assert/strict";

await import("../extension/lib/heuristics.js");
const H = globalThis.JevLensHeuristics;

test("adult promo reply gets elevated risk", () => {
  const r = H.social({
    text: "18+ 私密照 點我主頁 加LINE 免費影片",
    displayName: "VIP",
    handle: "@vip999999",
    platform: "x"
  });
  assert.ok(r.risk.adult_promo >= 0.6);
});

test("substantive reply is not automatically spam", () => {
  const r = H.social({
    text: "The benchmark uses a different tokenizer, so tokens/sec is not directly comparable.",
    handle: "@researcher",
    platform: "x"
  });
  assert.ok(r.risk.spam < 0.38);
});

test("political content is descriptive and may remain unclear", () => {
  const r = H.article({
    title: "立法院審議新法案",
    content: "立法院今日針對法案內容進行逐條審查，朝野立委分別提出修正意見。"
  });
  assert.equal(r.labels.political_content, "political");
  assert.ok(["unclear", "mixed_or_center"].includes(r.labels.ideological_tilt));
});

test("clickbait/rage signals are detected without truth claim", () => {
  const r = H.article({
    title: "震驚！真相曝光，你不會相信最後發生什麼",
    content: "網友全炸鍋。一定要看！分享出去讓更多人看到。"
  });
  assert.notEqual(r.labels.traffic_strategy, "normal");
});

test("Threads policy critique regression: original post is political high-arousal commentary, not a reply", () => {
  const r = H.social({
    platform: "threads",
    handle: "@mark_stranger",
    isReply: false,
    text: "一開始叫在內湖工作的人搬去內湖，這樣就不會有塞車問題，現在是要蓋自行車橋解決內湖交通問題。原來造成內湖交通塞車的元兇是腳踏車呀！真的！我千想萬想都想不出如此智障的政見！"
  });
  assert.equal(r.labels.political_content, "political");
  assert.equal(r.labels.ideological_tilt, "unclear");
  assert.equal(r.labels.rhetorical_style, "high_arousal_opinion");
  assert.equal(r.labels.reply_quality, "not_applicable");
  assert.equal(r.labels.spam, "unlikely");
  assert.ok(r.risk.spam < 0.2);
});

test("original posts do not get reply-quality labels", () => {
  const r = H.social({ platform: "x", isReply: false, text: "PostgreSQL planner regression reproduced on 19beta1." });
  assert.equal(r.labels.reply_quality, "not_applicable");
});


test("image evidence elevates adult-content, adult-promo and spam risk", () => {
  const r = H.social({
    platform: "threads",
    handle: "@andrestorres_cg",
    isReply: false,
    text: "日本有感謝季 台灣有畢業季 🌸:0918 1/2",
    imageEvidence: {
      analyzedCount: 1,
      visionStatus: "available",
      images: [{
        visual: {
          adult_visual: "explicit",
          adult_promo_visual: "likely",
          contact_or_subscription_cta: true,
          nudity: true,
          sexual_pose: true
        },
        ocr: { text: "18+ 私密內容 私訊看" },
        qr: { values: [] },
        pixelSignals: { skin_fraction: 0.5 }
      }]
    }
  });
  assert.equal(r.labels.adult_content, "likely");
  assert.equal(r.labels.adult_promo, "likely");
  assert.ok(r.risk.adult_content >= 0.75);
  assert.ok(r.risk.adult_promo >= 0.7);
  assert.ok(r.risk.spam >= 0.35);
});

test("ordinary portrait image does not become adult content from skin pixels alone", () => {
  const r = H.social({
    platform: "threads",
    isReply: false,
    text: "Weekend portrait from the park.",
    imageEvidence: {
      analyzedCount: 1,
      visionStatus: "available",
      images: [{
        visual: {
          adult_visual: "none",
          adult_promo_visual: "none",
          contact_or_subscription_cta: false,
          nudity: false,
          sexual_pose: false
        },
        ocr: { text: "" },
        qr: { values: [] },
        pixelSignals: { skin_fraction: 0.78 }
      }]
    }
  });
  assert.equal(r.labels.adult_content, "unlikely");
  assert.ok(r.risk.adult_content < 0.34);
});
