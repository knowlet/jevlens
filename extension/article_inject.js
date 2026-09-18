(async () => {
  "use strict";

  const send = (message) => new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function extraction() {
    const title = clean(document.querySelector("h1")?.innerText || document.title);
    const byline = clean(
      document.querySelector('[rel="author"]')?.innerText ||
      document.querySelector('[class*="author" i]')?.innerText ||
      ""
    ).slice(0, 200);

    const article = document.querySelector("article, main");
    let content = clean(article?.innerText || document.body?.innerText || "").slice(0, 14000);

    const headings = article?.querySelectorAll("h1,h2,h3,h4").length || 0;
    const blocks = article?.querySelectorAll("p,li").length || 1;
    const headingDensity = headings / Math.max(1, blocks);

    const paras = [...(article?.querySelectorAll("p") || [])]
      .map(p => clean(p.innerText)).filter(Boolean);
    const uniq = new Set(paras);
    const repetitionRatio = paras.length ? 1 - (uniq.size / paras.length) : 0;

    return {
      title,
      byline,
      content,
      domain: location.hostname,
      url: location.href,
      headingDensity,
      repetitionRatio
    };
  }

  function pct(n) { return `${Math.round((Number(n) || 0) * 100)}%`; }

  const old = document.getElementById("jevlens-article-card");
  if (old) old.remove();

  const features = extraction();
  const response = await send({ type: "CLASSIFY", kind: "article", features });

  const card = document.createElement("div");
  card.id = "jevlens-article-card";

  const close = document.createElement("button");
  close.textContent = "×";
  close.title = "關閉";
  close.onclick = () => card.remove();
  card.appendChild(close);

  const h = document.createElement("strong");
  h.textContent = "JevLens 分析";
  card.appendChild(h);

  if (!response?.ok) {
    const p = document.createElement("p");
    p.textContent = response?.disabled ? "JevLens 已停用。" : `分析失敗：${response?.error || "unknown"}`;
    card.appendChild(p);
    document.documentElement.appendChild(card);
    return;
  }

  const r = response.result;
  const s = response.settings || {};
  // Article results carry engagement bait only as a risk score (no label), so state the band and
  // let the row renderer add the percentage. Without this the row was filtered out and never shown.
  const baitBand = (value) => {
    const score = Number(value) || 0;
    if (score >= 0.66) return "likely";
    if (score >= 0.33) return "possible";
    return "unlikely";
  };
  const rows = [
    ...(s.showPolitical !== false ? [
      ["政治內容", r.labels?.political_content, r.confidence?.political_content],
      ["政治傾向", r.labels?.ideological_tilt, r.confidence?.ideological_tilt]
    ] : []),
    ...(s.showTraffic !== false ? [
      ["流量/修辭型態", r.labels?.traffic_strategy, r.confidence?.traffic_strategy],
      ["Engagement bait", baitBand(r.risk?.engagement_bait), r.risk?.engagement_bait]
    ] : []),
    ...(s.showAiFarm !== false ? [
      ["AI/內容農場", r.labels?.ai_farm, r.risk?.ai_farm]
    ] : [])
  ].filter(x => x[1] !== undefined && x[1] !== "");

  const list = document.createElement("div");
  list.style.marginTop = "10px";
  for (const [k,v,s] of rows) {
    const row = document.createElement("div");
    row.style.margin = "5px 0";
    row.textContent = `${k}：${v}${s != null ? ` (${pct(s)})` : ""}`;
    list.appendChild(row);
  }
  card.appendChild(list);

  if (r.flags?.length) {
    const small = document.createElement("small");
    small.textContent = `Signals: ${r.flags.join(", ")}`;
    card.appendChild(small);
  }

  const note = document.createElement("div");
  note.style.marginTop = "10px";
  note.style.opacity = ".72";
  note.style.fontSize = "11px";
  note.textContent = "政治標籤是描述性分類，不代表真偽、品質或投票建議；低信心結果應視為不確定。";
  card.appendChild(note);

  document.documentElement.appendChild(card);
})();
