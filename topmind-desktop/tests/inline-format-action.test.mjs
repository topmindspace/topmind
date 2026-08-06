/**
 * Inline AI「格式」action + StatusBar AI chrome wiring — structural + locale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeInlineAiResult } from "../src/lib/inline-ai-result.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("SelectionAiBar exposes format action in shipped UI action set", () => {
  // Split source: action set in SelectionAiToolbar, complete wiring in useSelectionAi,
  // EditorAiAction re-exported by SelectionAiBar
  const src =
    read("src/components/editor/SelectionAiBar.tsx") +
    read("src/components/editor/SelectionAiToolbar.tsx") +
    read("src/components/editor/useSelectionAi.ts");
  assert.match(src, /"format"/);
  assert.match(src, /formatLabel/);
  assert.match(src, /EditorAiAction/);
  // Routes through ai.complete like other rewrite actions
  assert.match(src, /api\.ai\.complete/);
  assert.match(src, /sanitizeInlineAiResult/);
});

test("ai.complete action map includes format hint (main process)", () => {
  const svc = read("electron/ai-service.mjs");
  assert.match(svc, /format:\s*ei18n\("ai\.format"\)/);
  assert.match(svc, /sanitizeInlineAiResult/);
  const i18n = read("electron/lib/electron-i18n.mjs");
  assert.match(i18n, /"ai\.format"/);
});

test("format locales exist in zh-CN and en-US editor", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/editor.json"));
  const en = JSON.parse(read("src/locales/en-US/editor.json"));
  assert.equal(typeof zh.selectionAi.formatLabel, "string");
  assert.equal(typeof zh.selectionAi.formatTip, "string");
  assert.equal(typeof en.selectionAi.formatLabel, "string");
  assert.equal(typeof en.selectionAi.formatTip, "string");
  assert.match(zh.selectionAi.formatLabel, /格式/);
  assert.match(en.selectionAi.formatLabel, /Format/i);
});

test("api.complete action union documents format", () => {
  const api = read("src/services/api.ts");
  assert.match(api, /\|\s*"format"/);
});

test("sanitizeInlineAiResult strips thinking before format apply path", () => {
  const cleaned = sanitizeInlineAiResult(
    `<think>plan formatting</think>\n\n## Heading\n\n- a\n- b\n`,
  );
  assert.doesNotMatch(cleaned, /plan formatting|<think/);
  assert.match(cleaned, /Heading/);
  assert.match(cleaned, /- a/);
});
