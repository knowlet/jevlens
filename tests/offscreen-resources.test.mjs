import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/offscreen.js", import.meta.url), "utf8");

function loadOffscreen({ failure, detectors = true } = {}) {
  let listener;
  const bitmaps = [];
  const context = {
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    fetch: async () => ({ ok: true, blob: async () => ({ type: "image/png", size: 4 }) }),
    createImageBitmap: async () => {
      if (failure === "decode") throw new Error("decode failed");
      const bitmap = { width: 1, height: 1, closeCount: 0, close() { this.closeCount++; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    OffscreenCanvas: class {
      getContext() {
        if (failure === "context") return null;
        return {
          drawImage() {
            if (failure === "draw") throw new Error("draw failed");
          },
          getImageData() {
            if (failure === "pixels") throw new Error("pixel read failed");
            return { data: new Uint8ClampedArray([100, 80, 60, 255]) };
          }
        };
      }
    }
  };
  if (detectors) {
    context.TextDetector = class {
      async detect() {
        if (failure === "ocr") throw new Error("OCR failed");
        return [{ rawValue: "fixture text" }];
      }
    };
    context.BarcodeDetector = class {
      static async getSupportedFormats() { return ["qr_code"]; }
      async detect() {
        if (failure === "qr") throw new Error("QR failed");
        return [{ rawValue: "fixture QR" }];
      }
    };
  }
  vm.runInNewContext(source, context, { filename: "offscreen.js" });
  return {
    bitmaps,
    analyze: () => new Promise(resolve => {
      assert.equal(listener({
        target: "jevlens-offscreen",
        type: "ANALYZE_IMAGES",
        images: [{ url: "https://fixture.invalid/image.png" }]
      }, {}, resolve), true);
    })
  };
}

function assertClosed(bitmaps, count) {
  assert.equal(bitmaps.length, count);
  assert.ok(bitmaps.every(bitmap => bitmap.closeCount === 1),
    `each bitmap must close exactly once; got ${bitmaps.map(bitmap => bitmap.closeCount)}`);
}

test("offscreen analysis closes every decoded bitmap after success", async () => {
  const { analyze, bitmaps } = loadOffscreen();
  const response = await analyze();
  assert.equal(response.ok, true);
  assert.equal(response.evidence.analyzedCount, 1);
  const image = response.evidence.images[0];
  assert.equal(image.ocr.text, "fixture text");
  assert.equal(image.qr.values[0], "fixture QR");
  assert.equal(image.pixelSignals.skin_fraction, 1);
  assertClosed(bitmaps, 3);
});

for (const failure of ["context", "draw", "pixels", "ocr", "qr"]) {
  test(`offscreen analysis closes bitmaps when ${failure} processing fails`, async () => {
    const { analyze, bitmaps } = loadOffscreen({ failure });
    // A failed image must not keep resources on repeated feed analysis either.
    for (let i = 0; i < 2; i++) {
      const response = await analyze();
      assert.equal(response.ok, true);
      const image = response.evidence.images[0];
      assert.equal(image.fetched, true);
      const failed = failure === "ocr" ? image.ocr : failure === "qr" ? image.qr : image.pixelSignals;
      assert.equal(typeof failed.error, "string");
      if (failure !== "ocr") assert.equal(image.ocr.text, "fixture text");
      if (failure !== "qr") assert.equal(image.qr.values[0], "fixture QR");
      assertClosed(bitmaps, (i + 1) * 3);
    }
  });
}

test("failed bitmap decoding preserves errors without attempting cleanup of an absent bitmap", async () => {
  const { analyze, bitmaps } = loadOffscreen({ failure: "decode" });
  const response = await analyze();
  assert.equal(response.ok, true);
  const image = response.evidence.images[0];
  assert.equal(image.pixelSignals.error, "decode failed");
  assert.equal(image.ocr.error, "decode failed");
  assert.equal(image.qr.error, "decode failed");
  assertClosed(bitmaps, 0);
});

test("unsupported detectors create no unnecessary bitmaps", async () => {
  const { analyze, bitmaps } = loadOffscreen({ detectors: false });
  const response = await analyze();
  assert.equal(response.evidence.images[0].ocr.supported, false);
  assert.equal(response.evidence.images[0].qr.supported, false);
  assertClosed(bitmaps, 1);
});
