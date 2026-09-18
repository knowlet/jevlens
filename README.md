# JevLens

Manifest V3 Chrome extension for annotating articles, X/Twitter posts, and Threads posts with typed **Jev / System One** decisions.

Current version: **0.5.2**.

## Architecture

```text
X / Threads DOM
      │
      ├─ visible post text + minimal account/context metadata
      ├─ post images: URL/alt/dimensions (extension only)
      │      │
      │      └─ offscreen document
      │            ├─ Chrome built-in multimodal Prompt API → fixed visual schema
      │            ├─ TextDetector when available → OCR text
      │            ├─ BarcodeDetector when available → QR values
      │            └─ weak pixel statistics (never sufficient by themselves)
      │
      ▼
MV3 service worker
      │
      ├─ sanitize image evidence (raw image URL is NOT sent to TypeSafe)
      ├─ POST https://api.typesafe.ai/v1/systemone
      │    Authorization: Bearer <API_KEY>
      │    model: jev-latest
      │    state = text + structured image evidence
      │
      └─ optional deterministic local fallback
      │
      ▼
typed decisions → badges / tooltip / mark / dim / collapse
```

There is no JevLens proxy. The TypeSafe API key is stored in `chrome.storage.local.typesafeApiKey` and used directly by the service worker.

This is convenient for a personal extension, but it is **not secret storage**. Anyone with sufficient access to the browser profile or extension debugging environment can recover the key.

## v0.5: image-aware classification

v0.4 only classified social text. That meant a post whose adult/spam/political signal lived in an image could be sent to Jev with essentially no useful media context.

v0.5 extracts up to three post images and analyzes them locally before the Jev call. The structured evidence includes:

- visible `alt` text
- image dimensions/type
- OCR text when `TextDetector` is available
- QR values when `BarcodeDetector` is available
- fixed visual labels such as `adult_visual`, `adult_promo_visual`, `political_visual`, `visual_style`, nudity/sexual-pose indicators, CTA/offer indicators, and confidence
- low-weight pixel statistics used only as weak fallback evidence

The local visual model uses Chrome's built-in multimodal Prompt API when available. The image bytes stay in the browser; TypeSafe receives only the sanitized structured evidence and extracted text.

The UI shows `圖 N/M`. Hovering the row shows `image_vision` plus compact visual classifications. `圖 0/1` means the page had a media item but the image preprocessor could not successfully analyze it.

### Preparing Chrome's local model

Open:

```text
JevLens settings → 圖片分析 → 準備本機圖片模型
```

The first use may require a model download. If the API/model is unavailable, image classification degrades to whatever alt/OCR/QR/pixel evidence the browser exposes.

## What v0.5 classifies

### Social posts: X / Threads

- political content: `political | non_political | unclear`
- broad ideological framing: `left_leaning | mixed_or_center | right_leaning | unclear | not_applicable`
- rhetorical style
- observable traffic/engagement manipulation likelihood
- AI/content-farm likelihood
- reply quality, only when an explicit reply relationship is detected
- spam likelihood
- bot-like interaction likelihood
- adult-content likelihood
- adult-promotion / sexual-services / adult-account traffic likelihood

Political labels are descriptive signals only. They are not truth ratings, credibility scores, endorsements, voting recommendations, or claims about the author's identity.

### Articles

- political content
- broad ideological framing
- traffic/rhetorical pattern
- AI/content-farm likelihood

General articles are analyzed only after the user presses **分析目前文章**.

## Threads false-negative diagnostics

The real-world post:

```text
日本有感謝季
台灣有畢業季
🌸:0918 1/2
```

was user-labeled as adult spam but v0.4 displayed roughly:

```text
Jev ✓  回覆 substantive  垃圾 2%  Bot 4%  成人推廣 0%
```

That exposed three separate issues:

1. `Jev ✓` proves the displayed probabilities came from a successful direct Jev request rather than the local fallback.
2. The visible euphemistic caption itself was therefore a Jev false negative under the old question wording.
3. v0.4 did not analyze post images at all and Threads reply detection scanned too much card UI, so the extension could also withhold useful evidence and incorrectly label feed posts as replies.

v0.5 tightens reply detection, expands the Jev spam/adult-promo questions to explicitly account for coded/euphemistic solicitations without treating a bare number/date as sufficient evidence, and adds local image evidence before Jev.

A dedicated Jev-only regression fixture (`threads-coded-adult-spam-038`) retains the exact visible caption so the Evaluation Runner can tell us whether the new Jev question schema actually fixes that semantic miss. It is intentionally not forced into the keyword fallback, because hard-coding this one euphemism would overfit the local rules.

## Feed UI

The row shows the source, whether the item is a post or a reply, `圖 N/M` when the post carries images, and then only the **three highest-scoring categories**:

```text
Jev ✓  貼文  圖 1/1  政治 · 偏右 90%  垃圾 81%  流量操作 55%
```

Ranking rules:

- 政治 is gated on the model's choice, never on a residual probability: `non_political` gets no chip, `political` renders as `政治` and folds the descriptive tilt into the same chip (`政治 · 偏右`), and `unclear` renders as `政治？`. The score is P(political) when Jev returns probabilities, otherwise the choice confidence.
- 垃圾 / Bot-like / 成人內容 / 成人推廣 / AI農場 / 流量操作 use their risk score.
- A category turned off in settings is removed before ranking, so the three slots go to what is still enabled.
- Scores below 2% are dropped, and a post with no visible signal shows one muted `無明顯訊號` chip instead of a row of zeros.

