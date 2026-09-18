(() => {
  "use strict";

  const DEFAULT_LIMIT = 3;
  // A category below this score is not worth a chip. Posts whose signals are all that weak get a
  // single muted chip instead of a row of "0%" labels.
  const SCORE_FLOOR = 0.02;

  const LABELS = {
    political: {
      political: "政治",
      non_political: "非政治",
      unclear: "政治？"
    },
    tilt: {
      left_leaning: "偏左",
      mixed_or_center: "混合/中間",
      right_leaning: "偏右",
      unclear: "不明",
      not_applicable: "不適用"
    },
    rhetoric: {
      neutral_informational: "資訊型",
      opinionated_commentary: "評論",
      high_arousal_opinion: "高情緒評論",
      clickbait: "Clickbait",
      engagement_bait: "互動誘餌",
      mobilizing_or_agenda: "動員/議題放大",
      seo_template: "SEO 模板",
      promotional: "推廣",
      unclear: "不明"
    },
    quality: {
      substantive: "有內容",
      generic_reply: "泛用回覆",
      low_information: "低資訊",
      emoji_only: "Emoji",
      promotional: "推廣",
      off_topic: "離題",
      unclear: "不明",
      not_applicable: "不適用"
    }
  };

  function labelText(group, value) {
    return LABELS[group]?.[value] || value || "unclear";
  }

  function pct(n) {
    return `${Math.round((Number(n) || 0) * 100)}%`;
  }

  function clamp01(n) {
    const value = Number(n);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  function riskLevel(n, threshold = 0.68) {
    const value = clamp01(n);
    if (value >= threshold) return "high";
    if (value >= threshold * 0.55) return "medium";
    return "low";
  }

  function providerName(result) {
    return String(result?.source || "").startsWith("local") ? "local" : "Jev";
  }

  function confidenceNote(result, name) {
    const value = Number(result?.confidence?.[name]);
    if (!Number.isFinite(value)) return "";
    return `${providerName(result)} confidence: ${pct(value)}`;
  }

  // political_content is answered as a choice, so the chip needs P(political) rather than the
  // top-choice confidence: a confident "non_political" would otherwise outrank real risk signals.
  function politicalLikelihood(result) {
    const probabilities = result?.diagnostics?.answer_choices?.politicalContent?.probabilities;
    const fromModel = Number(probabilities?.political);
    if (Number.isFinite(fromModel)) return clamp01(fromModel);

    const label = result?.labels?.political_content;
    if (label === "political") return clamp01(result?.confidence?.political_content || 0.7);
    if (label === "unclear") return 0.4;
    return 0;
  }

  const RISK_SIGNALS = [
    { setting: "showSpam", key: "spam", label: "垃圾" },
    { setting: "showBot", key: "bot_like", label: "Bot-like" },
    { setting: "showAdultContent", key: "adult_content", label: "成人內容" },
    { setting: "showAdultPromo", key: "adult_promo", label: "成人推廣" },
    { setting: "showAiFarm", key: "ai_farm", label: "AI農場" },
    { setting: "showTraffic", key: "traffic_manipulation", label: "流量操作" }
  ];

  function politicalCandidate(result, settings) {
    if (settings.showPolitical === false) return null;
    const score = politicalLikelihood(result);
    if (!(score > 0)) return null;

    const label = result?.labels?.political_content;
    const tilt = result?.labels?.ideological_tilt;
    const tiltSuffix = label === "political" && tilt && tilt !== "not_applicable"
      ? ` · ${labelText("tilt", tilt)}`
      : "";

    return {
      key: "political",
      label: `政治${tiltSuffix}`,
      score,
      title: [
        `political=${label || "unclear"}`,
        `tilt=${tilt || "unclear"}`,
        confidenceNote(result, "political_content")
      ].filter(Boolean).join("; ")
    };
  }

  function riskCandidate(result, spec) {
    return {
      key: spec.key,
      label: spec.label,
      score: clamp01(result?.risk?.[spec.key]),
      title: `label=${result?.labels?.[spec.key] || "unclear"}; ${confidenceNote(result, spec.key)}`.trim()
    };
  }

  // Every enabled category with its score, highest first. Ties keep declaration order.
  function candidates(result, settings = {}) {
    const list = [];
    const political = politicalCandidate(result, settings);
    if (political) list.push(political);

    for (const spec of RISK_SIGNALS) {
      if (settings[spec.setting] === false) continue;
      list.push(riskCandidate(result, spec));
    }

    const threshold = Number(settings.threshold || 0.68);
    return list
      .sort((a, b) => b.score - a.score)
      .map(item => ({ ...item, threshold }));
  }

  // The short list rendered in the feed row.
  function ranked(result, settings = {}, limit = DEFAULT_LIMIT) {
    return candidates(result, settings)
      .filter(item => item.score >= SCORE_FLOOR)
      .slice(0, Math.max(0, limit));
  }

  function describeCandidates(result, settings = {}) {
    return candidates(result, settings)
      .map(item => `${item.label} ${pct(item.score)}`)
      .join(" | ");
  }

  function chip(text, { title = "", risk = "low", kind = "" } = {}) {
    const span = document.createElement("span");
    span.className = "jevlens-chip";
    span.dataset.risk = risk;
    if (kind) span.dataset.kind = kind;
    span.textContent = text;
    if (title) span.title = title;
    return span;
  }

  function resultChip(item) {
    return chip(`${item.label} ${pct(item.score)}`, {
      title: item.title,
      risk: riskLevel(item.score, item.threshold)
    });
  }

  function textChip(label, value, title = "") {
    return chip(value ? `${label} ${value}`.trim() : label, { title, kind: "meta" });
  }

  function renderSignalChips(mount, result, settings = {}, limit = DEFAULT_LIMIT) {
    const chips = ranked(result, settings, limit);
    if (!chips.length) {
      const summary = describeCandidates(result, settings);
      mount.appendChild(chip("無明顯訊號", {
        title: summary ? `最高分數：${summary}` : "沒有可用的類別分數",
        kind: "empty"
      }));
      return chips;
    }
    for (const item of chips) mount.appendChild(resultChip(item));
    return chips;
  }

  function textOf(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function postTextNode(el, platform, features) {
    if (!el) return null;
    if (platform === "x") return el.querySelector('[data-testid="tweetText"]');

    const wanted = (features?.text || "").trim();
    const blocks = [...el.querySelectorAll('[dir="auto"]')]
      .filter(node => !node.closest?.(".jevlens-analysis"));
    if (!blocks.length) return null;

    if (wanted) {
      const exact = blocks.find(node => textOf(node) === wanted);
      if (exact) return exact;
    }

    // Same rule the extractor uses to pick the body: longest non-handle text block.
    return blocks
      .filter(node => textOf(node).length >= 2 && !/^@[\w.]+$/.test(textOf(node)))
      .sort((a, b) => textOf(b).length - textOf(a).length)[0] || null;
  }

  // The nearest ancestor that is not an inline box owns the text; that is the column the row must
  // join. Inserting anywhere else turns the row into an extra flex item beside the avatar and the
  // post shifts sideways.
  function mountColumn(el, textNode) {
    let node = textNode?.parentElement || null;
    while (node && node !== el && el.contains?.(node)) {
      const display = String(globalThis.getComputedStyle?.(node)?.display || "");
      if (display && !display.startsWith("inline")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function mountInto(el, mount, platform, features) {
    const textNode = postTextNode(el, platform, features);
    const column = mountColumn(el, textNode);

    if (column && textNode && column.contains?.(textNode)) {
      column.insertBefore(mount, textNode);
      return "column";
    }

    if (platform === "x") {
      const user = el.querySelector('[data-testid="User-Name"]');
      if (user?.parentElement) {
        user.parentElement.insertBefore(mount, user.nextSibling);
        return "header";
      }
    }

    if (textNode?.parentElement) {
      textNode.parentElement.insertBefore(mount, textNode);
      return "text";
    }

    el.prepend(mount);
    return "prepend";
  }

  globalThis.JevLensSignals = {
    DEFAULT_LIMIT,
    SCORE_FLOOR,
    LABELS,
    RISK_SIGNALS,
    labelText,
    pct,
    clamp01,
    riskLevel,
    confidenceNote,
    politicalLikelihood,
    candidates,
    ranked,
    describeCandidates,
    textChip,
    resultChip,
    renderSignalChips,
    postTextNode,
    mountInto
  };
})();
