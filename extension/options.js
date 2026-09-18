const defaults = {
  threshold: 0.68,
  actionMode: "mark",
  cacheHours: 24,
  fallbackToLocal: true,
  imageAnalysisEnabled: true,
  showPolitical: true,
  showAiFarm: true,
  showTraffic: true,
  showSpam: true,
  showBot: true,
  showAdultContent: true,
  showAdultPromo: true
};

const ids = Object.keys(defaults);
const el = id => document.getElementById(id);

async function load() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(defaults),
    chrome.storage.local.get({ typesafeApiKey: "" })
  ]);

  for (const id of ids) {
    const node = el(id);
    if (node.type === "checkbox") node.checked = !!sync[id];
    else node.value = sync[id];
  }

  el("typesafeApiKey").value = local.typesafeApiKey || "";
}

el("toggleKey").onclick = () => {
  const input = el("typesafeApiKey");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  el("toggleKey").textContent = showing ? "顯示" : "隱藏";
};

el("save").onclick = async () => {
  const next = {};
  for (const id of ids) {
    const node = el(id);
    next[id] = node.type === "checkbox" ? node.checked :
      node.type === "number" ? Number(node.value) : node.value;
  }

  const apiKey = el("typesafeApiKey").value.trim();
  await Promise.all([
    chrome.storage.sync.set(next),
    chrome.storage.local.set({ typesafeApiKey: apiKey })
  ]);

  el("status").textContent = apiKey ? "已儲存設定與 API key" : "已儲存設定；尚未設定 API key";
};

el("removeKey").onclick = async () => {
  await chrome.storage.local.remove("typesafeApiKey");
  el("typesafeApiKey").value = "";
  el("status").textContent = "API key 已從 Extension storage 移除";
};

el("testJev").onclick = async () => {
  const status = el("testStatus");
  const apiKey = el("typesafeApiKey").value.trim();
  if (!apiKey) {
    status.textContent = "請先輸入 API key";
    return;
  }

  await chrome.storage.local.set({ typesafeApiKey: apiKey });
  status.textContent = "測試中…";
  chrome.runtime.sendMessage({ type: "TEST_JEV" }, r => {
    if (chrome.runtime.lastError) {
      status.textContent = `失敗：${chrome.runtime.lastError.message}`;
      return;
    }
    status.textContent = r?.ok
      ? `成功：${r.model || "jev-latest"}${r.usage?.input_tokens != null ? `，input ${r.usage.input_tokens} tokens` : ""}`
      : `失敗：${r?.error || "unknown error"}`;
  });
};

load();


const IMAGE_MODEL_OPTIONS = {
  expectedInputs: [
    { type: "text", languages: ["en"] },
    { type: "image" }
  ],
  expectedOutputs: [
    { type: "text", languages: ["en"] }
  ]
};

async function imageAiAvailability() {
  if (!("LanguageModel" in globalThis)) return "unsupported";
  try {
    return await LanguageModel.availability(IMAGE_MODEL_OPTIONS);
  } catch (err) {
    return `error:${err?.name || "unknown"}`;
  }
}

async function refreshImageAiStatus() {
  const node = el("imageAiStatus");
  if (!node) return;
  const availability = await imageAiAvailability();
  const labels = {
    available: "已可使用",
    downloadable: "可下載，尚未準備",
    downloading: "下載中",
    unavailable: "此裝置不可用",
    unsupported: "此 Chrome 不支援 Prompt API"
  };
  node.textContent = labels[availability] || availability;
}

el("prepareImageAI").onclick = async () => {
  const status = el("imageAiStatus");
  if (!("LanguageModel" in globalThis)) {
    status.textContent = "此 Chrome 不支援 Prompt API";
    return;
  }

  status.textContent = "檢查中…";
  try {
    const availability = await LanguageModel.availability(IMAGE_MODEL_OPTIONS);
    if (availability === "unavailable") {
      status.textContent = "此裝置無法使用內建圖片模型";
      return;
    }

    const session = await LanguageModel.create({
      ...IMAGE_MODEL_OPTIONS,
      temperature: 0,
      topK: 1,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", event => {
          const pct = Number.isFinite(event.loaded) ? Math.round(event.loaded * 100) : null;
          status.textContent = pct == null ? "下載模型中…" : `下載模型 ${pct}%`;
        });
      }
    });
    session.destroy?.();
    status.textContent = "已可使用";
  } catch (err) {
    status.textContent = `失敗：${err?.message || err}`;
  }
};

refreshImageAiStatus();
