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

test("Kernel AI op labels say 整理我的情况 not 整理记忆", () => {
  const src = read("lib/ai-operation-engine.mjs");
  assert.match(src, /memoryOrganize:\s*"AI 整理我的情况"/u);
  assert.match(src, /memoryOrganize:\s*"AI Organize My profile"/u);
  assert.doesNotMatch(src, /整理记忆/);
  assert.doesNotMatch(src, /整理「记忆」/);
  assert.doesNotMatch(src, /Organize Memory/);
  assert.doesNotMatch(src, /Extract "memory" candidates/);
});

test("Desktop nav chips expose 写出来 / 我的情况 product terms", () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const zhWs = readJson("topmind-desktop/src/locales/zh-CN/workspace.json");
  const enWs = readJson("topmind-desktop/src/locales/en-US/workspace.json");
  assert.equal(zhShell.primaryNav.outputs, "写出来");
  assert.equal(zhShell.sidebar.myProfile, "我的情况");
  assert.equal(enShell.sidebar.myProfile, "My profile");
  assert.equal(zhWs.memoryBrowse.title, "我的情况");
  assert.equal(enWs.memoryBrowse.title, "My profile");
  assert.equal(zhWs.memoryBrowse.organize, "整理我的情况");
  assert.equal(enWs.memoryBrowse.organize, "Organize My profile");
  assert.ok(enShell.primaryNav.outputs, "en outputs present");
  assert.doesNotMatch(enShell.primaryNav.outputs, /写出来/);
  assert.doesNotMatch(zhShell.primaryNav.outputs, /Ship it|Outputs|Write out/i);
  // 我的情况 is a secondary pin, not a PrimaryNav peer; EN is My profile not About me
  assert.equal(zhShell.primaryNav.memory, undefined);
  assert.equal(enShell.primaryNav.memory, undefined);
  assert.doesNotMatch(JSON.stringify(enShell), /About me/);
  assert.doesNotMatch(JSON.stringify(enWs), /About me/);
});

test("Obsidian capture CTAs align with Desktop product vocabulary", () => {
  const zh = read("obsidian-plugin/src/i18n/locales/zh-CN.ts");
  const en = read("obsidian-plugin/src/i18n/locales/en-US.ts");
  assert.match(zh, /quick_capture_title:\s*"记一下"/u);
  assert.match(en, /quick_capture_title:\s*"Note it"/u);
  assert.doesNotMatch(zh, /quick_capture_submit:/u);
  assert.doesNotMatch(en, /quick_capture_submit:/u);
  assert.match(zh, /quick_capture_note_it:\s*"记一下"/u);
  assert.match(en, /quick_capture_note_it:\s*"Note it"/u);
  assert.match(zh, /quick_capture_log_it:\s*"记下"/u);
  assert.match(en, /quick_capture_log_it:\s*"Log it"/u);
  assert.match(zh, /cmd_quick_capture:\s*"Topmind: 记一下"/u);
  assert.match(en, /cmd_quick_capture:\s*"Topmind: Note it"/u);
  assert.match(zh, /suggestion_memory:\s*"写入「我的情况」"/u);
  // No reverse-locale pollution on primary CTAs
  assert.doesNotMatch(en, /quick_capture_title:\s*"记一下"/u);
  assert.doesNotMatch(zh, /quick_capture_title:\s*"Note it"/u);
});

test("Obsidian stream surface is 动态/Stream, not a sixth 工作台/Workbench room", () => {
  const zh = read("obsidian-plugin/src/i18n/locales/zh-CN.ts");
  const en = read("obsidian-plugin/src/i18n/locales/en-US.ts");
  assert.match(zh, /stream_workbench_title:\s*"动态"/u);
  assert.match(en, /stream_workbench_title:\s*"Stream"/u);
  assert.doesNotMatch(zh, /stream_workbench_title:\s*"[^"]*工作台/u);
  assert.doesNotMatch(en, /stream_workbench_title:\s*"[^"]*Workbench/u);
  assert.match(zh, /sidebar_btn_workbench:\s*"动态"/u);
  assert.match(en, /sidebar_btn_workbench:\s*"Stream"/u);
  assert.match(zh, /cmd_open_workbench:\s*"Topmind: 打开动态"/u);
  assert.match(en, /cmd_open_workbench:\s*"Topmind: Open Stream"/u);
  assert.match(zh, /sidebar_op_memory:\s*"整理我的情况"/u);
  assert.match(en, /sidebar_op_memory:\s*"Organize My profile"/u);
  assert.match(zh, /memory_browse_organize:\s*"整理我的情况"/u);
  assert.match(en, /memory_browse_organize:\s*"Organize My profile"/u);
  assert.doesNotMatch(en, /About me/);
});

test("Obsidian compose vs capture call the distinct vocab keys", () => {
  const workbench = read("obsidian-plugin/src/views/stream-workbench-view.ts");
  const modal = read("obsidian-plugin/src/views/quick-capture-modal.ts");
  assert.match(workbench, /t\("quick_capture_log_it"\)/);
  assert.match(workbench, /aria-label": t\("quick_capture_log_it"\)/);
  assert.doesNotMatch(workbench, /aria-label": t\("quick_capture_title"\)/);
  assert.match(modal, /t\("quick_capture_note_it"\)/);
  assert.match(modal, /t\("quick_capture_title"\)/);
  assert.doesNotMatch(modal, /t\("quick_capture_submit"\)/);
  assert.doesNotMatch(modal, /t\("quick_capture_log_it"\)/);
});
