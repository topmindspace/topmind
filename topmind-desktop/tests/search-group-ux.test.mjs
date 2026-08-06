/**
 * GlobalSearch path-bucket grouping — wave F4.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("GlobalSearch group UX", () => {
  it("defines path buckets and i18n group keys", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/overlays/GlobalSearch.tsx"),
      "utf8",
    );
    assert.match(src, /function searchBucket/);
    assert.match(src, /groupedResults/);
    assert.match(src, /overlays:search\.group\./);
    const zh = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/zh-CN/overlays.json"), "utf8"),
    );
    const en = JSON.parse(
      fs.readFileSync(path.join(root, "src/locales/en-US/overlays.json"), "utf8"),
    );
    for (const k of ["stream", "memory", "inbox", "topic", "outputs", "archive", "other"]) {
      assert.equal(typeof zh.search.group[k], "string", `zh group.${k}`);
      assert.equal(typeof en.search.group[k], "string", `en group.${k}`);
    }
    assert.match(zh.search.group.outputs, /写出来/);
    assert.match(en.search.group.outputs, /Ship/i);
  });

  it("capture has dest chips and progressive advanced", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/overlays/CaptureForm.tsx"),
      "utf8",
    );
    assert.match(src, /noteDest/);
    assert.match(src, /destStream|destInbox/);
    assert.match(src, /showAdvanced/);
    assert.match(src, /advancedShow|overlays:capture\.advancedShow/);
  });

  it("SuggestPopover supports full review dialog for pending writes", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/ai/SuggestPopover.tsx"),
      "utf8",
    );
    assert.match(src, /reviewId/);
    assert.match(src, /pendingReview/);
    assert.match(src, /ConfirmDialog/);
  });
});
