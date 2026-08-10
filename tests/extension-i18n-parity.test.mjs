/**
 * Clip Extension locale parity — drives shipped _locales messages.json files.
 * Ensures en_US / zh_CN message IDs match (same contract as Desktop check:i18n).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadMessages(locale) {
  const p = path.join(repoRoot, "browser-extension", "_locales", locale, "messages.json");
  assert.ok(fs.existsSync(p), `missing locale file: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

test("extension en_US and zh_CN have identical message IDs", () => {
  const en = loadMessages("en_US");
  const zh = loadMessages("zh_CN");
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(
    enKeys,
    zhKeys,
    `extension locale key mismatch:\n  only en: ${enKeys.filter((k) => !zh[k]).join(", ") || "(none)"}\n  only zh: ${zhKeys.filter((k) => !en[k]).join(", ") || "(none)"}`,
  );
  assert.ok(enKeys.length >= 50, `expected a full message catalog, got ${enKeys.length} keys`);
});

test("extension message entries have non-empty message strings in both locales", () => {
  const en = loadMessages("en_US");
  const zh = loadMessages("zh_CN");
  for (const key of Object.keys(en)) {
    assert.equal(typeof en[key]?.message, "string", `en ${key}.message`);
    assert.ok(en[key].message.trim().length > 0, `en ${key} empty`);
    assert.equal(typeof zh[key]?.message, "string", `zh ${key}.message`);
    assert.ok(zh[key].message.trim().length > 0, `zh ${key} empty`);
  }
});

test("extension product vocabulary stays Clip/剪藏 (companion surface, not Desktop 记一下)", () => {
  const en = loadMessages("en_US");
  const zh = loadMessages("zh_CN");
  // Core CTA must use Clip vocabulary, not Desktop "Note it" / 记一下
  assert.match(en.btn_clip?.message || "", /Clip/i);
  assert.match(zh.btn_clip?.message || "", /剪藏/);
  assert.doesNotMatch(en.btn_clip?.message || "", /Note it/i);
  assert.doesNotMatch(zh.btn_clip?.message || "", /记一下/);
  // Topic destination uses product term 专题 / Topic
  assert.match(en.dest_topic?.message || "", /Topic/i);
  assert.match(zh.dest_topic?.message || "", /专题/);
});
