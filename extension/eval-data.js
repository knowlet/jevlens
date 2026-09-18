(() => {
  "use strict";

  const cases = [
    {
      id: "threads-tw-policy-rage-001",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "threads", "high-arousal", "regression"],
      note: "Regression case based on the screenshot that exposed the v0.3 false 'reply unclear' presentation.",
      features: {
        platform: "threads",
        handle: "@mark_stranger",
        displayName: "mark_stranger",
        isReply: false,
        text: "一開始叫在內湖工作的人搬去內湖，這樣就不會有塞車問題，現在是要蓋自行車橋解決內湖交通問題。原來造成內湖交通塞車的元兇是腳踏車呀！真的！我千想萬想都想不出如此智障的政見！"
      },
      expected: {
        labels: {
          political_content: ["political"],
          ideological_tilt: ["unclear"],
          rhetorical_style: ["high_arousal_opinion"],
          traffic_manipulation: ["unlikely", "possible"],
          ai_farm: ["unlikely", "unclear"],
          reply_quality: ["not_applicable"],
          spam: ["unlikely"],
          bot_like: ["unlikely", "unclear"],
          adult_promo: ["unlikely"]
        },
        risk: { spam: { max: 0.35 }, adult_promo: { max: 0.2 } }
      }
    },
    {
      id: "threads-tw-policy-neutral-002",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "neutral"],
      features: {
        platform: "threads", isReply: false,
        text: "市議會今天審查交通預算，捷運延伸案與公車補助都列入議程，表決結果將在下午公布。"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["unclear", "mixed_or_center"],
          rhetorical_style: ["neutral_informational"], spam: ["unlikely"], adult_promo: ["unlikely"], reply_quality: ["not_applicable"]
        }
      }
    },
    {
      id: "social-zh-left-policy-003",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "ideology-left"],
      features: {
        platform: "x", isReply: false,
        text: "我支持提高高所得者財富稅、擴大公共住宅與勞工工會權，讓社會福利制度更完整。"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["left_leaning"],
          rhetorical_style: ["opinionated_commentary"], spam: ["unlikely"], reply_quality: ["not_applicable"]
        }
      }
    },
    {
      id: "social-en-right-policy-004",
      kind: "social",
      language: "en",
      tags: ["politics", "ideology-right"],
      features: {
        platform: "x", isReply: false,
        text: "I support lower taxes, smaller government, stronger law-and-order policy, and preserving traditional values."
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["right_leaning"],
          rhetorical_style: ["opinionated_commentary"], spam: ["unlikely"], reply_quality: ["not_applicable"]
        }
      }
    },
    {
      id: "social-en-mixed-policy-005",
      kind: "social",
      language: "en",
      tags: ["politics", "mixed"],
      features: {
        platform: "threads", isReply: false,
        text: "I favor stronger labor protections and more public housing, but also lower small-business taxes and tighter limits on government spending."
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["mixed_or_center"],
          rhetorical_style: ["opinionated_commentary"], spam: ["unlikely"]
        }
      }
    },
    {
      id: "social-tw-local-policy-006",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "local-policy", "tilt-unclear"],
      features: {
        platform: "threads", isReply: false,
        text: "這個路口每天都塞，市府應該先改善號誌和公車轉乘，再討論要不要加蓋停車場。"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["unclear"],
          rhetorical_style: ["opinionated_commentary", "neutral_informational"], spam: ["unlikely"]
        }
      }
    },
    {
      id: "social-politics-mobilize-007",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "mobilization"],
      features: {
        platform: "threads", isReply: false,
        text: "這項法案不能就這樣通過，大家一起站出來要求重新審議，請把資訊分享給關心這個議題的人。"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["unclear"],
          rhetorical_style: ["mobilizing_or_agenda", "engagement_bait"],
          traffic_manipulation: ["possible", "likely"], spam: ["unlikely", "possible"]
        }
      }
    },
    {
      id: "social-politics-clickbait-008",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "clickbait"],
      features: {
        platform: "x", isReply: false,
        text: "震驚！這項新政策背後的真相曝光，你不會相信最後一條規定。點開看完整內容。"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["unclear"], rhetorical_style: ["clickbait"],
          traffic_manipulation: ["possible", "likely"], spam: ["unlikely", "possible"]
        }
      }
    },
    {
      id: "social-tech-normal-009",
      kind: "social",
      language: "zh-TW",
      tags: ["tech", "negative-control"],
      features: {
        platform: "threads", isReply: false,
        text: "Jev 適合把工具選擇做成 typed decision，LLM 只負責理解目標，這樣可以減少 token 生成延遲。"
      },
      expected: {
        labels: {
          political_content: ["non_political"], rhetorical_style: ["neutral_informational", "opinionated_commentary"],
          traffic_manipulation: ["unlikely"], ai_farm: ["unlikely", "unclear"], spam: ["unlikely"], adult_promo: ["unlikely"]
        }
      }
    },
    {
      id: "social-science-normal-010",
      kind: "social",
      language: "en",
      tags: ["science", "negative-control"],
      features: {
        platform: "x", isReply: false,
        text: "The paper reports a 12% relative improvement on the held-out benchmark, but the confidence interval overlaps the baseline on two subsets."
      },
      expected: {
        labels: {
          political_content: ["non_political"], rhetorical_style: ["neutral_informational"],
          traffic_manipulation: ["unlikely"], spam: ["unlikely"], adult_promo: ["unlikely"]
        }
      }
    },
    {
      id: "social-nonpolitical-rage-011",
      kind: "social",
      language: "zh-TW",
      tags: ["nonpolitical", "high-arousal"],
      features: {
        platform: "threads", isReply: false,
        text: "這裁判真的爛到不可思議，最後那個判決簡直智障，整場比賽都被毀了。"
      },
      expected: {
        labels: {
          political_content: ["non_political"], rhetorical_style: ["high_arousal_opinion"],
          spam: ["unlikely"], traffic_manipulation: ["unlikely", "possible"]
        }
      }
    },
    {
      id: "social-engagement-bait-012",
      kind: "social",
      language: "zh-TW",
      tags: ["engagement-bait"],
      features: {
        platform: "threads", isReply: false,
        text: "同意的人留言 +1！記得轉發分享出去，追蹤我看更多每日整理。"
      },
      expected: {
        labels: {
          political_content: ["non_political"], rhetorical_style: ["engagement_bait"],
          traffic_manipulation: ["likely", "possible"], spam: ["possible", "likely", "unlikely"]
        },
        risk: { traffic_manipulation: { min: 0.35 } }
      }
    },
    {
      id: "social-seo-template-013",
      kind: "social",
      language: "en",
      tags: ["seo", "content-farm"],
      features: {
        platform: "x", isReply: false,
        text: "Top 10 productivity apps in 2026: the ultimate guide. Everything you need to know, step by step, with the best picks for every user."
      },
      expected: {
        labels: {
          political_content: ["non_political"], rhetorical_style: ["seo_template", "clickbait"],
          ai_farm: ["possible", "likely", "unlikely"], traffic_manipulation: ["possible", "likely", "unlikely"]
        }
      }
    },
    {
      id: "social-ai-formulaic-014",
      kind: "social",
      language: "en",
      tags: ["ai-farm"],
      features: {
        platform: "threads", isReply: false,
        text: "In today's fast-paced digital landscape, it is worth noting that productivity is crucial. In conclusion, this comprehensive guide will help you unlock the power of efficient workflows. Follow for more comprehensive guides."
      },
      expected: {
        labels: {
          political_content: ["non_political"], ai_farm: ["possible", "likely"],
          rhetorical_style: ["engagement_bait", "seo_template"], traffic_manipulation: ["possible", "likely"]
        },
        risk: { ai_farm: { min: 0.2 } }
      }
    },
    {
      id: "reply-generic-zh-015",
      kind: "social",
      language: "zh-TW",
      tags: ["reply", "generic"],
      features: { platform: "threads", isReply: true, text: "好文！" },
      expected: {
        labels: {
          reply_quality: ["generic_reply", "low_information"], spam: ["unlikely", "possible"],
          political_content: ["non_political", "unclear"], adult_promo: ["unlikely"]
        }
      }
    },
    {
      id: "reply-generic-en-016",
      kind: "social",
      language: "en",
      tags: ["reply", "generic"],
      features: { platform: "x", isReply: true, text: "Amazing!" },
      expected: {
        labels: { reply_quality: ["generic_reply", "low_information"], spam: ["unlikely", "possible"], adult_promo: ["unlikely"] }
      }
    },
    {
      id: "reply-substantive-tech-017",
      kind: "social",
      language: "en",
      tags: ["reply", "substantive", "negative-control"],
      features: {
        platform: "x", isReply: true,
        parentText: "This model gets 150 tok/s, so it is faster than the other benchmark.",
        text: "The benchmark uses a different tokenizer and batch size, so tokens/sec is not directly comparable without normalizing the setup."
      },
      expected: {
        labels: { reply_quality: ["substantive"], spam: ["unlikely"], bot_like: ["unlikely", "unclear"], adult_promo: ["unlikely"] },
        risk: { spam: { max: 0.3 } }
      }
    },
    {
      id: "reply-low-info-018",
      kind: "social",
      language: "zh-TW",
      tags: ["reply", "low-info"],
      features: { platform: "threads", isReply: true, text: "嗯" },
      expected: { labels: { reply_quality: ["low_information"], spam: ["unlikely", "possible"] } }
    },
    {
      id: "reply-emoji-019",
      kind: "social",
      language: "multi",
      tags: ["reply", "emoji"],
      features: { platform: "x", isReply: true, text: "🔥🔥🔥" },
      expected: { labels: { reply_quality: ["emoji_only", "low_information"], spam: ["unlikely", "possible"] } }
    },
    {
      id: "reply-promo-020",
      kind: "social",
      language: "zh-TW",
      tags: ["reply", "promotion", "spam"],
      features: { platform: "threads", isReply: true, text: "想賺更多嗎？私訊我加入投資群，現在有專屬優惠碼。" },
      expected: {
        labels: {
          reply_quality: ["promotional"], rhetorical_style: ["promotional"],
          spam: ["possible", "likely"], adult_promo: ["unlikely"]
        },
        risk: { spam: { min: 0.25 } }
      }
    },
    {
      id: "reply-adult-promo-021",
      kind: "social",
      language: "zh-TW",
      tags: ["reply", "adult", "spam"],
      features: {
        platform: "x", isReply: true, displayName: "VIP", handle: "@vip998877",
        text: "18+ 私密照，免費影片點我主頁，加LINE 私訊看更多。"
      },
      expected: {
        labels: { adult_promo: ["likely"], spam: ["possible", "likely"], bot_like: ["possible", "likely", "unclear"] },
        risk: { adult_promo: { min: 0.5 } }
      }
    },
    {
      id: "reply-mention-spray-022",
      kind: "social",
      language: "en",
      tags: ["reply", "spam", "mention-spray"],
      features: {
        platform: "x", isReply: true, handle: "@promo783921",
        text: "@a @b @c @d @e Huge giveaway! DM me and follow for more https://example.test https://example2.test"
      },
      expected: {
        labels: { spam: ["likely", "possible"], bot_like: ["possible", "likely"], reply_quality: ["promotional"] },
        risk: { spam: { min: 0.45 } }
      }
    },
    {
      id: "reply-airdrop-scamlike-023",
      kind: "social",
      language: "en",
      tags: ["reply", "spam", "promo"],
      features: {
        platform: "x", isReply: true,
        text: "FREE AIRDROP! Claim now, follow + repost + DM me your wallet. Limited giveaway link: https://example.test"
      },
      expected: {
        labels: { spam: ["likely", "possible"], reply_quality: ["promotional"], rhetorical_style: ["engagement_bait", "promotional"] }
      }
    },
    {
      id: "sexuality-discussion-not-promo-024",
      kind: "social",
      language: "en",
      tags: ["adult-negative-control"],
      features: {
        platform: "threads", isReply: false,
        text: "A good sex-education curriculum should explain consent, contraception, and online safety in age-appropriate ways."
      },
      expected: {
        labels: { adult_promo: ["unlikely"], spam: ["unlikely"], bot_like: ["unlikely", "unclear"], reply_quality: ["not_applicable"] },
        risk: { adult_promo: { max: 0.2 } }
      }
    },
    {
      id: "numeric-handle-human-025",
      kind: "social",
      language: "en",
      tags: ["bot-negative-control"],
      features: {
        platform: "x", isReply: true, handle: "@alex123456",
        text: "I reproduced the crash on v1.4.2. It disappears if I pin openssl to 3.5.1, so this looks like a regression rather than a networking issue."
      },
      expected: {
        labels: { reply_quality: ["substantive"], spam: ["unlikely"], bot_like: ["unlikely", "unclear", "possible"] },
        risk: { spam: { max: 0.3 }, bot_like: { max: 0.45 } }
      }
    },
    {
      id: "botlike-repetitive-promo-026",
      kind: "social",
      language: "en",
      tags: ["bot-like", "spam"],
      features: {
        platform: "x", isReply: true, handle: "@dealbot99384722", displayName: "DEALS",
        text: "Amazing! Follow for more deals! DM me for discount coupon! Giveaway giveaway giveaway https://example.test"
      },
      expected: {
        labels: { spam: ["likely", "possible"], bot_like: ["likely", "possible"], reply_quality: ["promotional", "generic_reply"] }
      }
    },
    {
      id: "political-sarcasm-unclear-027",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "sarcasm", "tilt-unclear"],
      features: {
        platform: "threads", isReply: false,
        text: "又一個『先蓋再說』的政策，預算怎麼算、需求在哪都沒講，這樣也叫完整規劃？"
      },
      expected: {
        labels: {
          political_content: ["political"], ideological_tilt: ["unclear"],
          rhetorical_style: ["opinionated_commentary", "high_arousal_opinion"], spam: ["unlikely"]
        }
      }
    },
    {
      id: "political-neutral-news-028",
      kind: "social",
      language: "zh-TW",
      tags: ["politics", "news-like"],
      features: {
        platform: "x", isReply: false,
        text: "國會今天完成法案二讀，各黨團提出不同版本修正案，後續仍需進入三讀程序。"
      },
      expected: {
        labels: { political_content: ["political"], ideological_tilt: ["unclear", "mixed_or_center"], rhetorical_style: ["neutral_informational"] }
      }
    },
    {
      id: "health-normal-029",
      kind: "social",
      language: "zh-TW",
      tags: ["health", "negative-control"],
      features: {
        platform: "threads", isReply: false,
        text: "今天跑 5 公里，配速比上週慢一點，但心率比較穩。下次想把前兩公里再放慢。"
      },
      expected: {
        labels: { political_content: ["non_political"], spam: ["unlikely"], adult_promo: ["unlikely"], traffic_manipulation: ["unlikely"] }
      }
    },
    {
      id: "indonesian-normal-030",
      kind: "social",
      language: "id",
      tags: ["multilingual", "negative-control"],
      features: {
        platform: "threads", isReply: false,
        text: "Sudah dua hari aplikasi ini terus seperti ini. Ada yang mengalami masalah yang sama setelah pembaruan?"
      },
      expected: {
        labels: { spam: ["unlikely"], adult_promo: ["unlikely"], reply_quality: ["not_applicable"] }
      }
    },
    {
      id: "article-ai-seo-031",
      kind: "article",
      language: "en",
      tags: ["article", "ai-farm", "seo"],
      features: {
        title: "Top 10 AI Tools in 2026: The Ultimate Guide",
        domain: "example.test",
        headingDensity: 0.25,
        repetitionRatio: 0.35,
        content: "In today's fast-paced digital landscape, it is worth noting that AI tools are crucial. This comprehensive guide will delve into the best tools. In conclusion, unlock the power of AI with these top 10 picks."
      },
      expected: {
        labels: { political_content: ["non_political"], ai_farm: ["possible", "likely"], traffic_strategy: ["seo_farm_like", "clickbait"] },
        risk: { ai_farm: { min: 0.25 } }
      }
    },
    {
      id: "article-tech-neutral-032",
      kind: "article",
      language: "en",
      tags: ["article", "negative-control"],
      features: {
        title: "PostgreSQL 19 planner notes",
        domain: "example.test",
        content: "The planner change delays one join-order decision until cardinality estimates are available. In our test workload the change reduced planning time without changing query results.",
        headingDensity: 0.03,
        repetitionRatio: 0
      },
      expected: {
        labels: { political_content: ["non_political"], ai_farm: ["unlikely", "unclear"], traffic_strategy: ["normal"] }
      }
    },
    {
      id: "article-politics-neutral-033",
      kind: "article",
      language: "zh-TW",
      tags: ["article", "politics", "neutral"],
      features: {
        title: "立法院審議交通法案",
        domain: "example.test",
        content: "立法院今日針對交通法案逐條審查，不同黨團分別提出修正意見。會議紀錄列出各版本條文與表決結果。",
        headingDensity: 0.04,
        repetitionRatio: 0
      },
      expected: {
        labels: { political_content: ["political"], ideological_tilt: ["unclear", "mixed_or_center"], traffic_strategy: ["normal"] }
      }
    },
    {
      id: "article-left-opinion-034",
      kind: "article",
      language: "en",
      tags: ["article", "politics", "ideology-left"],
      features: {
        title: "Why labor protections should expand",
        domain: "example.test",
        content: "This editorial supports stronger union rights, a wealth tax on very high net worth households, more public housing, and expanded social welfare programs.",
        headingDensity: 0.05,
        repetitionRatio: 0
      },
      expected: {
        labels: { political_content: ["political"], ideological_tilt: ["left_leaning"], traffic_strategy: ["normal", "agenda_amplification_style"] }
      }
    },
    {
      id: "article-right-opinion-035",
      kind: "article",
      language: "en",
      tags: ["article", "politics", "ideology-right"],
      features: {
        title: "Case for lower taxes and smaller government",
        domain: "example.test",
        content: "This editorial argues for lower taxes, smaller government, stronger law-and-order policy, and traditional conservative social values.",
        headingDensity: 0.05,
        repetitionRatio: 0
      },
      expected: {
        labels: { political_content: ["political"], ideological_tilt: ["right_leaning"], traffic_strategy: ["normal", "agenda_amplification_style"] }
      }
    },
    {
      id: "article-clickbait-036",
      kind: "article",
      language: "zh-TW",
      tags: ["article", "clickbait"],
      features: {
        title: "震驚！你不會相信這家公司最後做了什麼",
        domain: "example.test",
        content: "真相曝光！網友全炸鍋。看到最後一個決定，所有人都驚呆了。一定要看完整故事。",
        headingDensity: 0.08,
        repetitionRatio: 0
      },
      expected: {
        labels: { political_content: ["non_political"], traffic_strategy: ["clickbait", "rage_bait"], ai_farm: ["unlikely", "possible"] }
      }
    },
    {
      id: "threads-adult-image-spam-037",
      kind: "social",
      language: "zh-TW",
      tags: ["threads", "adult", "spam", "image", "regression"],
      note: "Regression for a Threads post whose visible caption is euphemistic/innocuous while the attached visual carries the adult-promo evidence.",
      features: {
        platform: "threads",
        handle: "@andrestorres_cg",
        displayName: "andrestorres_cg",
        isReply: false,
        text: "日本有感謝季 台灣有畢業季 🌸:0918 1/2",
        images: [
          { url: "https://example.test/adult-promo.jpg", alt: "", width: 1080, height: 1350, kind: "image" }
        ],
        imageEvidence: {
          analyzedCount: 1,
          visionStatus: "available",
          images: [
            {
              alt: "",
              visual: {
                adult_visual: "explicit",
                adult_promo_visual: "likely",
                commercial_promo_visual: "possible",
                political_visual: "none",
                visual_style: "advertisement",
                contains_text: true,
                revealing_clothing: true,
                nudity: true,
                sexual_pose: true,
                contact_or_subscription_cta: true,
                price_or_offer_visible: false,
                news_graphic: false,
                crowd_or_rally: false,
                confidence: 0.94
              },
              ocr: { supported: true, text: "18+ 私密內容 私訊看" },
              qr: { supported: true, values: [] },
              pixelSignals: { skin_fraction: 0.51, mean_brightness: 0.61 }
            }
          ]
        }
      },
      expected: {
        labels: {
          reply_quality: ["not_applicable"],
          adult_content: ["likely"],
          adult_promo: ["likely"],
          spam: ["possible", "likely"]
        },
        risk: { adult_content: { min: 0.75 }, adult_promo: { min: 0.7 }, spam: { min: 0.35 } }
      }
    },
    {
      id: "threads-coded-adult-spam-038",
      kind: "social",
      language: "zh-TW",
      providers: ["jev"],
      tags: ["threads", "adult", "spam", "euphemism", "real-world", "jev-only", "regression"],
      note: "User-labeled real-world false negative from Threads. The visible caption is intentionally euphemistic/obfuscated; this case measures whether Jev can recover the solicitation pattern from text alone after prompt changes.",
      features: {
        platform: "threads",
        handle: "@andrestorres_cg",
        displayName: "andrestorres_cg",
        isReply: false,
        text: "日本有感謝季 台灣有畢業季 🌸:0918 1/2"
      },
      expected: {
        labels: {
          reply_quality: ["not_applicable"],
          adult_promo: ["possible", "likely"],
          spam: ["possible", "likely"]
        }
      }
    }
  ];

  globalThis.JevLensEvalCases = cases;
})();
