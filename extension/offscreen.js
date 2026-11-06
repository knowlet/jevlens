(() => {
  "use strict";

  let baselineSession = null;
  let visionAvailability = "unknown";

  const VISION_OPTIONS = {
    expectedInputs: [
      { type: "text", languages: ["en"] },
      { type: "image" }
    ],
    expectedOutputs: [
      { type: "text", languages: ["en"] }
    ]
  };

  const RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      adult_visual: { type: "string", enum: ["none", "suggestive", "explicit", "unclear"] },
      adult_promo_visual: { type: "string", enum: ["none", "possible", "likely", "unclear"] },
      commercial_promo_visual: { type: "string", enum: ["none", "possible", "likely", "unclear"] },
      political_visual: { type: "string", enum: ["none", "possible", "likely", "unclear"] },
      visual_style: { type: "string", enum: ["ordinary_photo", "selfie", "news_card", "meme", "advertisement", "screenshot", "illustration", "unclear"] },
      contains_text: { type: "boolean" },
      revealing_clothing: { type: "boolean" },
      nudity: { type: "boolean" },
      sexual_pose: { type: "boolean" },
      contact_or_subscription_cta: { type: "boolean" },
      price_or_offer_visible: { type: "boolean" },
      news_graphic: { type: "boolean" },
      crowd_or_rally: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    },
    required: [
      "adult_visual", "adult_promo_visual", "commercial_promo_visual", "political_visual",
      "visual_style", "contains_text", "revealing_clothing", "nudity", "sexual_pose",
      "contact_or_subscription_cta", "price_or_offer_visible", "news_graphic", "crowd_or_rally", "confidence"
    ]
  };

  async function getVisionAvailability() {
    if (!("LanguageModel" in globalThis)) {
      visionAvailability = "unsupported";
      return visionAvailability;
    }
    try {
      visionAvailability = await LanguageModel.availability(VISION_OPTIONS);
    } catch (err) {
      visionAvailability = `error:${err?.name || "unknown"}`;
    }
    return visionAvailability;
  }

  async function getBaselineSession() {
    if (baselineSession) return baselineSession;
    const availability = await getVisionAvailability();
    if (availability !== "available") return null;
    baselineSession = await LanguageModel.create({
      ...VISION_OPTIONS,
      temperature: 0,
      topK: 1
    });
    return baselineSession;
  }

  // A Prompt API session keeps its conversation, so one shared session lets the previous image bias
  // the next classification (an adult graphic scanned before a selfie, for example). Start every
  // image from an untouched baseline session instead, and throw the per-image session away after.
  async function createImageSession() {
    const baseline = await getBaselineSession();
    if (!baseline) return null;
    if (typeof baseline.clone === "function") return baseline.clone();
    try {
      return await LanguageModel.create({ ...VISION_OPTIONS, temperature: 0, topK: 1 });
    } catch {
      // Last resort: reuse the baseline rather than skipping visual evidence entirely.
      return baseline;
    }
  }

  async function fetchBlob(url) {
    const res = await fetch(url, { credentials: "omit", cache: "force-cache" });
    if (!res.ok) throw new Error(`image fetch HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`not an image: ${blob.type || "unknown"}`);
    if (blob.size > 12 * 1024 * 1024) throw new Error("image too large");
    return blob;
  }

  function isSkin(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = r > 95 && g > 40 && b > 20 && (max - min) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
    const dark = r > 45 && g > 25 && b > 15 && r > g * 1.08 && r > b * 1.12 && (max - min) > 10;
    return light || dark;
  }

  async function pixelSignals(blob) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      const maxSide = 96;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let skin = 0;
      let count = 0;
      let brightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 32) continue;
        count++;
        if (isSkin(r, g, b)) skin++;
        brightness += (r + g + b) / 765;
      }
      return {
        skin_fraction: count ? Number((skin / count).toFixed(3)) : 0,
        mean_brightness: count ? Number((brightness / count).toFixed(3)) : 0
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    } finally {
      bitmap?.close?.();
    }
  }

  async function detectText(blob) {
    if (!("TextDetector" in globalThis)) return { supported: false, text: "" };
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      const detector = new TextDetector();
      const found = await detector.detect(bitmap);
      const text = found.map(item => item.rawValue || item.text || "").filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 1800);
      return { supported: true, text };
    } catch (err) {
      return { supported: true, text: "", error: String(err?.message || err) };
    } finally {
      bitmap?.close?.();
    }
  }

  async function detectQr(blob) {
    if (!("BarcodeDetector" in globalThis)) return { supported: false, values: [] };
    let bitmap;
    try {
      const formats = await BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) return { supported: true, values: [] };
      bitmap = await createImageBitmap(blob);
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const found = await detector.detect(bitmap);
      return {
        supported: true,
        values: found.map(item => String(item.rawValue || "").slice(0, 600)).filter(Boolean).slice(0, 3)
      };
    } catch (err) {
      return { supported: true, values: [], error: String(err?.message || err) };
    } finally {
      bitmap?.close?.();
    }
  }

  async function visionAnalyze(blob) {
    const session = await createImageSession();
    if (!session) return { status: visionAvailability || "unavailable", result: null };

    const prompt = [
      {
        role: "user",
        content: [
          {
            type: "text",
            value: "Analyze this social-media image as a feature extractor. Classify only directly visible evidence. Do not identify people or infer private traits. Sexual/adult signals should reflect nudity, pornographic or clearly sexual presentation; ordinary portraits are not adult content. Promotion means visible calls to subscribe/contact/pay/follow for adult or commercial material. Political means visual context such as a campaign/rally/news political graphic, not a person's identity. Return only the constrained JSON."
          },
          { type: "image", value: blob }
        ]
      }
    ];

    try {
      const raw = await session.prompt(prompt, { responseConstraint: RESPONSE_SCHEMA });
      return { status: "available", result: JSON.parse(raw) };
    } catch (err) {
      return { status: `error:${err?.name || "prompt"}`, result: null, error: String(err?.message || err) };
    } finally {
      if (session !== baselineSession) session.destroy?.();
    }
  }

  async function analyzeOne(item) {
    const base = {
      url: item.url,
      alt: String(item.alt || "").slice(0, 600),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      kind: item.kind || "image"
    };

    try {
      const blob = await fetchBlob(item.url);
      const [pixels, ocr, qr, vision] = await Promise.all([
        pixelSignals(blob),
        detectText(blob),
        detectQr(blob),
        visionAnalyze(blob)
      ]);
      return {
        ...base,
        fetched: true,
        mime: blob.type,
        bytes: blob.size,
        pixelSignals: pixels,
        ocr,
        qr,
        visionStatus: vision.status,
        visual: vision.result,
        visionError: vision.error || null
      };
    } catch (err) {
      return {
        ...base,
        fetched: false,
        visionStatus: "fetch_error",
        error: String(err?.message || err)
      };
    }
  }

  async function analyzeImages(images) {
    const limited = (images || []).slice(0, 3);
    const results = [];
    // Sequential on purpose: Gemini Nano and image decode can be heavy, and feed scanning is already parallelized.
    for (const item of limited) results.push(await analyzeOne(item));
    const statuses = results.map(x => x.visionStatus).filter(Boolean);
    return {
      analyzedCount: results.filter(x => x.fetched).length,
      visionStatus: statuses.includes("available") ? "available" : (statuses[0] || "no_images"),
      images: results
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "jevlens-offscreen") return;
    (async () => {
      if (message.type === "ANALYZE_IMAGES") {
        sendResponse({ ok: true, evidence: await analyzeImages(message.images || []) });
        return;
      }
      if (message.type === "IMAGE_AI_STATUS") {
        sendResponse({ ok: true, availability: await getVisionAvailability() });
        return;
      }
      sendResponse({ ok: false, error: "unknown_offscreen_message" });
    })().catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  });
})();
