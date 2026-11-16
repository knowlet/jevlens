# Jev success-body parsing (2026-11-16)

At master 1e058c4e4b65bbf0ba26f3aad347ff92614742b8, evaluate catches JSON parse errors into `{raw}` regardless of HTTP status. normalize then supplies unclear labels and zero risks, marks the result `jev_direct`, and the background script caches that result. HTML, truncated JSON and empty successful responses must be provider failures rather than successful classifications.

A targeted upstream lookup used the Fetch standard and Node's MIT-licensed Undici `lib/web/fetch/body.js` (main inspected 2026-11-16). Its `json()` passes parsing through `consumeBody`, whose conversion exceptions reject the promise. Sources: https://fetch.spec.whatwg.org/#dom-body-json and https://github.com/nodejs/undici/blob/main/lib/web/fetch/body.js ; license https://github.com/nodejs/undici/blob/main/LICENSE . This is design reference only; no upstream implementation copied.

Keep existing response.text() for HTTP error diagnostics and status-based retries. On a successful HTTP response only, reject malformed/empty JSON with a bounded error that excludes raw body text. Preserve valid JSON normalization (including partial answer objects), fallback opt-in, timeout cleanup and HTTP retry behavior. Do not introduce a full response schema or new API calls.

Verification: real evaluator with synthetic fetch Responses; real background listener plus the evaluator with synthetic storage and offline responses, including fallback disabled/enabled and successful normalization. Run all Node tests and local deterministic evaluation. This is not live API or Chrome acceptance.
