/**
 * Tests for inbox_organize suggestion kind — AI-powered inbox → topic routing.
 *
 * Verifies:
 * - SuggestPopover maps inbox_organize to correct icon + chip key
 * - ActionStore does NOT force archive action for inbox_organize (keeps own payload)
 * - ActionStore navigates to target file (not stream) after inbox_organize apply
 * - i18n keys exist for the new chip label in zh-CN and en-US
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("SuggestPopover maps inbox_organize to Inbox icon + kindChipInboxOrganize", () => {
  const src = read("src/components/ai/SuggestPopover.tsx");
  // Icon mapping: inbox_organize shares Inbox icon with inbox_review
  assert.match(src, /case "inbox_organize":/);
  // Chip key: inbox_organize gets its own label (distinct from inbox_review)
  assert.match(src, /case "inbox_organize":\s*\n\s*return "kindChipInboxOrganize"/);
  // inbox_review still has its own chip
  assert.match(src, /case "inbox_review":\s*\n\s*return "kindChipInbox"/);
});

test("ActionStore does NOT force archive for inbox_organize (keeps own payload)", () => {
  const src = read("src/stores/action-store.ts");
  // inbox_organize must NOT be in the archive-kind list
  assert.match(src, /isArchiveKind/);
  assert.match(src, /inbox_review/);
  assert.match(src, /inbox_organize.*keep its own payload/);
  // The archive-forcing ternary must NOT include inbox_organize
  assert.doesNotMatch(
    src,
    /inbox_review.*\|\|.*inbox_organize.*\|\|.*stale_topic.*\?\s*\{/,
  );
});

test("ActionStore navigates to target file after inbox_organize apply", () => {
  const src = read("src/stores/action-store.ts");
  // After apply: navigate to the moved file path (not stream)
  assert.match(src, /inbox_organize[\s\S]*?res\.targetPath[\s\S]*?select[\s\S]*?kind.*file/);
  // Old archive kinds still navigate to stream
  assert.match(src, /inbox_review[\s\S]*?stale_topic[\s\S]*?catch_all[\s\S]*?select[\s\S]*?kind.*stream/);
});

test("StatusBar uses progress dot for ALL busy chips (unified)", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  assert.match(src, /v4-ai-progress-dot/);
  // Task chip has progress dot
  assert.match(src, /showTaskChip[\s\S]*?v4-ai-progress-dot/);
  // Todo chip has progress dot
  assert.match(src, /showTodoChip[\s\S]*?v4-ai-progress-dot/);
  // Suggest chip has progress dot
  assert.match(src, /showSuggestChip[\s\S]*?v4-ai-progress-dot/);
  // Inline chip has progress dot
  assert.match(src, /showInlineChip[\s\S]*?v4-ai-progress-dot/);
});

test("StatusBar uses unified v4-ai-busy-icon for todo/suggest chips", () => {
  const src = read("src/components/shell/StatusBar.tsx");
  // Todo chip should use v4-ai-busy-icon (unified animation, not animate-pulse-soft)
  assert.match(src, /showTodoChip[\s\S]*?v4-ai-busy-icon/);
  // Suggest chip should use v4-ai-busy-icon
  assert.match(src, /showSuggestChip[\s\S]*?v4-ai-busy-icon/);
  // Suggest chip should have accent background (not text-tertiary)
  assert.match(src, /showSuggestChip[\s\S]*?bg-accent-bg-faint/);
  // All busy chips should have v4-ai-busy-text on label
  assert.match(src, /v4-ai-busy-text/);
});

test("CSS defines v4-ai-progress-dot and v4-ai-busy-icon animations", () => {
  const css = read("src/styles/v4.css");
  assert.match(css, /\.v4-ai-progress-dot/);
  assert.match(css, /v4-ai-progress-dot-pulse/);
  assert.match(css, /\.v4-ai-busy-icon/);
  assert.match(css, /v4-ai-busy-icon-pulse/);
  assert.match(css, /\.v4-ai-busy-text/);
  assert.match(css, /v4-ai-busy-text-pulse/);
});

test("i18n keys exist for inbox_organize chip in zh-CN and en-US", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/editor.json"));
  const en = JSON.parse(read("src/locales/en-US/editor.json"));
  assert.equal(typeof zh.ai.kindChipInboxOrganize, "string", "zh missing kindChipInboxOrganize");
  assert.equal(typeof en.ai.kindChipInboxOrganize, "string", "en missing kindChipInboxOrganize");
  assert.equal(typeof zh.ai.kindChipOrganize, "string", "zh missing kindChipOrganize");
  assert.equal(typeof en.ai.kindChipOrganize, "string", "en missing kindChipOrganize");
});

test("StatusBar tooltips have duration/expectation hints (zh + en)", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
  const en = JSON.parse(read("src/locales/en-US/shell.json"));
  // Todo tip should mention time expectation
  assert.match(zh.statusBar.todoMaintainingTip, /秒|数/);
  assert.match(en.statusBar.todoMaintainingTip, /second|few/i);
  // Suggest tip should mention "click to view"
  assert.match(zh.statusBar.suggestLoadingTip, /查看|点此/);
  assert.match(en.statusBar.suggestLoadingTip, /view|click/i);
  // Task tip should mention "progress"
  assert.match(zh.statusBar.taskRunningTip, /进度|详情/);
  assert.match(en.statusBar.taskRunningTip, /progress|detail/i);
});
