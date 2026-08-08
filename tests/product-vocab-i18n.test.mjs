/**
 * Product vocabulary consistency across Desktop + Obsidian locales.
 * Drives shipped locale files (not re-implemented strings).
 *
 * Core concepts (≤5): 记一下/Note it · 记下/Log it · 动态 · 专题 · 我的情况 · 写出来
 * Clip Extension uses Clip/剪藏 intentionally (companion surface) — covered in extension-i18n-parity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

test("Desktop shell capture CTAs: 记一下/Note it and 记下/Log it (not mixed across locales)", () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const zhWs = readJson("topmind-desktop/src/locales/zh-CN/workspace.json");
  const enWs = readJson("topmind-desktop/src/locales/en-US/workspace.json");

  assert.equal(zhShell.titleBar.capture, "记一下");
  assert.equal(enShell.titleBar.capture, "Note it");
  assert.equal(zhWs.streamDetail.composeSubmit, "记下");
  assert.equal(enWs.streamDetail.composeSubmit, "Log it");
  // Must not reverse-mix product words into the wrong locale
  assert.doesNotMatch(enShell.titleBar.capture, /记一下|记下/);
  assert.doesNotMatch(zhShell.titleBar.capture, /Note it|Log it/i);
  assert.doesNotMatch(enWs.streamDetail.composeSubmit, /记一下|记下/);
  assert.doesNotMatch(zhWs.streamDetail.composeSubmit, /Note it|Log it/i);
});

test("Desktop nav chips expose 写出来 / 我的情况 product terms", () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  assert.equal(zhShell.primaryNav.outputs, "写出来");
  assert.equal(zhShell.sidebar.myProfile, "我的情况");
  assert.ok(enShell.primaryNav.outputs, "en outputs present");
  assert.ok(enShell.sidebar.myProfile, "en myProfile present");
  assert.doesNotMatch(enShell.primaryNav.outputs, /写出来/);
  assert.doesNotMatch(zhShell.primaryNav.outputs, /Ship it|Outputs|Write out/i);
});

test("Obsidian capture CTAs align with Desktop product vocabulary", () => {
  const zh = read("obsidian-plugin/src/i18n/locales/zh-CN.ts");
  const en = read("obsidian-plugin/src/i18n/locales/en-US.ts");
  assert.match(zh, /quick_capture_title:\s*"记一下"/u);
  assert.match(en, /quick_capture_title:\s*"Note it"/u);
  assert.match(zh, /quick_capture_submit:\s*"记下"/u);
  assert.match(en, /quick_capture_submit:\s*"Log it"/u);
  assert.match(zh, /cmd_quick_capture:\s*"Topmind: 记一下"/u);
  assert.match(en, /cmd_quick_capture:\s*"Topmind: Note it"/u);
  assert.match(zh, /suggestion_memory:\s*"写入「我的情况」"/u);
  // No reverse-locale pollution on primary CTAs
  assert.doesNotMatch(en, /quick_capture_title:\s*"记一下"/u);
  assert.doesNotMatch(zh, /quick_capture_title:\s*"Note it"/u);
});
