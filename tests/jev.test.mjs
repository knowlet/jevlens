import test from "node:test";
import assert from "node:assert/strict";

await import("../extension/lib/jev.js");
const J = globalThis.JevLensJev;

test("buildRequest uses official System One HTTP shape and expanded social dimensions", () => {
  const req = J.buildRequest("social", { text: "hello", handle: "@a", platform: "x", isReply: false });
  assert.equal(req.model, "jev-latest");
  assert.equal(req.state.text, "hello");
  assert.equal(req.state.isReply, false);
  assert.equal(req.questions.spam.type, "choice");
  assert.ok(req.questions.spam.criteria.likely);
  assert.ok(req.questions.politicalContent.criteria.political);
  assert.ok(req.questions.ideologicalTilt.criteria.unclear);
  assert.ok(req.questions.rhetoricalStyle.criteria.high_arousal_opinion);
  assert.ok(req.questions.trafficManipulation.criteria.possible);
  assert.ok(req.questions.aiFarm.criteria.unlikely);
  assert.ok(req.questions.replyQuality.criteria.not_applicable);
  assert.ok(req.questions.adultContent.criteria.likely);
  assert.ok(req.questions.adultPromo.criteria.likely);
  assert.equal(req.state.media.imageCount, 0);
});

test("direct evaluator sends Bearer token to official endpoint and normalizes content signals", async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({
      model: "jev-latest",
      answers: {
        politicalContent: { type: "choice", choice: "political", probabilities: { political: 0.92, non_political: 0.04, unclear: 0.04 }, confidence: 0.88 },
        ideologicalTilt: { type: "choice", choice: "unclear", probabilities: { unclear: 0.78, mixed_or_center: 0.14, left_leaning: 0.04, right_leaning: 0.04 }, confidence: 0.72 },
        rhetoricalStyle: { type: "choice", choice: "high_arousal_opinion", probabilities: { high_arousal_opinion: 0.8, opinionated_commentary: 0.15, unclear: 0.05 }, confidence: 0.78 },
        trafficManipulation: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.72, possible: 0.24, likely: 0.02, unclear: 0.02 }, confidence: 0.68 },
        aiFarm: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.9, possible: 0.06, likely: 0.01, unclear: 0.03 }, confidence: 0.84 },
        replyQuality: { type: "choice", choice: "not_applicable", probabilities: { not_applicable: 0.96, unclear: 0.04 }, confidence: 0.94 },
        spam: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.9, possible: 0.08, likely: 0.01, unclear: 0.01 }, confidence: 0.86 },
        botLike: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.9, possible: 0.08, likely: 0.01, unclear: 0.01 }, confidence: 0.86 },
        adultContent: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.98, possible: 0.01, likely: 0.005, unclear: 0.005 }, confidence: 0.95 },
        adultPromo: { type: "choice", choice: "unlikely", probabilities: { unlikely: 0.98, possible: 0.01, likely: 0.005, unclear: 0.005 }, confidence: 0.95 }
      },
      usage: { input_tokens: 10, output_tokens: 9 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await J.evaluate({
    apiKey: "ts_test_123",
    kind: "social",
    features: { text: "policy critique", platform: "x", isReply: false },
    fetchImpl: fakeFetch,
    retries: 0
  });

  assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(seen.init.headers.Authorization, "Bearer ts_test_123");
  assert.equal(result.source, "jev_direct");
  assert.equal(result.labels.political_content, "political");
  assert.equal(result.labels.ideological_tilt, "unclear");
  assert.equal(result.labels.rhetorical_style, "high_arousal_opinion");
  assert.equal(result.labels.reply_quality, "not_applicable");
  assert.equal(result.labels.spam, "unlikely");
  assert.ok(result.risk.traffic_manipulation > 0 && result.risk.traffic_manipulation < 0.2);
  assert.equal(result.diagnostics.sent_state.text, "policy critique");
  assert.equal(result.diagnostics.answer_choices.spam.choice, "unlikely");
});


test("buildRequest forwards structured image evidence but not raw image URLs", () => {
  const req = J.buildRequest("social", {
    platform: "threads",
    text: "caption",
    images: [{ url: "https://cdn.example/secret.jpg", alt: "poster", width: 1080, height: 1350, kind: "image" }],
    imageEvidence: {
      analyzedCount: 1,
      visionStatus: "available",
      images: [{ url: "https://cdn.example/secret.jpg", visual: { adult_visual: "explicit", adult_promo_visual: "likely" }, ocr: { text: "18+" } }]
    }
  });
  assert.equal(req.state.media.imageCount, 1);
  assert.equal(req.state.media.images[0].alt, "poster");
  assert.equal("url" in req.state.media.images[0], false);
  assert.equal(req.state.media.imageEvidence.visionStatus, "available");
  assert.equal(req.state.media.imageEvidence.images[0].visual.adult_visual, "explicit");
  assert.equal("url" in req.state.media.imageEvidence.images[0], false);
});
