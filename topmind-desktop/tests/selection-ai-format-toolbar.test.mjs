/**
 * Selection inline AI + format toolbar coexistence.
 * Proves quick format controls ship with selection AI, and main format bar stays wired.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("SelectionAiBar exposes quick format toolbar for selection scope", () => {
  // Quick-format row lives in SelectionAiToolbar (split from SelectionAiBar)
  const src = read("src/components/editor/SelectionAiToolbar.tsx");
  assert.match(src, /data-selection-ai-format-toolbar/);
  assert.match(src, /quickFormatAria|selectionAi\.quickFormatAria/);
  assert.match(src, /toggleBold/);
  assert.match(src, /toggleItalic/);
  assert.match(src, /toggleBulletList/);
  assert.match(src, /toggleOrderedList/);
  assert.match(src, /toggleHeading/);
  assert.match(src, /setTextSelection/);
  // Only when selection scope (not menu-only)
  assert.match(src, /target\.scope === ["']selection["']/);
});

test("SelectionAiBar still routes format AI action through complete", () => {
  // "format" action id ships in SelectionAiToolbar; complete routing in useSelectionAi
  const src =
    read("src/components/editor/SelectionAiToolbar.tsx") +
    read("src/components/editor/useSelectionAi.ts");
  assert.match(src, /"format"/);
  assert.match(src, /documentText/);
  assert.match(src, /api\.ai\.complete/);
});

test("EditorFormatBar remains independent (not gated by selection AI open)", () => {
  const fmt = read("src/plugins/topmind-workspace/views/file-editor-format-bar.tsx");
  const view = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  assert.match(fmt, /export function EditorFormatBar/);
  assert.match(fmt, /toggleBold/);
  assert.match(fmt, /toggleBulletList/);
  // File editor always mounts format bar in edit mode — no selection-ai disable
  assert.match(view, /EditorFormatBar/);
  assert.doesNotMatch(view, /EditorFormatBar[\s\S]{0,200}disabled=\{.*selection/u);
  assert.doesNotMatch(view, /showFormat.*selectionAi|selectionAi.*showFormat/u);
});

test("quick format locale keys exist zh + en", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/editor.json"));
  const en = JSON.parse(read("src/locales/en-US/editor.json"));
  for (const key of [
    "quickFormatAria",
    "quickFormatBold",
    "quickFormatItalic",
    "quickFormatCode",
    "quickFormatH2",
    "quickFormatBullet",
    "quickFormatOrdered",
  ]) {
    assert.equal(typeof zh.selectionAi[key], "string", `zh missing ${key}`);
    assert.equal(typeof en.selectionAi[key], "string", `en missing ${key}`);
  }
});

test("AI entry consistency: stream polish chip + selection bar + format action", () => {
  const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  const bar = read("src/components/editor/SelectionAiToolbar.tsx");
  assert.match(stream, /data-stream-compose-polish|composeAiPolish|polishComposerText/);
  assert.match(stream, /v4-ai-btn-ghost/);
  assert.match(bar, /v4-ai-btn/);
  assert.match(bar, /Sparkles/);
});
