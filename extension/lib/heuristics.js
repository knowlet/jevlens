(() => {
  "use strict";

  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const rx = (parts) => new RegExp(parts.join("|"), "i");

  const AI_PHRASES = rx([
    "\\bin conclusion\\b", "\\bdelve\\b", "\\bcrucial to note\\b", "\\bit is worth noting\\b",
    "\\bcomprehensive guide\\b", "\\bunlock the power\\b", "\\bin today's fast-paced\\b",
    "總而言之", "值得注意的是", "不可忽視的是", "在這個快速變化", "深入探討", "完整指南"
  ]);

  const CLICKBAIT = rx([
    "你不會相信", "震驚", "驚呆", "全網瘋傳", "一定要看", "懶人包", "真相曝光",
    "網友全炸鍋", "看完秒懂", "竟然", "沒想到", "最後一個", "the truth about",
    "you won't believe", "shocking", "this changes everything", "must see"
  ]);

  const RAGE = rx([
    "可恥", "噁心", "智障", "腦殘", "垃圾", "滾出去", "賣國", "叛徒", "亡國", "荒謬至極",
    "disgusting", "traitor", "idiot", "moron", "destroying our country", "enemy of the people"
  ]);

  const OPINION = rx([
    "我認為", "我覺得", "我看", "支持", "反對", "根本", "荒謬", "可笑", "不合理", "太扯", "這樣也叫",
    "i think", "i believe", "i support", "i oppose", "i favor", "i favour", "ridiculous", "absurd"
  ]);

  const CTA = rx([
    "轉發", "分享出去", "分享給", "讓更多人看到", "快傳", "留言告訴我", "同意請按", "不轉不是", "追蹤我",
    "share this", "repost", "retweet", "comment below", "follow for more", "like and share"
  ]);

  const SEO = rx([
    "最佳\\s*\\d+", "top\\s*\\d+", "推薦\\s*\\d+", "懶人包", "完整攻略", "購買指南",
    "best .* 2026", "ultimate guide", "everything you need to know", "how to .* step by step"
  ]);

  const POLITICAL = rx([
    "總統", "副總統", "立法院", "立委", "行政院", "市議會", "市府", "縣府", "市長", "議員", "候選人", "政黨", "選舉", "罷免",
    "國會", "政府", "政策", "政見", "施政", "公投", "法案", "預算案", "國民黨", "民進黨", "民眾黨",
    "中國共產黨", "民主黨", "共和黨", "congress", "president", "election", "government", "parliament",
    "democrat", "republican", "policy", "legislation", "candidate", "mayor", "referendum"
  ]);

  const LEFT = rx([
    "progressive", "social justice", "wealth tax", "labor rights", "labor protections", "union rights", "public housing",
    "公共住宅", "財富稅", "勞權", "工會權", "社會福利", "進步派"
  ]);

  const RIGHT = rx([
    "conservative", "traditional values", "law and order", "lower taxes", "lower .*tax", "small government", "government spending",
    "保守派", "傳統價值", "減稅", "小政府", "治安優先"
  ]);

  const ADULT = rx([
    "onlyfans", "fansly", "nsfw", "18\\+", "成人", "私密照", "約炮", "裸聊", "情色",
    "加line", "加賴", "telegram.*私", "私訊看", "免費影片", "點我主頁"
  ]);

  const PROMO = rx([
    "promo", "discount", "coupon", "referral", "airdrop", "giveaway", "dm me",
    "優惠碼", "折扣碼", "抽獎", "空投", "私訊我", "加群", "投資群", "帶單"
  ]);

  const GENERIC_REPLY = rx([
    "^great[!. ]*$", "^nice[!. ]*$", "^wow[!. ]*$", "^amazing[!. ]*$", "^exactly[!. ]*$",
    "^this[!. ]*$", "^facts[!. ]*$", "^好文[!！。 ]*$", "^真的[!！。 ]*$",
    "^同意[!！。 ]*$", "^太棒了[!！。 ]*$", "^支持[!！。 ]*$", "^笑死[!！。 ]*$"
  ]);

  const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s!?！。.]+$/u;

  function countMatches(text, regex) {
    if (!text) return 0;
    const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
    const r = new RegExp(regex.source, flags);
    return [...text.matchAll(r)].length;
  }

  function ideologicalTilt(text, political) {
    if (!political) return "not_applicable";
    const left = countMatches(text, LEFT);
    const right = countMatches(text, RIGHT);
    if (left >= right + 2) return "left_leaning";
    if (right >= left + 2) return "right_leaning";
    if (left && right) return "mixed_or_center";
    return "unclear";
  }

  function article(features) {
    const text = `${features.title || ""}\n${features.content || ""}`.slice(0, 14000);
    const len = text.length;
    const ai = countMatches(text, AI_PHRASES);
    const click = countMatches(text, CLICKBAIT);
    const rage = countMatches(text, RAGE);
    const cta = countMatches(text, CTA);
    const seo = countMatches(text, SEO);
    const political = POLITICAL.test(text) || LEFT.test(text) || RIGHT.test(text);

    const repetition = features.repetitionRatio || 0;
    const headingDensity = features.headingDensity || 0;
    const exclamationDensity = (text.match(/[!！]/g) || []).length / Math.max(1, len / 500);

    const aiRisk = clamp((ai * 0.17) + repetition * 0.35 + (headingDensity > 0.16 ? 0.18 : 0));
    const farmRisk = clamp(aiRisk * 0.55 + seo * 0.12 + click * 0.04 + (len < 1600 ? 0.05 : 0));
    const baitRisk = clamp(click * 0.18 + rage * 0.14 + cta * 0.16 + Math.min(exclamationDensity / 8, 0.12));

    let trafficStrategy = "normal";
    if (rage >= 2 && baitRisk >= 0.45) trafficStrategy = "rage_bait";
    else if (click >= 2) trafficStrategy = "clickbait";
    else if (cta >= 2) trafficStrategy = "engagement_bait";
    else if (seo >= 2) trafficStrategy = "seo_farm_like";
    else if (political && (rage + cta) >= 3) trafficStrategy = "agenda_amplification_style";

    const flags = [];
    if (ai >= 2) flags.push("formulaic_ai_phrasing");
    if (seo >= 2) flags.push("seo_template_signals");
    if (click >= 2) flags.push("clickbait_hooks");
    if (rage >= 2) flags.push("high_arousal_language");
    if (cta >= 2) flags.push("engagement_calls_to_action");
    if (repetition > 0.25) flags.push("repetitive_structure");

    return {
      source: "local_heuristic",
      kind: "article",
      labels: {
        political_content: political ? "political" : "non_political",
        ideological_tilt: ideologicalTilt(text, political),
        traffic_strategy: trafficStrategy,
        ai_farm: farmRisk >= 0.66 ? "likely" : farmRisk >= 0.38 ? "possible" : "unlikely"
      },
      risk: {
        ai_farm: Number(farmRisk.toFixed(3)),
        engagement_bait: Number(baitRisk.toFixed(3))
      },
      confidence: {
        political_content: political ? 0.72 : 0.64,
        ideological_tilt: political ? 0.55 : 0.95,
        traffic_strategy: Math.min(0.83, 0.5 + (click + rage + cta + seo) * 0.04)
      },
      flags
    };
  }

  function mediaEvidence(features) {
    const evidence = features.imageEvidence || {};
    const images = Array.isArray(evidence.images) ? evidence.images : [];
    const textParts = [];
    let adultContent = 0;
    let adultPromo = 0;
    let political = 0;
    const flags = [];

    for (const img of images) {
      if (img.alt) textParts.push(img.alt);
      if (img.ocr?.text) textParts.push(img.ocr.text);
      for (const value of (img.qr?.values || [])) textParts.push(value);

      const v = img.visual || {};
      if (v.adult_visual === "explicit") adultContent = Math.max(adultContent, 0.95);
      else if (v.adult_visual === "suggestive") adultContent = Math.max(adultContent, 0.55);
      if (v.nudity) adultContent = Math.max(adultContent, 0.88);
      if (v.sexual_pose) adultContent = Math.max(adultContent, 0.72);

      if (v.adult_promo_visual === "likely") adultPromo = Math.max(adultPromo, 0.93);
      else if (v.adult_promo_visual === "possible") adultPromo = Math.max(adultPromo, 0.52);
      if (v.contact_or_subscription_cta && adultContent >= 0.5) adultPromo = Math.max(adultPromo, 0.72);
      if (v.price_or_offer_visible && adultContent >= 0.5) adultPromo = Math.max(adultPromo, 0.68);

      if (v.political_visual === "likely") political = Math.max(political, 0.88);
      else if (v.political_visual === "possible") political = Math.max(political, 0.48);

      // Skin fraction is deliberately weak evidence: portraits, sports and swimwear can all have high values.
      const skin = Number(img.pixelSignals?.skin_fraction || 0);
      if (skin >= 0.72) adultContent = Math.max(adultContent, 0.18);
    }

    const extractedText = textParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 5000);
    const adultTextHits = countMatches(extractedText, ADULT);
    const promoTextHits = countMatches(extractedText, PROMO);
    if (adultTextHits) {
      adultContent = Math.max(adultContent, clamp(0.38 + adultTextHits * 0.18));
      flags.push("image_text_adult_terms");
    }
    if (adultTextHits && promoTextHits) {
      adultPromo = Math.max(adultPromo, clamp(0.42 + adultTextHits * 0.16 + promoTextHits * 0.10));
      flags.push("image_text_adult_promo_terms");
    }
    if (images.some(img => img.visual?.adult_visual === "explicit" || img.visual?.adult_visual === "suggestive")) {
      flags.push("adult_visual_signal");
    }
    if (images.some(img => ["likely", "possible"].includes(img.visual?.adult_promo_visual))) {
      flags.push("adult_promo_visual_signal");
    }

    return { extractedText, adultContent, adultPromo, political, flags };
  }

  function social(features) {
    const media = mediaEvidence(features);
    const body = (features.text || "").trim();
    const combinedBody = `${body}\n${media.extractedText}`.trim();
    const text = `${features.displayName || ""}\n${features.handle || ""}\n${combinedBody}`.trim();
    const adultHits = countMatches(text, ADULT);
    const promoHits = countMatches(text, PROMO);
    const ctaHits = countMatches(combinedBody, CTA);
    const clickHits = countMatches(combinedBody, CLICKBAIT);
    const rageHits = countMatches(combinedBody, RAGE);
    const seoHits = countMatches(combinedBody, SEO);
    const aiHits = countMatches(combinedBody, AI_PHRASES);
    const opinionHits = countMatches(combinedBody, OPINION);
    const political = POLITICAL.test(combinedBody) || LEFT.test(combinedBody) || RIGHT.test(combinedBody) || media.political >= 0.7;
    const generic = GENERIC_REPLY.test(body);
    const emojiOnly = body.length > 0 && EMOJI_ONLY.test(body);
    const mentionCount = (body.match(/@[\p{L}\p{N}_.]+/gu) || []).length;
    const urlCount = (body.match(/https?:\/\/|www\./gi) || []).length;
    const hashtagCount = (body.match(/#[\p{L}\p{N}_]+/gu) || []).length;

    let replyQuality = features.isReply ? "substantive" : "not_applicable";
    if (features.isReply) {
      if (emojiOnly) replyQuality = "emoji_only";
      else if (generic) replyQuality = "generic_reply";
      else if (promoHits || urlCount >= 2) replyQuality = "promotional";
      else if (body.length < 8) replyQuality = "low_information";
    }

    let rhetoricalStyle = "neutral_informational";
    if (promoHits >= 1 && (urlCount >= 1 || /優惠|折扣|promo|coupon|referral/i.test(body))) rhetoricalStyle = "promotional";
    else if (clickHits >= 1) rhetoricalStyle = "clickbait";
    else if (ctaHits >= 1) rhetoricalStyle = "engagement_bait";
    else if (rageHits >= 1) rhetoricalStyle = "high_arousal_opinion";
    else if (political && /大家|一起|一定要|拒絕|抵制|站出來|投給|vote for|stand up|boycott/i.test(body)) rhetoricalStyle = "mobilizing_or_agenda";
    else if (seoHits >= 1) rhetoricalStyle = "seo_template";
    else if (opinionHits >= 1 || /[!?！？]{2,}/.test(body)) rhetoricalStyle = "opinionated_commentary";

    const trafficManipulation = clamp(
      clickHits * 0.32 +
      ctaHits * 0.30 +
      Math.max(0, hashtagCount - 4) * 0.04 +
      Math.max(0, mentionCount - 3) * 0.05 +
      rageHits * 0.10 +
      (rhetoricalStyle === "promotional" ? 0.08 : 0)
    );

    const aiFarm = clamp(
      aiHits * 0.24 +
      seoHits * 0.12 +
      (body.length > 1400 && /首先|其次|最後|總結|in conclusion|firstly|secondly/gi.test(body) ? 0.12 : 0)
    );

    const adultContent = clamp(Math.max(
      media.adultContent,
      adultHits > 0 ? 0.30 + adultHits * 0.18 : 0
    ));
    const adultPromo = clamp(Math.max(
      media.adultPromo,
      adultHits > 0 ? adultHits * 0.40 + promoHits * 0.08 + urlCount * 0.05 : 0
    ));
    const spam = clamp(
      (features.isReply && generic ? 0.24 : 0) +
      promoHits * 0.2 +
      adultHits * 0.14 +
      adultPromo * 0.42 +
      Math.max(0, mentionCount - 2) * 0.08 +
      Math.max(0, hashtagCount - 3) * 0.05 +
      urlCount * 0.1 +
      ctaHits * 0.10
    );

    const botLike = clamp(
      spam * 0.58 +
      (features.isReply && generic ? 0.15 : 0) +
      ((features.handle || "").match(/\d{5,}$/) ? 0.11 : 0) +
      ((features.displayName || "").length > 0 && (features.displayName || "").length <= 2 ? 0.06 : 0)
    );

    const flags = [];
    if (features.isReply && generic) flags.push("generic_reply_pattern");
    if (emojiOnly) flags.push("emoji_only");
    if (promoHits) flags.push("promotion_terms");
    if (adultHits) flags.push("adult_promo_terms");
    if (mentionCount > 2) flags.push("mention_spray");
    if (urlCount > 1) flags.push("link_heavy");
    if (hashtagCount > 3) flags.push("hashtag_stuffing");
    if (rageHits) flags.push("high_arousal_language");
    if (clickHits) flags.push("clickbait_hooks");
    if (ctaHits) flags.push("engagement_calls_to_action");
    if (aiHits) flags.push("formulaic_ai_phrasing");
    flags.push(...media.flags);

    return {
      source: "local_heuristic",
      kind: "social",
      labels: {
        political_content: political ? "political" : "non_political",
        ideological_tilt: ideologicalTilt(combinedBody, political),
        rhetorical_style: rhetoricalStyle,
        traffic_manipulation: trafficManipulation >= 0.66 ? "likely" : trafficManipulation >= 0.30 ? "possible" : "unlikely",
        ai_farm: aiFarm >= 0.66 ? "likely" : aiFarm >= 0.34 ? "possible" : "unlikely",
        reply_quality: replyQuality,
        spam: spam >= 0.68 ? "likely" : spam >= 0.38 ? "possible" : "unlikely",
        bot_like: botLike >= 0.68 ? "likely" : botLike >= 0.38 ? "possible" : "unlikely",
        adult_content: adultContent >= 0.72 ? "likely" : adultContent >= 0.34 ? "possible" : "unlikely",
        adult_promo: adultPromo >= 0.62 ? "likely" : adultPromo >= 0.30 ? "possible" : "unlikely"
      },
      risk: {
        traffic_manipulation: Number(trafficManipulation.toFixed(3)),
        ai_farm: Number(aiFarm.toFixed(3)),
        spam: Number(spam.toFixed(3)),
        bot_like: Number(botLike.toFixed(3)),
        adult_content: Number(adultContent.toFixed(3)),
        adult_promo: Number(adultPromo.toFixed(3))
      },
      confidence: {
        political_content: political ? 0.74 : 0.64,
        ideological_tilt: political ? 0.54 : 0.95,
        rhetorical_style: Math.min(0.88, 0.58 + (rageHits + clickHits + ctaHits + seoHits + promoHits) * 0.05),
        traffic_manipulation: Math.min(0.88, 0.60 + (clickHits + ctaHits) * 0.06),
        ai_farm: Math.min(0.82, 0.55 + (aiHits + seoHits) * 0.05),
        reply_quality: features.isReply ? Math.min(0.9, 0.58 + flags.length * 0.04) : 0.98,
        spam: Math.min(0.88, 0.52 + flags.length * 0.05),
        bot_like: Math.min(0.80, 0.45 + flags.length * 0.035),
        adult_content: Math.min(0.92, 0.56 + adultHits * 0.08 + (media.adultContent >= 0.5 ? 0.18 : 0)),
        adult_promo: Math.min(0.92, 0.56 + adultHits * 0.08 + (media.adultPromo >= 0.5 ? 0.20 : 0))
      },
      flags
    };
  }

  globalThis.JevLensHeuristics = { article, social };
})();
