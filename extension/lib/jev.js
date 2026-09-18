(() => {
  "use strict";

  const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
  const MODEL = "jev-latest";

  function choice(instructions, criteria) {
    return { type: "choice", instructions, criteria };
  }

  function politicalContentQuestion(subject = "content") {
    return choice(
      `Is the ${subject} substantially about politics, government, elections, public policy, parties, political actors, legislation, or geopolitical political claims?`,
      {
        political: "Politics or public policy is a substantial subject.",
        non_political: "Politics and public policy are not a substantial subject.",
        unclear: "There is not enough information to decide."
      }
    );
  }

  function ideologicalTiltQuestion(subject = "content") {
    return choice(
      `If the ${subject} is political, what broad ideological tilt is expressed by its framing? Use only the supplied content evidence. Do not infer the author's identity, party affiliation, or voting preference from a photo, name, demographics, or account identity. Do not force a left/right label when the issue is local, technocratic, cross-cutting, sarcastic, or otherwise not meaningfully mappable to a broad ideological spectrum.`,
      {
        left_leaning: "The visible framing consistently advances broadly left/progressive policy or ideological positions.",
        mixed_or_center: "The visible framing contains substantial competing perspectives, explicit moderation, or a clearly mixed/centrist policy stance.",
        right_leaning: "The visible framing consistently advances broadly right/conservative policy or ideological positions.",
        unclear: "The content is political, but a broad left/right tilt cannot be reliably determined from the visible text.",
        not_applicable: "The content is not substantially political."
      }
    );
  }

  function articleQuestions() {
    return {
      politicalContent: politicalContentQuestion("document"),
      ideologicalTilt: ideologicalTiltQuestion("document"),
      trafficStrategy: choice(
        "Which observable publishing/rhetorical pattern best describes this document? Judge style, not truthfulness, coordination, or the author's motives.",
        {
          normal: "Ordinary reporting, analysis, commentary, or informational writing without a dominant traffic-optimization pattern.",
          clickbait: "Headline or structure relies heavily on curiosity gaps, sensational hooks, or withholding obvious information.",
          engagement_bait: "Content strongly pushes likes, shares, comments, follows, or other engagement as a primary observable tactic.",
          rage_bait: "Content is dominated by outrage, humiliation, disgust, fear, enemies, or other high-arousal framing that appears engagement-oriented.",
          seo_farm_like: "Template-heavy, search-oriented, repetitive or mass-produced informational structure dominates.",
          agenda_amplification_style: "The text repeatedly frames an issue toward a political or issue-mobilizing narrative. This does not establish coordinated manipulation.",
          unclear: "No reliable classification."
        }
      ),
      aiFarm: choice(
        "Does this document look like low-value AI/content-farm production based on formulaic phrasing, repetition, generic structure, shallow synthesis, or template-like mass production? Do not equate polished writing with AI authorship.",
        {
          unlikely: "Few content-farm or formulaic generation signals.",
          possible: "Some signals are present, but evidence is not strong.",
          likely: "Multiple strong signals suggest low-value AI/content-farm production.",
          unclear: "Insufficient evidence."
        }
      )
    };
  }

  function socialQuestions() {
    return {
      politicalContent: politicalContentQuestion("post or reply"),
      ideologicalTilt: ideologicalTiltQuestion("post or reply"),
      rhetoricalStyle: choice(
        "Classify the dominant observable rhetorical style of this post/reply. Separate ordinary opinion from engagement manipulation. Strong criticism alone is not spam or coordinated manipulation.",
        {
          neutral_informational: "Primarily reports, explains, asks, or discusses information without strong evaluative or emotional framing.",
          opinionated_commentary: "Expresses criticism, praise, sarcasm, or a clear opinion, but is not dominated by extreme emotional language or explicit engagement tactics.",
          high_arousal_opinion: "Uses strong insults, outrage, ridicule, fear, disgust, or similarly high-arousal language as a prominent part of the message.",
          clickbait: "Uses a curiosity gap or sensational teaser primarily to get a click/open.",
          engagement_bait: "Explicitly solicits likes, shares, reposts, comments, follows, or similar engagement.",
          mobilizing_or_agenda: "Primarily urges political/issue mobilization or repeatedly pushes a one-sided issue narrative. This does not establish coordinated manipulation.",
          seo_template: "Looks template-heavy, search-optimized, repetitive, or mass-produced.",
          promotional: "Primarily promotes a product, service, account, referral, giveaway, investment group, or other commercial/promo target.",
          unclear: "The dominant style cannot be determined reliably."
        }
      ),
      trafficManipulation: choice(
        "Based only on observable wording and structure, how strongly does this post/reply appear optimized to manufacture clicks or engagement beyond ordinary communication? Do not infer hidden motives, coordinated campaigns, or truthfulness.",
        {
          unlikely: "Little evidence of engagement-manipulation tactics.",
          possible: "Some observable engagement-optimization signals, but ordinary commentary is also plausible.",
          likely: "Multiple strong observable click/engagement-manipulation signals.",
          unclear: "Insufficient evidence."
        }
      ),
      aiFarm: choice(
        "Does this post/reply show evidence of low-value, formulaic, mass-produced AI/content-farm style? Short or ordinary polished text is not enough; when evidence is weak, choose unlikely or unclear.",
        {
          unlikely: "Few mass-produced/formulaic AI-content signals.",
          possible: "Some formulaic or mass-production signals are present.",
          likely: "Multiple strong signals suggest low-value AI/content-farm production.",
          unclear: "The visible text is too limited to judge."
        }
      ),
      replyQuality: choice(
        "Classify reply quality only when state.isReply is true. If it is not a reply, choose not_applicable. Criticism or disagreement is not spam merely because it is negative. Without parent context, do not claim a reply is off-topic unless it is obviously unrelated from its own content.",
        {
          substantive: "A reply containing a meaningful claim, response, question, information, or context.",
          generic_reply: "A reply that is mostly generic praise/agreement/disagreement and could be pasted under many posts.",
          low_information: "A reply with very little semantic content.",
          emoji_only: "A reply that is almost entirely emoji or reaction glyphs.",
          promotional: "A reply primarily promoting a product, account, group, referral, investment, giveaway, or link.",
          off_topic: "A reply that is clearly unrelated to the discussion from the available context.",
          unclear: "It is a reply, but quality cannot be determined from the available context.",
          not_applicable: "This is an original/standalone post rather than a reply."
        }
      ),
      spam: choice(
        "Is this visible post/reply likely spam based on templating, irrelevant promotion, repetitive generic engagement, mention/link spray, scams, coded/euphemistic solicitation, teaser captions, or obvious reply hijacking? Use supplied media/imageEvidence when present. A bare date, number, emoji, unusual phrasing, political disagreement, insult, or unpopular opinion is not spam by itself; look for a coherent promotional/spam pattern.",
        {
          unlikely: "No strong spam pattern.",
          possible: "Some spam-like signals, but ambiguous.",
          likely: "Multiple strong spam signals.",
          unclear: "Insufficient evidence."
        }
      ),
      botLike: choice(
        "Based only on the visible interaction evidence, how bot-like or automation-farm-like is this interaction? Do not claim the account is definitively automated. With only one normal-looking post and little account metadata, prefer unlikely or unclear.",
        {
          unlikely: "Interaction looks plausibly human and context-specific.",
          possible: "Some automation/farm-like patterns.",
          likely: "Strong templated or automation/farm-like interaction patterns.",
          unclear: "Insufficient evidence."
        }
      ),
      adultContent: choice(
        "Does the supplied post/media evidence contain adult or sexually explicit content? Use imageEvidence when present. Distinguish ordinary people, swimwear, health/education and nonsexual nudity from sexualized or explicit material. This is about content, not whether it is promotional spam.",
        {
          unlikely: "No meaningful adult/sexual content signals.",
          possible: "Some sexualized or suggestive evidence, but ambiguous.",
          likely: "Strong sexualized, nude, pornographic, or explicit visual/text evidence.",
          unclear: "The available media evidence is insufficient or image analysis was unavailable."
        }
      ),
      adultPromo: choice(
        "Is this account/post likely promoting adult content, paid sexual content, sexual services, or adult-account traffic? Use text, links/contact calls-to-action and imageEvidence together. Account for coded/euphemistic solicitation, teaser captions, contact-like handles/numbers, subscription prompts, QR codes, or adult promotional graphics when supported by the combined evidence. A number/date or adult content by itself is not necessarily promotion or spam.",
        {
          unlikely: "No adult-promo signals.",
          possible: "Some ambiguous adult-promo signals.",
          likely: "Strong adult-promo signals.",
          unclear: "Insufficient evidence."
        }
      )
    };
  }

  function sanitizeImageEvidence(evidence) {
    if (!evidence || typeof evidence !== "object") return null;
    return {
      analyzedCount: Number(evidence.analyzedCount) || 0,
      visionStatus: String(evidence.visionStatus || "unknown").slice(0, 80),
      images: (Array.isArray(evidence.images) ? evidence.images : []).slice(0, 3).map(img => ({
        alt: String(img.alt || "").slice(0, 600),
        width: Number(img.width) || 0,
        height: Number(img.height) || 0,
        kind: String(img.kind || "image").slice(0, 40),
        fetched: !!img.fetched,
        mime: String(img.mime || "").slice(0, 80),
        visionStatus: String(img.visionStatus || "unknown").slice(0, 80),
        pixelSignals: img.pixelSignals && typeof img.pixelSignals === "object" ? {
          skin_fraction: Number(img.pixelSignals.skin_fraction) || 0,
          mean_brightness: Number(img.pixelSignals.mean_brightness) || 0
        } : null,
        ocr: img.ocr && typeof img.ocr === "object" ? {
          supported: !!img.ocr.supported,
          text: String(img.ocr.text || "").slice(0, 1800)
        } : null,
        qr: img.qr && typeof img.qr === "object" ? {
          supported: !!img.qr.supported,
          values: (Array.isArray(img.qr.values) ? img.qr.values : []).slice(0, 3).map(v => String(v).slice(0, 600))
        } : null,
        visual: img.visual && typeof img.visual === "object" ? img.visual : null
      }))
    };
  }

  function buildRequest(kind, features) {
    if (kind === "article") {
      return {
        model: MODEL,
        state: {
          title: features.title || "",
          byline: features.byline || "",
          domain: features.domain || "",
          content: (features.content || "").slice(0, 14000),
          extractedSignals: {
            headingDensity: features.headingDensity || 0,
            repetitionRatio: features.repetitionRatio || 0
          }
        },
        questions: articleQuestions()
      };
    }

    if (kind === "social") {
      return {
        model: MODEL,
        state: {
          platform: features.platform || "",
          displayName: features.displayName || "",
          handle: features.handle || "",
          text: (features.text || "").slice(0, 5000),
          isReply: !!features.isReply,
          parentText: (features.parentText || "").slice(0, 2500),
          media: {
            imageCount: Array.isArray(features.images) ? features.images.length : 0,
            images: (features.images || []).slice(0, 4).map(img => ({
              alt: (img.alt || "").slice(0, 600),
              width: Number(img.width) || 0,
              height: Number(img.height) || 0,
              kind: img.kind || "image"
            })),
            imageEvidence: sanitizeImageEvidence(features.imageEvidence)
          }
        },
        questions: socialQuestions()
      };
    }

    throw new Error(`Unsupported classification kind: ${kind}`);
  }

  function answerProb(answer, option) {
    return Number(answer?.probabilities?.[option] || 0);
  }

  function confidence(answer) {
    if (Number.isFinite(Number(answer?.confidence))) return Number(answer.confidence);
    const probs = Object.values(answer?.probabilities || {}).map(Number).filter(Number.isFinite);
    return probs.length ? Math.max(...probs) : null;
  }

  function likelihoodRisk(answer) {
    const likely = answerProb(answer, "likely");
    const possible = answerProb(answer, "possible");
    return Math.max(0, Math.min(1, likely + possible * 0.5));
  }

  function normalize(kind, response) {
    const a = response?.answers || {};

    if (kind === "article") {
      const traffic = a.trafficStrategy;
      return {
        source: "jev_direct",
        model: response?.model || MODEL,
        usage: response?.usage || null,
        kind,
        labels: {
          political_content: a.politicalContent?.choice || "unclear",
          ideological_tilt: a.ideologicalTilt?.choice || "unclear",
          traffic_strategy: traffic?.choice || "unclear",
          ai_farm: a.aiFarm?.choice || "unclear"
        },
        risk: {
          ai_farm: likelihoodRisk(a.aiFarm),
          engagement_bait: Math.min(1,
            answerProb(traffic, "clickbait") +
            answerProb(traffic, "engagement_bait") +
            answerProb(traffic, "rage_bait") +
            answerProb(traffic, "agenda_amplification_style") * 0.5
          )
        },
        confidence: {
          political_content: confidence(a.politicalContent),
          ideological_tilt: confidence(a.ideologicalTilt),
          traffic_strategy: confidence(traffic),
          ai_farm: confidence(a.aiFarm)
        },
        flags: []
      };
    }

    if (kind === "social") {
      return {
        source: "jev_direct",
        model: response?.model || MODEL,
        usage: response?.usage || null,
        kind,
        labels: {
          political_content: a.politicalContent?.choice || "unclear",
          ideological_tilt: a.ideologicalTilt?.choice || "unclear",
          rhetorical_style: a.rhetoricalStyle?.choice || "unclear",
          traffic_manipulation: a.trafficManipulation?.choice || "unclear",
          ai_farm: a.aiFarm?.choice || "unclear",
          reply_quality: a.replyQuality?.choice || "unclear",
          spam: a.spam?.choice || "unclear",
          bot_like: a.botLike?.choice || "unclear",
          adult_content: a.adultContent?.choice || "unclear",
          adult_promo: a.adultPromo?.choice || "unclear"
        },
        risk: {
          traffic_manipulation: likelihoodRisk(a.trafficManipulation),
          ai_farm: likelihoodRisk(a.aiFarm),
          spam: likelihoodRisk(a.spam),
          bot_like: likelihoodRisk(a.botLike),
          adult_content: likelihoodRisk(a.adultContent),
          adult_promo: likelihoodRisk(a.adultPromo)
        },
        confidence: {
          political_content: confidence(a.politicalContent),
          ideological_tilt: confidence(a.ideologicalTilt),
          rhetorical_style: confidence(a.rhetoricalStyle),
          traffic_manipulation: confidence(a.trafficManipulation),
          ai_farm: confidence(a.aiFarm),
          reply_quality: confidence(a.replyQuality),
          spam: confidence(a.spam),
          bot_like: confidence(a.botLike),
          adult_content: confidence(a.adultContent),
          adult_promo: confidence(a.adultPromo)
        },
        flags: []
      };
    }

    throw new Error(`Unsupported classification kind: ${kind}`);
  }

  async function evaluate({ apiKey, kind, features, fetchImpl = fetch, timeoutMs = 9000, retries = 2 }) {
    if (!apiKey?.trim()) throw new Error("TypeSafe API key is not configured");

    const body = buildRequest(kind, features);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey.trim()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        const raw = await response.text();
        let payload = null;
        try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }

        if (response.ok) {
          const normalized = normalize(kind, payload);
          normalized.diagnostics = {
            sent_state: body.state,
            answer_choices: Object.fromEntries(
              Object.entries(payload?.answers || {}).map(([key, answer]) => [key, {
                choice: answer?.choice ?? null,
                probabilities: answer?.probabilities || null,
                confidence: answer?.confidence ?? null
              }])
            )
          };
          return normalized;
        }

        const error = new Error(`TypeSafe HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 400)}`);
        error.status = response.status;
        lastError = error;

        if (![429, 529].includes(response.status) || attempt >= retries) throw error;
      } catch (err) {
        lastError = err;
        const retryable = err?.name === "AbortError" || err?.status === 429 || err?.status === 529 || err instanceof TypeError;
        if (!retryable || attempt >= retries) throw err;
      } finally {
        clearTimeout(timeout);
      }

      await new Promise(resolve => setTimeout(resolve, 350 * (2 ** attempt)));
    }

    throw lastError || new Error("TypeSafe request failed");
  }

  globalThis.JevLensJev = {
    ENDPOINT,
    MODEL,
    articleQuestions,
    socialQuestions,
    sanitizeImageEvidence,
    buildRequest,
    normalize,
    evaluate
  };
})();
