(() => {
  "use strict";

  const S = globalThis.JevLensSignals;

  let settingsCache = null;
  let settingsGeneration = 0;
  let postSerial = 0;
  let workSerial = 0;
  const queue = [];
  const queuedKeys = new Set();
  // WeakRefs so an infinite feed can drop detached cards. A strong Set would keep every card
  // alive until the next settings change. Dead refs are pruned on each scan; a card the page
  // still holds stays reachable for that toggle.
  const seenPosts = [];
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
    const generation = settingsGeneration;
    const r = await send({ type: "GET_SETTINGS" });
    if (generation !== settingsGeneration) return settings();
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

    settingsGeneration++;
    const disabled = areaName === "sync" && changes.enabled?.newValue === false;
    settingsCache = disabled ? { enabled: false } : null;
    queue.length = 0;
    queuedKeys.clear();
    // A settings change is a new decision. A manual reveal does not survive it, including on a
    // card that is currently detached.
    visitPosts(el => {
      el.dataset.jevlensDone = "0";
      delete el.dataset.jevlensReveal;
      if (disabled) clearPost(el);
    });
    if (disabled) updateHud();
    scheduleScan(0);
  });

  function extensionChrome(node) {
    if (!node || node.nodeType === 3) return false;
    if (node.id === "jevlens-feed-hud") return true;
    return Boolean(node.classList?.contains("jevlens-analysis") || node.classList?.contains("jevlens-reveal"));
  }

  function rememberPost(el) {
    if (!el) return;
    for (const ref of seenPosts) {
      if (ref.deref() === el) return;
    }
    seenPosts.push(new WeakRef(el));
  }

  function pruneSeenPosts() {
    const next = [];
    const live = new Set();
    for (const ref of seenPosts) {
      const el = ref.deref();
      if (!el || live.has(el)) continue;
      live.add(el);
      next.push(ref);
    }
    seenPosts.length = 0;
    seenPosts.push(...next);
  }

  function visitPosts(fn) {
    pruneSeenPosts();
    const seen = new Set();
    for (const el of document.querySelectorAll("[data-jevlens-key]")) {
      seen.add(el);
      fn(el);
    }
    const next = [];
    for (const ref of seenPosts) {
      const el = ref.deref();
      if (!el || seen.has(el)) continue;
      fn(el);
      if (el.isConnected) next.push(ref);
    }
    for (const el of seen) next.push(new WeakRef(el));
    seenPosts.length = 0;
    const kept = new Set();
    for (const ref of next) {
      const el = ref.deref();
      if (!el || kept.has(el)) continue;
      kept.add(el);
      seenPosts.push(ref);
    }
  }

  // While this is positive, the collapse stylesheet is off so getComputedStyle shows the site's
  // own display. The mutation observer ignores those class flips.
  let collapseSuspended = 0;

  function withCollapseSuspended(fn) {
    const root = document.documentElement;
    collapseSuspended++;
    const already = root?.classList?.contains("jevlens-suspend-collapse");
    if (root && !already) root.classList.add("jevlens-suspend-collapse");
    try {
      return fn();
    } finally {
      collapseSuspended--;
      if (root && !already) root.classList.remove("jevlens-suspend-collapse");
    }
  }

  // Page-hidden copy must not reach the classifier. Callers measure while our collapse rule is
  // suspended, so a direct child the site itself hides is still display:none, and text hidden
  // only by JevLens stays visible to this check.
  function pageHidden(node) {
    if (!node || node.nodeType === 3) return false;
    if (node.hidden || node.getAttribute?.("hidden") != null) return true;
    const declared = inlineVisibility(node.getAttribute?.("style"));
    let display = "";
    let visibility = "";
    let sawComputed = false;
    try {
      const style = globalThis.getComputedStyle?.(node);
      if (style && (style.display || style.visibility)) {
        display = String(style.display || "");
        visibility = String(style.visibility || "");
        sawComputed = true;
      }
    } catch {
      sawComputed = false;
    }
    // `display:none; display:block` and `--menu-display:none` are visible. Trust computed style,
    // and only parse inline CSS when the browser cannot provide it.
    if (!sawComputed) {
      display = declared.display;
      visibility = declared.visibility;
    }
    if (visibility === "hidden" || visibility === "collapse") return true;
    return display === "none";
  }

  function inlineVisibility(styleText) {
    let display = "";
    let visibility = "";
    for (const decl of String(styleText || "").split(";")) {
      const splitAt = decl.indexOf(":");
      if (splitAt < 0) continue;
      const prop = decl.slice(0, splitAt).trim().toLowerCase();
      const value = decl.slice(splitAt + 1).trim().toLowerCase().split(/\s+/)[0] || "";
      if (prop === "display") display = value;
      else if (prop === "visibility") visibility = value;
    }
    return { display, visibility };
  }

  // text() is also called on a [dir=auto] node directly. Hiding is often on a wrapper, not on
  // that span, so the check has to walk ancestors. Collapse is suspended before this runs.
  function concealed(node) {
    for (let current = node; current; current = current.parentElement) {
      if (extensionChrome(current) || pageHidden(current)) return true;
    }
    return false;
  }

  function text(el) {
    return withCollapseSuspended(() => readText(el));
  }

  function readText(el) {
    if (!el || concealed(el)) return "";
    const chunks = [];
    const blocks = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "SECTION", "TR"]);
    const walk = node => {
      if (!node || concealed(node)) return;
      if (node.nodeType === 3) {
        chunks.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType && node.nodeType !== 1) return;
      const tag = String(node.tagName || "").toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG" || tag === "TEMPLATE") return;
      if (tag === "BR") {
        chunks.push("\n");
        return;
      }
      for (const child of node.childNodes || []) walk(child);
      if (blocks.has(tag)) chunks.push("\n");
    };
    walk(el);
    return chunks.join("").replace(/\s+/g, " ").trim();
  }

  function simpleHash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function permalinkId(url) {
    const match = String(url || "").match(/\/(?:status|post)\/([^/?#]+)/i);
    return match?.[1] || "";
  }

  function featureKey(features) {
    // Video layout size changes as metadata arrives. It is not a different post, so it must not
    // retire a manual reveal. Still images keep their size because a different box can be a different image.
    // The status id distinguishes two posts that share a card, author, and text.
    const media = (features.images || []).map(img => (
      img?.kind === "video_poster"
        ? [img.url || "", img.alt || ""]
        : [img.url || "", img.alt || "", img.width || 0, img.height || 0]
    ));
    return simpleHash([
      features.platform || "",
      features.handle || "",
      features.displayName || "",
      features.text || "",
      features.isReply ? "reply" : "post",
      permalinkId(features.postUrl),
      JSON.stringify(media)
    ].join("\u241f"));
  }

  function rawHref(link) {
    if (!link) return "";
    return link.getAttribute?.("href") || link.href || "";
  }

  function findHandle(root) {
    if (!root) return "";
    const anchors = [...root.querySelectorAll('a[href^="/"]')]
      .filter(anchor => !anchor.closest?.(".jevlens-analysis, .jevlens-reveal"));
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
      .filter(node => !node.closest?.(".jevlens-analysis, .jevlens-reveal"))
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
      // Avatars and UI icons are small. A video poster is the same video on either side of that
      // cutoff, so its identity must not depend on the filter.
      if (kind !== "video_poster" && width && height && Math.max(width, height) < 140) return;
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
      if (img.closest?.(".jevlens-analysis, .jevlens-reveal")) continue;
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
        if (video.closest?.(".jevlens-analysis, .jevlens-reveal")) continue;
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
      postUrl: rawHref(link),
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
      postUrl: rawHref(postLink),
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
    const disabled = settingsCache?.enabled === false;
    status.textContent = disabled ? "已停用" : extra || `已分析 ${stats.analyzed} · 排隊 ${active} · 錯誤 ${stats.errors}`;
    hud.dataset.state = disabled ? "ready" : stats.errors ? "warning" : active ? "working" : "ready";
  }

  function postId(el) {
    if (!el.dataset.jevlensPost) el.dataset.jevlensPost = String(++postSerial);
    return el.dataset.jevlensPost;
  }

  // A quoted or embedded post is a descendant of the outer card and has its own analysis row.
  // Ownership is recorded on the row so outer cleanup cannot adopt or delete the inner one.
  function ownAnalysis(el) {
    const id = el.dataset.jevlensPost;
    if (!id) return null;
    for (const node of el.querySelectorAll('.jevlens-analysis[data-owner="jevlens"]')) {
      if (node.dataset.jevlensOwner === id) return node;
    }
    return null;
  }

  function removeOwnAnalysis(el) {
    const id = el.dataset.jevlensPost;
    if (!id) return;
    for (const node of [...el.querySelectorAll('.jevlens-analysis[data-owner="jevlens"]')]) {
      if (node.dataset.jevlensOwner === id) node.remove();
    }
  }

  function analysisMount(el, platform, features) {
    const id = postId(el);
    let mount = ownAnalysis(el);
    if (mount) return mount;

    mount = document.createElement("div");
    mount.className = "jevlens-analysis";
    mount.dataset.owner = "jevlens";
    mount.dataset.jevlensOwner = id;
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
    show.dataset.jevlensGeneration = String(settingsGeneration);
    show.onclick = () => {
      // The button is from a previous blocklist. A click while settings reload must not record a
      // reveal, or the next scan treats the card as finished and never classifies it.
      if (show.dataset.jevlensGeneration !== String(settingsGeneration)) return;
      el.classList.remove("jevlens-collapsed");
      reveal.remove();
      delete el.dataset.jevlensCollapse;
      if (el.dataset.jevlensKey) el.dataset.jevlensReveal = el.dataset.jevlensKey;
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

  function clearPost(el) {
    releasePostState(el);
    removeOwnAnalysis(el);
  }

  async function runItem(item) {
    running++;
    updateHud();
    const { el, features, key, mount, generation, workId } = item;
    const ownsCard = () => el.dataset.jevlensWork === workId;
    const isCurrent = () => generation === settingsGeneration && el.isConnected && el.dataset.jevlensKey === key && ownsCard();

    try {
      if (!isCurrent()) return;

      const s = await settings();
      if (!isCurrent()) return;
      if (!s.enabled) {
        clearPost(el);
        return;
      }

      const blocked = (s.localBlockedHandles || []).map(x => x.toLowerCase());
      if (features.handle && blocked.includes(features.handle.toLowerCase())) {
        const revealed = el.dataset.jevlensReveal === key;
        clearPost(el);
        if (!revealed) collapse(el, `JevLens 本機封鎖：${features.handle}`);
        // Local block needs no classifier call. A stored reveal stays visible for this post version.
        el.dataset.jevlensDone = "1";
        return;
      }

      setPending(mount);
      const reply = await send({ type: "CLASSIFY", kind: "social", features });

      if (!isCurrent()) return;

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
      const revealed = el.dataset.jevlensReveal === key;
      // Release first, then apply: the new classification owns the post's presentation state.
      // A manual reveal of this same post version stays open.
      releasePostState(el);
      if (!revealed && presentation.dim) el.classList.add("jevlens-dim");
      if (!revealed && presentation.collapse) collapse(el, `JevLens 摺疊：風險 ${pct(maxRisk)}`, features.handle);
    } catch (err) {
      if (!isCurrent()) return;
      stats.errors++;
      if (mount?.isConnected) {
        renderError(mount, err?.message || String(err));
        if (el?.isConnected) el.dataset.jevlensDone = "error";
      }
    } finally {
      running--;
      // A→B→A reuses the feature key. Only the work item currently stored on the card may render
      // or retire that pending key; the first A reply is stale once a newer item exists.
      if (generation === settingsGeneration && ownsCard()) queuedKeys.delete(key);
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
    rememberPost(el);
    if (el.dataset.jevlensKey && el.dataset.jevlensKey !== key) {
      delete el.dataset.jevlensReveal;
      // A recycled card still carries the previous post's 顯示 button until the new decision lands.
      releasePostState(el);
      queuedKeys.delete(el.dataset.jevlensKey);
    }
    // A reveal is not classification. Done stays whatever the last real decision set, so a stale
    // 顯示 click cannot mark an unblocked card finished.
    if (el.dataset.jevlensKey === key && ["1", "error"].includes(el.dataset.jevlensDone)) return;
    if (queuedKeys.has(key) && el.dataset.jevlensKey === key) return;

    const old = ownAnalysis(el);
    if (old && el.dataset.jevlensKey !== key) old.remove();

    const workId = String(++workSerial);
    el.dataset.jevlensKey = key;
    el.dataset.jevlensWork = workId;
    el.dataset.jevlensDone = "0";
    const mount = analysisMount(el, features.platform, features);
    setPending(mount, "Jev · 排隊中…");

    queuedKeys.add(key);
    queue.push({ el, features, key, mount, generation: settingsGeneration, workId });
    stats.queued++;
    pump();
  }

  async function scan() {
    pruneSeenPosts();
    const generation = settingsGeneration;
    const s = await settings();
    if (generation !== settingsGeneration) return;
    if (!s.enabled) {
      visitPosts(clearPost);
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

  const observer = new MutationObserver(() => {
    if (collapseSuspended) return;
    scheduleScan(120);
  });
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
