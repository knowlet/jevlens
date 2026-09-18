(() => {
  "use strict";
  const base = globalThis.JevLensEvalCases || [];
  for (const c of base) if (!c.split) c.split = "regression";

  const holdout = [
    {
      id: "holdout-tw-city-policy-101", split: "holdout", kind: "social", language: "zh-TW",
      tags: ["politics", "holdout"],
      features: { platform: "threads", isReply: false, text: "市府說下個月要調整公車路線，我比較在意轉乘時間有沒有真的縮短，先把數據公開再決定比較合理。" },
      expected: { labels: { political_content: ["political"], ideological_tilt: ["unclear"], spam: ["unlikely"] } }
    },
    {
      id: "holdout-en-council-transit-102", split: "holdout", kind: "social", language: "en",
      tags: ["politics", "holdout"],
      features: { platform: "x", isReply: false, text: "The city council approved the transit budget after a 6-hour meeting. The bus-lane amendment passed, while the parking subsidy was removed." },
      expected: { labels: { political_content: ["political"], ideological_tilt: ["unclear", "mixed_or_center"], rhetorical_style: ["neutral_informational"] } }
    },
    {
      id: "holdout-ja-government-policy-103", split: "holdout", kind: "social", language: "ja",
      tags: ["politics", "multilingual", "holdout"],
      features: { platform: "threads", isReply: false, text: "政府は来年度の交通政策案を発表した。予算配分と地方自治体への補助金が主な論点になっている。" },
      expected: { labels: { political_content: ["political"], ideological_tilt: ["unclear"], spam: ["unlikely"] } }
    },
    {
      id: "holdout-product-review-104", split: "holdout", kind: "social", language: "zh-TW",
      tags: ["negative-control", "holdout"],
      features: { platform: "threads", isReply: false, text: "這個鍵盤用了兩週，鍵程短、藍牙切換快，但方向鍵太小。我最後還是換回原本那把。" },
      expected: { labels: { political_content: ["non_political"], spam: ["unlikely"], traffic_manipulation: ["unlikely"] } }
    },
    {
      id: "holdout-id-normal-question-105", split: "holdout", kind: "social", language: "id",
      tags: ["multilingual", "negative-control", "holdout"],
      features: { platform: "threads", isReply: true, text: "Apakah ada yang sudah mencoba versi terbaru? Di perangkat saya baterainya terasa lebih boros." },
      expected: { labels: { reply_quality: ["substantive"], spam: ["unlikely"], adult_promo: ["unlikely"] } }
    },
    {
      id: "holdout-adult-euphemism-106", split: "holdout", kind: "social", language: "en",
      tags: ["adult", "spam", "holdout"],
      features: { platform: "x", isReply: true, handle: "@secretroom884422", text: "🔞 exclusive private content in bio — message me for access 💋" },
      expected: { labels: { adult_promo: ["likely", "possible"], spam: ["possible", "likely"] } }
    },
    {
      id: "holdout-es-generic-reply-107", split: "holdout", kind: "social", language: "es",
      tags: ["reply", "generic", "multilingual", "holdout"],
      features: { platform: "x", isReply: true, text: "¡Excelente!" },
      expected: { labels: { reply_quality: ["generic_reply", "low_information"], spam: ["unlikely", "possible"] } }
    },
    {
      id: "holdout-ja-generic-reply-108", split: "holdout", kind: "social", language: "ja",
      tags: ["reply", "generic", "multilingual", "holdout"],
      features: { platform: "threads", isReply: true, text: "すごい！" },
      expected: { labels: { reply_quality: ["generic_reply", "low_information"], spam: ["unlikely", "possible"] } }
    },
    {
      id: "holdout-zh-link-spray-109", split: "holdout", kind: "social", language: "zh-TW",
      tags: ["spam", "bot-like", "holdout"],
      features: { platform: "x", isReply: true, handle: "@gift99881234", text: "免費抽獎！@aa @bb @cc @dd 快來領，追蹤＋轉發＋私訊我 https://a.test https://b.test" },
      expected: { labels: { spam: ["likely", "possible"], bot_like: ["likely", "possible"], reply_quality: ["promotional", "generic_reply"] } }
    },
    {
      id: "holdout-crypto-promo-110", split: "holdout", kind: "social", language: "en",
      tags: ["spam", "promotion", "holdout"],
      features: { platform: "x", isReply: true, text: "Join my private crypto signals group. 90% win rate, DM me now and use referral code ALPHA https://example.test" },
      expected: { labels: { spam: ["likely", "possible"], reply_quality: ["promotional"], adult_promo: ["unlikely"] } }
    },
    {
      id: "holdout-political-rage-en-111", split: "holdout", kind: "social", language: "en",
      tags: ["politics", "high-arousal", "holdout"],
      features: { platform: "threads", isReply: false, text: "This is an idiotic policy. The mayor keeps pretending the traffic problem will vanish without publishing any data or cost estimate." },
      expected: { labels: { political_content: ["political"], ideological_tilt: ["unclear"], rhetorical_style: ["high_arousal_opinion"] } }
    },
    {
      id: "holdout-movie-rage-112", split: "holdout", kind: "social", language: "en",
      tags: ["nonpolitical", "high-arousal", "holdout"],
      features: { platform: "threads", isReply: false, text: "That finale was idiotic. Three seasons of setup thrown away in five minutes. What a ridiculous ending." },
      expected: { labels: { political_content: ["non_political"], rhetorical_style: ["high_arousal_opinion"], spam: ["unlikely"] } }
    },
    {
      id: "holdout-article-ai-zh-113", split: "holdout", kind: "article", language: "zh-TW",
      tags: ["article", "ai-farm", "holdout"],
      features: { title: "2026 完整效率工具指南", domain: "example.test", headingDensity: 0.23, repetitionRatio: 0.31, content: "在這個快速變化的數位時代，值得注意的是效率至關重要。首先我們深入探討工具選擇，其次整理使用技巧。總而言之，這份完整指南可以協助你提升效率。" },
      expected: { labels: { political_content: ["non_political"], ai_farm: ["possible", "likely"], traffic_strategy: ["seo_farm_like", "normal"] } }
    },
    {
      id: "holdout-article-neutral-zh-114", split: "holdout", kind: "article", language: "zh-TW",
      tags: ["article", "negative-control", "holdout"],
      features: { title: "SQLite WAL 模式測試紀錄", domain: "example.test", headingDensity: 0.04, repetitionRatio: 0, content: "測試使用相同資料集與固定同步設定，比較 WAL 與 rollback journal。WAL 在多讀者情境下延遲較低，但寫入峰值沒有明顯改善。" },
      expected: { labels: { political_content: ["non_political"], ai_farm: ["unlikely", "unclear"], traffic_strategy: ["normal"] } }
    },
    {
      id: "holdout-article-policy-critique-115", split: "holdout", kind: "article", language: "zh-TW",
      tags: ["article", "politics", "holdout"],
      features: { title: "交通預算應先公開成本效益", domain: "example.test", headingDensity: 0.06, repetitionRatio: 0, content: "本文認為市府在推動新交通建設前，應先公開成本、運量與替代方案。這是對施政程序的批評，並未主張特定政黨立場。" },
      expected: { labels: { political_content: ["political"], ideological_tilt: ["unclear"], traffic_strategy: ["normal", "agenda_amplification_style"] } }
    },
    {
      id: "holdout-sex-ed-zh-116", split: "holdout", kind: "social", language: "zh-TW",
      tags: ["adult-negative-control", "holdout"],
      features: { platform: "threads", isReply: false, text: "性教育課應該包含同意、避孕與網路安全，也要教學生遇到騷擾時怎麼求助。" },
      expected: { labels: { adult_promo: ["unlikely"], spam: ["unlikely"], reply_quality: ["not_applicable"] } }
    },
    {
      id: "holdout-generic-support-117", split: "holdout", kind: "social", language: "zh-TW",
      tags: ["reply", "generic", "holdout"],
      features: { platform: "threads", isReply: true, text: "支持！" },
      expected: { labels: { reply_quality: ["generic_reply", "low_information"], spam: ["unlikely", "possible"] } }
    },
    {
      id: "holdout-article-clickbait-en-118", split: "holdout", kind: "article", language: "en",
      tags: ["article", "clickbait", "holdout"],
      features: { title: "You Won't Believe What Happened Next", domain: "example.test", headingDensity: 0.07, repetitionRatio: 0, content: "Shocking details are finally here. The truth about the final decision changes everything. Must see the last part." },
      expected: { labels: { political_content: ["non_political"], traffic_strategy: ["clickbait", "rage_bait"], ai_farm: ["unlikely", "possible"] } }
    }
  ];

  globalThis.JevLensEvalCases = [...base, ...holdout];
})();
