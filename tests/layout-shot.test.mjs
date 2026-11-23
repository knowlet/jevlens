import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { layoutShotPlan, publishLayoutShot } from "../scripts/layout-check.mjs";

test("layout screenshot stays in the workdir unless JEVLENS_LAYOUT_SHOT is set", () => {
  const workdir = mkdtempSync(path.join(tmpdir(), "jevlens-shot-"));
  const unset = layoutShotPlan(workdir, {});
  assert.equal(unset.file, path.join(workdir, "layout.png"));
  assert.equal(unset.copyTo, "");
  const shot = path.join(workdir, "layout.png");
  writeFileSync(shot, "png");
  assert.equal(publishLayoutShot(shot, unset.copyTo), shot);
  assert.equal(readFileSync(shot, "utf8"), "png");

  const dest = path.join(workdir, "out", "layout.png");
  const set = layoutShotPlan(workdir, { JEVLENS_LAYOUT_SHOT: dest });
  assert.equal(set.copyTo, dest);
  assert.equal(publishLayoutShot(shot, set.copyTo), dest);
  assert.equal(readFileSync(dest, "utf8"), "png");
});