Nothing is hidden: the row's hover title still carries every label, every confidence value, the full `ranked=` order, the flags, and the image-analysis status.

The row is mounted inside the same column as the post text, directly above it. That keeps the chips aligned with the post body and stops the row from becoming an extra flex item beside the avatar column, which used to shift the post sideways on X and Threads. A fixed HUD shows analyzed / queued / error counts.

Political/ideological labels are informational only and never trigger automatic filtering. Auto dim/collapse uses spam, bot-like, adult-content, adult-promo and AI/content-farm risk.

## Evaluation suite

Open:

```text
Options → Evaluation Runner
```

The dataset now includes:

- text-only political/content-farm/spam/bot/adult cases
- the earlier Threads public-policy screenshot regression
- image-aware adult-promo regression with deterministic visual evidence
- the exact coded Threads adult-spam caption as a **Jev-only** real-world regression
- multilingual synthetic holdout cases

Provider-scoped fixtures are skipped for providers they do not apply to. This lets a semantic Jev regression remain in the suite without teaching the deterministic fallback a brittle keyword hack.

### Current deterministic local baseline

```bash
npm run eval:local
```

Current result:

```text
regression: fields 159/159 (100.0%), cases 37/37
holdout:    fields 45/50   (90.0%), cases 15/18
```

The 100% regression result is not a real-world accuracy estimate. The synthetic holdout is more informative but is still not a production benchmark.

Known local holdout misses intentionally remain visible:

- English `city council` political context
- euphemistic adult-promo text
- Spanish generic-reply wording

These are useful Jev-vs-rule comparisons rather than targets for keyword overfitting.

### Jev release gate

Fixtures scoped to `providers: ["jev"]` are deliberately invisible to the local baseline, because the honest way to check them is to ask the model. That means the real-world coded adult-spam case needs its own gate:

```bash
TYPESAFE_API_KEY=... npm run eval:jev
TYPESAFE_API_KEY=... npm run eval:jev -- --all          # every fixture Jev is asked about
TYPESAFE_API_KEY=... npm run eval:jev -- --split holdout
```

The default run covers the provider-scoped fixtures and exits non-zero on any failed expectation, so it can gate a release in CI with the key as a secret. `--all` widens it to the whole dataset for a broader accuracy sweep. The key is read from the environment only and is never printed or written to disk.

## Tests

```bash
npm test
```

The current suite covers:

- current Threads/X injection domains
- post vs reply presentation
- TypeSafe HTTP/Bearer contract
- adult-content + adult-promo Jev questions
- sanitized image evidence (no raw image URL sent to TypeSafe)
- offscreen image-analysis wiring and CDN permissions
- adult image-promo positive regression
- ordinary portrait negative control (high skin pixels alone must not become adult content)
- evaluation dataset/provider scoping
- classifier cache schema versioning
- feed-row category ranking and mount placement (`tests/signals.test.mjs`)
- local fallbacks staying out of the Jev cache, per-image vision sessions, released dim/collapse state

The feed row is also checked against a real layout engine:

```bash
npm run layout:check
```

This renders mock Threads and X posts (flex and block article layouts) in headless Chrome with the real `content.css` and `lib/signals.js` inlined, injects the row, and measures the boxes. It fails if the post text shifts when the row is injected, if the row's left edge stops lining up with the post text column, or if the row (including the all-categories variant) extends past the column or adds horizontal page overflow. One scenario deliberately uses the old prepend-to-the-card injection as a control: it must still report a shifted post, otherwise the measurements are not sensitive to the bug they exist to catch. The same run smoke-tests that `content.js` still initializes against `lib/signals.js`. Set `JEVLENS_CHROME` to use a different browser binary.

## Install / upgrade

1. Unzip the extension.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Load/unpack the `extension/` directory, or press **Reload** on the existing JevLens installation.
5. Reload already-open X / Threads tabs.
6. Open JevLens settings and paste the TypeSafe API key.
7. Click **測試 Jev 連線**.
8. Under **圖片分析**, click **準備本機圖片模型**.
9. Clear old cache after upgrading from v0.4 if desired; v0.5 also changes the classifier schema so stale v0.4 classifications are not reused.

The extension supports `x.com`, `twitter.com`, `threads.com`, and legacy `threads.net`.

## Privacy

- TypeSafe key is stored only in `chrome.storage.local`; it is not Chrome-synced.
- Post image bytes are fetched from the original X/Meta media CDN and analyzed inside the extension's offscreen page.
- Raw image URLs and image bytes are stripped before the Jev state is sent to TypeSafe.
- Jev receives visible post text plus sanitized OCR/QR/visual signals.
- No JevLens analytics or telemetry are included.
- General web articles are not continuously scraped; analysis is user-triggered.

## Fallback

`fallbackToLocal` is enabled by default. If Jev fails, times out, or no key is available, the extension marks the result as `LOCAL ↺` and uses the deterministic fallback. The fallback can consume the same local image evidence.

Disable fallback in Options if you want Jev failures to remain explicit rather than substituted.
