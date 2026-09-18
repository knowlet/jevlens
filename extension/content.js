(() => {
  "use strict";

  const S = globalThis.JevLensSignals;

  let settingsCache = null;
  const queue = [];
  const queuedKeys = new Set();
  let running = 0;
  const MAX_CONCURRENCY = 4;
  const stats = { discovered: 0, queued: 0, analyzed: 0, errors: 0, jev: 0, fallback: 0 };

  const send = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (err) {
      resolve({ ok: false, error: String(err?.message || err) });
    }
  });

  async function settings() {
    if (settingsCache) return settingsCache;
    const r = await send({ type: "GET_SETTINGS" });
    settingsCache = r?.settings || {};
    return settingsCache;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const syncSettingsChanged = areaName === "sync" && Object.keys(changes).some(key =>
      ["enabled", "threshold", "actionMode", "showPolitical", "showAiFarm", "showTraffic", "showSpam", "showBot", "showAdultContent", "showAdultPromo", "imageAnalysisEnabled", "fallbackToLocal", "localBlockedHandles"].includes(key)
    );
    const apiKeyChanged = areaName === "local" && Object.prototype.hasOwnProperty.call(changes, "typesafeApiKey");

    // Ignore background cache writes; otherwise every classification would trigger a full-feed reanalysis loop.
    if (!syncSettingsChanged && !apiKeyChanged) return;

    settingsCache = null;
    document.querySelectorAll("[data-jevlens-key]").forEach(el => {
      el.dataset.jevlensDone = "0";
    });
    scheduleScan(0);
  });

  function text(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function simpleHash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function featureKey(features) {
    return simpleHash([
      features.platform || "",
      features.handle || "",
      features.displayName || "",
      features.text || "",
      features.isReply ? "reply" : "post",
      JSON.stringify((features.images || []).map(img => [img.url || "", img.alt || "", img.width || 0, img.height || 0]))
    ].join("\u241f"));
  }

  function findHandle(root) {
    if (!root) return "";
    const anchors = [...root.querySelectorAll('a[href^="/"]')];
    for (const a of anchors) {
      const t = text(a);
      if (/^@[\p{L}\p{N}_.]{1,40}$/u.test(t)) return t;
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/@([^/?#]+)/);
      if (m && !/^(home|search|explore|notifications|messages|settings)$/i.test(m[1])) {
        return `@${m[1]}`;
      }
    }
    const body = text(root);
    const m = body.match(/@[\p{L}\p{N}_.]{1,40}/u);
    return m?.[0] || "";
  }

  function explicitReplySignal(root) {
    // Do not scan the whole card: social UIs contain reply buttons/accessibility text that can
    // make every feed item look like a reply. Only inspect short author/content text nodes for
    // an explicit relation marker such as “Replying to @foo”.
    const candidates = [...(root?.querySelectorAll?.('[dir="auto"]') || [])]
      .map(text)
      .filter(t => t.length > 0 && t.length <= 180)
      .slice(0, 12);
    const relationText = candidates.join("\n");
    return /(?:^|\n)\s*(?:replying to|replied to|正在回覆|回覆給|回覆了|返信先|返信しました)\s*[@＠]?[^\n]{1,80}/i.test(relationText);
  }

  function extractMedia(root) {
    if (!root) return [];
    const out = [];
    const seen = new Set();

    const add = (url, alt, width, height, kind = "image") => {
      if (!url || seen.has(url)) return;
      if (!/^https?:/i.test(url)) return;
      width = Math.round(Number(width) || 0);
      height = Math.round(Number(height) || 0);
      // Avoid avatars, emoji and UI icons. Social-media content images are normally much larger.
      if (width && height && Math.max(width, height) < 140) return;
      if (/profile_images|emoji|avatar|profile_pic/i.test(url)) return;
      seen.add(url);
      out.push({
        url,
        alt: String(alt || "").replace(/\s+/g, " ").trim().slice(0, 600),
        width,
        height,
        kind
      });
    };

    for (const img of root.querySelectorAll("img")) {
      const rect = img.getBoundingClientRect?.() || { width: 0, height: 0 };
      add(
        img.currentSrc || img.src || "",
        img.alt || img.getAttribute("aria-label") || "",
        img.naturalWidth || rect.width || img.width,
        img.naturalHeight || rect.height || img.height,
        "image"
      );
      if (out.length >= 4) break;
    }

    if (out.length < 4) {
      for (const video of root.querySelectorAll("video[poster]")) {
        const rect = video.getBoundingClientRect?.() || { width: 0, height: 0 };
        add(video.poster, video.getAttribute("aria-label") || "video poster", rect.width, rect.height, "video_poster");
        if (out.length >= 4) break;
      }
    }

    return out.slice(0, 4);
  }

  function extractX(article) {
    const tweet = article.querySelector('[data-testid="tweetText"]');
    const userName = article.querySelector('[data-testid="User-Name"]');
    const link = article.querySelector('a[href*="/status/"]');
    return {
      platform: "x",
      text: text(tweet || article).slice(0, 5000),
      handle: findHandle(userName || article),
      displayName: text(userName).split("@")[0].trim().slice(0, 100),
      // A /status/ page can contain both the root post and replies, so URL alone is not a reply signal.
      isReply: explicitReplySignal(article),
      postUrl: link?.href || "",
      images: extractMedia(article)
    };
  }

  function extractThreads(article) {
    const candidates = [...article.querySelectorAll('[dir="auto"]')]
      .map(text)
      .filter(t => t.length >= 2 && t.length <= 5000);

    const postLink = [...article.querySelectorAll('a[href*="/post/"]')]
      .find(a => /\/post\//.test(a.getAttribute("href") || ""));

    const body = candidates
      .filter(t => !/^@[\w.]+$/.test(t))
      .sort((a, b) => b.length - a.length)[0] || text(article);

    return {
      platform: "threads",
      text: body.slice(0, 5000),
      handle: findHandle(article),
      displayName: candidates.find(t => t.length < 80 && !t.startsWith("@")) || "",
      // Threads permalink pages also contain the root post; do not treat the whole page as a reply.
      isReply: explicitReplySignal(article),
      postUrl: postLink?.href || "",
      images: extractMedia(article)
    };
  }

  function findThreadsFallbackContainers() {
    const out = [];
    const seen = new Set();
    const links = document.querySelectorAll('a[href*="/post/"]');

    for (const link of links) {
      let node = link;
      let best = null;
      for (let depth = 0; depth < 8 && node?.parentElement; depth++) {
        node = node.parentElement;
        const len = text(node).length;
        const autoCount = node.querySelectorAll('[dir="auto"]').length;
        if (len >= 20 && len <= 12000 && autoCount >= 1) best = node;
        if (len > 12000) break;
      }
      if (best && !seen.has(best)) {
        seen.add(best);
        out.push(best);
      }
    }
    return out;
  }

  function targetElements() {
    const host = location.hostname.toLowerCase();

    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) {
      return [...document.querySelectorAll('article[data-testid="tweet"]')]
        .map(el => ({ el, features: extractX(el) }))
        .filter(item => item.features.text.length >= 2);
    }

    if (host === "threads.com" || host.endsWith(".threads.com") || host === "threads.net" || host.endsWith(".threads.net")) {
      let nodes = [...document.querySelectorAll('article, [role="article"]')];
      if (!nodes.length) nodes = findThreadsFallbackContainers();
      return [...new Set(nodes)]
        .map(el => ({ el, features: extractThreads(el) }))
        .filter(item => item.features.text.length >= 2);
    }

    return [];
  }

  const {
    pct,
    riskLevel,
    labelText,
    confidenceNote,
    textChip,
    renderSignalChips,
    describeCandidates,
    riskPresentation
  } = S;

  function ensureHud() {
    let hud = document.getElementById("jevlens-feed-hud");
    if (hud) return hud;

    hud = document.createElement("div");
    hud.id = "jevlens-feed-hud";
    hud.innerHTML = '<span class="jevlens-hud-dot"></span><strong>JevLens</strong><span class="jevlens-hud-status">啟動中…</span><button type="button" title="隱藏 JevLens 狀態">×</button>';
    hud.querySelector("button").addEventListener("click", () => hud.remove());
    (document.body || document.documentElement).appendChild(hud);
    return hud;
  }

  function updateHud(extra = "") {
    const hud = ensureHud();
    const status = hud.querySelector(".jevlens-hud-status");
    if (!status) return;
    const active = running + queue.length;
    status.textContent = extra || `已分析 ${stats.analyzed} · 排隊 ${active} · 錯誤 ${stats.errors}`;
    hud.dataset.state = stats.errors ? "warning" : active ? "working" : "ready";
  }

  function analysisMount(el, platform, features) {
    let mount = el.querySelector(':scope > .jevlens-analysis, .jevlens-analysis[data-owner="jevlens"]');
    if (mount) return mount;

    mount = document.createElement("div");
    mount.className = "jevlens-analysis";
    mount.dataset.owner = "jevlens";
    mount.dataset.state = "pending";
    mount.innerHTML = '<span class="jevlens-spinner" aria-hidden="true"></span><span class="jevlens-analysis-text">Jev · 排隊中…</span>';

    // Mount inside the column that owns the post body. Prepending to the card itself can land the
    // row next to the avatar column, which pushes the post sideways and breaks the feed layout.
    mount.dataset.mount = S.mountInto(el, mount, platform, features);
    return mount;
  }

  function setPending(mount, label = "Jev · 分析中…") {
    mount.dataset.state = "pending";
    mount.replaceChildren();
    const spinner = document.createElement("span");
    spinner.className = "jevlens-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const labelEl = document.createElement("span");
    labelEl.className = "jevlens-analysis-text";
    labelEl.textContent = label;
    mount.append(spinner, labelEl);
  }

  function renderResult(mount, result, s, features) {
    const threshold = Number(s.threshold || 0.68);
    // Political/ideological labels are informational only and never trigger automatic filtering.
    const filterRisk = Math.max(
      result.risk?.spam || 0,
      result.risk?.bot_like || 0,
      result.risk?.adult_content || 0,
      result.risk?.adult_promo || 0,
      result.risk?.ai_farm || 0
    );
    mount.dataset.state = riskLevel(filterRisk, threshold);
    mount.replaceChildren();

    const source = document.createElement("span");
    source.className = "jevlens-source";
    source.textContent = result.source === "jev_direct" ? "Jev ✓" : result.source === "local_fallback" ? "LOCAL ↺" : "LOCAL";
    if (result.fallback_reason) source.title = `Jev fallback: ${result.fallback_reason}`;
    mount.appendChild(source);

    if (features?.isReply && result.labels?.reply_quality !== "not_applicable") {
      const quality = document.createElement("span");
      quality.className = "jevlens-quality";
      quality.textContent = `回覆 ${labelText("quality", result.labels?.reply_quality)}`;
      quality.title = confidenceNote(result, "reply_quality");
      mount.appendChild(quality);
    } else {
      const kind = document.createElement("span");
      kind.className = "jevlens-quality";
      kind.textContent = "貼文";
      mount.appendChild(kind);
    }

    if ((features?.images?.length || 0) > 0 && s.imageAnalysisEnabled !== false) {
      const analyzed = Number(result.image_evidence?.analyzedCount || 0);
      const imageState = result.image_evidence?.visionStatus || "metadata";
      mount.appendChild(textChip("圖", `${analyzed}/${features.images.length}`, `image analysis=${imageState}`));
    }

    // Only the highest-scoring categories get a chip; every other dimension stays in the hover
    // title so the row keeps its shape no matter how many signals fire.
    renderSignalChips(mount, result, s);

    const details = [
      `political=${result.labels?.political_content || "unclear"}`,
      `tilt=${result.labels?.ideological_tilt || "unclear"}`,
      `rhetoric=${result.labels?.rhetorical_style || "unclear"}`,
      `traffic=${result.labels?.traffic_manipulation || "unclear"}`,
      `ai_farm=${result.labels?.ai_farm || "unclear"}`,
      `reply=${result.labels?.reply_quality || "unclear"}`,
      `spam=${result.labels?.spam || "unclear"}`,
      `bot=${result.labels?.bot_like || "unclear"}`,
      `adult_content=${result.labels?.adult_content || "unclear"}`,
      `adult_promo=${result.labels?.adult_promo || "unclear"}`,
      `ranked=${describeCandidates(result, s) || "none"}`,
      `images=${features?.images?.length || 0}`,
      `image_vision=${result.image_evidence?.visionStatus || "none"}`,
      `image_visuals=${(result.image_evidence?.images || []).map(x => `${x.visual?.visual_style || "?"}:${x.visual?.adult_visual || "?"}/${x.visual?.adult_promo_visual || "?"}`).join(",") || "none"}`,
      `source=${result.source || "unknown"}`
    ];
    if (result.cached) details.push("cached=true");
    if (result.flags?.length) details.push(`signals=${result.flags.join(", ")}`);
    mount.title = details.join("\n");

    return filterRisk;
  }

  function renderError(mount, message) {
    mount.dataset.state = "error";
    mount.replaceChildren();
    const source = document.createElement("span");
    source.className = "jevlens-source";
    source.textContent = "Jev !";
    const label = document.createElement("span");
    label.className = "jevlens-analysis-text";
    label.textContent = "分析失敗";
    mount.append(source, label);
    mount.title = String(message || "unknown error");
  }

  function collapse(el, reason, handle = "") {
    if (el.classList.contains("jevlens-collapsed")) return;
    const reveal = document.createElement("div");
    reveal.className = "jevlens-reveal";
    reveal.textContent = reason;

    const show = document.createElement("button");
    show.textContent = "顯示";
    show.onclick = () => {
      el.classList.remove("jevlens-collapsed");
      reveal.remove();
      delete el.dataset.jevlensCollapse;
    };
    reveal.appendChild(show);

    if (handle) {
      const block = document.createElement("button");
      block.textContent = `本機封鎖 ${handle}`;
      block.onclick = async () => {
        await send({ type: "LOCAL_BLOCK", handle });
        el.remove();
      };
      reveal.appendChild(block);
    }

    el.prepend(reveal);
    el.classList.add("jevlens-collapsed");
    el.dataset.jevlensCollapse = reason;
  }

  // Rendering a fresh classification includes clearing the previous one. Without this, a raised
  // threshold, a switch away from dim/collapse, or a post that stops looking risky keeps the old
  // styling, and a post unblocked in settings stays hidden because its reveal was inserted earlier.
  function releasePostState(el) {
    el.classList.remove("jevlens-dim");
    el.classList.remove("jevlens-collapsed");
    el.querySelectorAll(":scope > .jevlens-reveal").forEach(node => node.remove());
    delete el.dataset.jevlensCollapse;
  }

  async function runItem(item) {
    running++;
    updateHud();
    const { el, features, key, mount } = item;

    try {
      if (!el.isConnected || el.dataset.jevlensKey !== key) return;

      const s = await settings();
      if (!s.enabled) {
        mount.remove();
        return;
      }

      const blocked = (s.localBlockedHandles || []).map(x => x.toLowerCase());
      if (features.handle && blocked.includes(features.handle.toLowerCase())) {
        collapse(el, `JevLens 本機封鎖：${features.handle}`);
        return;
      }

      setPending(mount);
      const reply = await send({ type: "CLASSIFY", kind: "social", features });

      if (!el.isConnected || el.dataset.jevlensKey !== key) return;

      if (!reply?.ok) {
        stats.errors++;
        renderError(mount, reply?.error || (reply?.disabled ? "JevLens disabled" : "classification failed"));
        el.dataset.jevlensDone = "error";
        return;
      }

      const r = reply.result;
      const maxRisk = renderResult(mount, r, s, features);
      el.dataset.jevlensDone = "1";
      stats.analyzed++;
      if (r.source === "jev_direct") stats.jev++;
      else stats.fallback++;

      const presentation = riskPresentation(maxRisk, s);
      // Release first, then apply: the new classification owns the post's presentation state.
      releasePostState(el);
      if (presentation.dim) el.classList.add("jevlens-dim");
      if (presentation.collapse) collapse(el, `JevLens 摺疊：風險 ${pct(maxRisk)}`, features.handle);
    } catch (err) {
      stats.errors++;
      if (mount?.isConnected) {
        renderError(mount, err?.message || String(err));
        if (el?.isConnected) el.dataset.jevlensDone = "error";
      }
    } finally {
      running--;
      queuedKeys.delete(key);
      pump();
      updateHud();
    }
  }

  function pump() {
    while (running < MAX_CONCURRENCY && queue.length) {
      const item = queue.shift();
      runItem(item);
    }
  }

  function enqueue(el, features) {
    const key = featureKey(features);
    if (el.dataset.jevlensKey === key && ["1", "error"].includes(el.dataset.jevlensDone)) return;
    if (queuedKeys.has(key) && el.dataset.jevlensKey === key) return;

    const old = el.querySelector('.jevlens-analysis[data-owner="jevlens"]');
    if (old && el.dataset.jevlensKey !== key) old.remove();

    el.dataset.jevlensKey = key;
    el.dataset.jevlensDone = "0";
    const mount = analysisMount(el, features.platform, features);
    setPending(mount, "Jev · 排隊中…");

    queuedKeys.add(key);
    queue.push({ el, features, key, mount });
    stats.queued++;
    pump();
  }

  async function scan() {
    const s = await settings();
    if (!s.enabled) {
      updateHud("已停用");
      return;
    }

    const targets = targetElements();
    stats.discovered = targets.length;
    for (const item of targets) enqueue(item.el, item.features);
    updateHud(targets.length ? "" : "等待可分析貼文…");
  }

  let scanTimer = 0;
  function scheduleScan(delay = 100) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan().catch(err => {
      stats.errors++;
      updateHud(`掃描錯誤：${String(err?.message || err).slice(0, 60)}`);
    }), delay);
  }

  const observer = new MutationObserver(() => scheduleScan(120));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // SPA soft navigation does not reinject MV3 content scripts. Watch URL changes explicitly.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan(50);
    }
  }, 800);

  ensureHud();
  scheduleScan(0);
})();
