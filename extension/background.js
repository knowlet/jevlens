importScripts("lib/heuristics.js", "lib/jev.js");

const CLASSIFIER_SCHEMA = "2026-09-social-v4-image";

// A local fallback is not a Jev result. Caching one for the full cache window meant that fixing the
// API key, waiting out a rate limit, or recovering from a timeout still served stale LOCAL output
// for hours, so fallbacks expire quickly and never satisfy a direct-Jev lookup.
const FALLBACK_CACHE_MS = 5 * 60 * 1000;

const DEFAULTS = {
  enabled: true,
  threshold: 0.68,
  actionMode: "mark",
  showPolitical: true,
  showAiFarm: true,
  showTraffic: true,
  showSpam: true,
  showBot: true,
  showAdultContent: true,
  showAdultPromo: true,
  imageAnalysisEnabled: true,
  cacheHours: 24,
  fallbackToLocal: true,
  localBlockedHandles: []
};

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function getApiKey() {
  const { typesafeApiKey = "" } = await chrome.storage.local.get({ typesafeApiKey: "" });
  return String(typesafeApiKey || "").trim();
}


const OFFSCREEN_DOCUMENT = "offscreen.html";
let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) throw new Error("Chrome offscreen API is unavailable");
  const url = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [url]
    });
    if (contexts.length) return;
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["BLOBS"],
    justification: "Fetch and analyze social-media image blobs locally before Jev classification."
  });
  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

async function analyzeImages(images) {
  const limited = (images || []).slice(0, 3);
  if (!limited.length) return null;
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "jevlens-offscreen",
    type: "ANALYZE_IMAGES",
    images: limited
  });
  if (!response?.ok) throw new Error(response?.error || "image analysis failed");
  return response.evidence || null;
}

async function enrichFeatures(kind, features, settings) {
  if (kind !== "social" || !settings.imageAnalysisEnabled || !(features?.images || []).length) {
    return features;
  }

  // Evaluation fixtures may already contain deterministic image evidence. Do not overwrite it.
  if (features.imageEvidence) return features;

  try {
    const imageEvidence = await analyzeImages(features.images);
    return { ...features, imageEvidence };
  } catch (err) {
    return {
      ...features,
      imageEvidence: {
        analyzedCount: 0,
        visionStatus: "error",
        images: [],
        error: String(err?.message || err)
      }
    };
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function pruneCacheEntries() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([key]) => key.startsWith("cache:"))
    .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0));
  const drop = entries.slice(0, Math.ceil(entries.length / 2)).map(([key]) => key);
  if (drop.length) await chrome.storage.local.remove(drop);
  return drop.length;
}

async function writeCache(cacheKey, value) {
  const entry = { at: Date.now(), value };
  try {
    await chrome.storage.local.set({ [cacheKey]: entry });
    return;
  } catch {
    // Caching is best effort: a full storage quota must never turn a successful classification into
    // a reported failure, so drop the oldest half of the cache and retry once.
  }
  try {
    await pruneCacheEntries();
    await chrome.storage.local.set({ [cacheKey]: entry });
  } catch {
    // Still nothing we can do; the classification itself already succeeded.
  }
}

async function classify(kind, features) {
  const settings = await getSettings();
  const apiKey = await getApiKey();
  // Cache on raw page features. Image URLs/alt/dimensions are part of the key, while expensive
  // local vision evidence is only generated on a cache miss.
  const cacheKey = "cache:" + await sha256(JSON.stringify({
    kind,
    features,
    imageAnalysisEnabled: !!settings.imageAnalysisEnabled,
    provider: "jev_direct",
    model: JevLensJev.MODEL,
    schema: CLASSIFIER_SCHEMA
  }));
  const cached = (await chrome.storage.local.get(cacheKey))[cacheKey];
  const maxAge = Math.max(0, settings.cacheHours) * 3600_000;

  if (cached) {
    const ttl = cached.value?.source === "jev_direct" ? maxAge : FALLBACK_CACHE_MS;
    if (Date.now() - cached.at < ttl) return { ...cached.value, cached: true };
  }

  const enriched = await enrichFeatures(kind, features, settings);
  let value;
  try {
    value = await JevLensJev.evaluate({ apiKey, kind, features: enriched });
  } catch (err) {
    if (!settings.fallbackToLocal) throw err;
    value = {
      ...JevLensHeuristics[kind](enriched),
      source: "local_fallback",
      fallback: true,
      fallback_reason: String(err?.message || err)
    };
  }

  if (kind === "social") value.image_evidence = enriched.imageEvidence || null;
  await writeCache(cacheKey, value);
  return value;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "jevlens-offscreen") return;
  (async () => {
    if (message?.type === "GET_SETTINGS") {
      const settings = await getSettings();
      const apiKey = await getApiKey();
      sendResponse({ ok: true, settings, hasApiKey: !!apiKey });
      return;
    }

    if (message?.type === "CLASSIFY") {
      const settings = await getSettings();
      if (!settings.enabled) {
        sendResponse({ ok: false, disabled: true });
        return;
      }
      const result = await classify(message.kind, message.features);
      sendResponse({ ok: true, result, settings });
      return;
    }

    if (message?.type === "TEST_JEV") {
      const apiKey = await getApiKey();
      const result = await JevLensJev.evaluate({
        apiKey,
        kind: "social",
        features: {
          platform: "test",
          displayName: "JevLens",
          handle: "@jevlens_test",
          text: "This is a normal test message about browser extension settings.",
          isReply: false
        },
        timeoutMs: 10000,
        retries: 0
      });
      sendResponse({ ok: true, source: result.source, model: result.model, usage: result.usage });
      return;
    }

    if (message?.type === "EVAL_CLASSIFY") {
      const apiKey = await getApiKey();
      const kind = message.kind;
      if (!["social", "article"].includes(kind)) throw new Error("invalid eval kind");
      const result = await JevLensJev.evaluate({
        apiKey,
        kind,
        features: message.features || {},
        timeoutMs: 12000,
        retries: 1
      });
      sendResponse({ ok: true, result });
      return;
    }

    if (message?.type === "EVAL_LOCAL") {
      const kind = message.kind;
      if (!["social", "article"].includes(kind)) throw new Error("invalid eval kind");
      const result = JevLensHeuristics[kind](message.features || {});
      sendResponse({ ok: true, result });
      return;
    }

    if (message?.type === "IMAGE_AI_STATUS") {
      await ensureOffscreenDocument();
      const result = await chrome.runtime.sendMessage({
        target: "jevlens-offscreen",
        type: "IMAGE_AI_STATUS"
      });
      sendResponse(result || { ok: false, error: "no image AI response" });
      return;
    }

    if (message?.type === "LOCAL_BLOCK") {
      const settings = await getSettings();
      const handle = String(message.handle || "").toLowerCase();
      const next = [...new Set([...(settings.localBlockedHandles || []), handle].filter(Boolean))];
      await chrome.storage.sync.set({ localBlockedHandles: next });
      sendResponse({ ok: true, handles: next });
      return;
    }

    if (message?.type === "CLEAR_CACHE") {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith("cache:"));
      if (keys.length) await chrome.storage.local.remove(keys);
      sendResponse({ ok: true, removed: keys.length });
      return;
    }

    sendResponse({ ok: false, error: "unknown_message" });
  })().catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true;
});
