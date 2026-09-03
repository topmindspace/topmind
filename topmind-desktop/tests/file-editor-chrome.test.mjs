/**
 * File editor chrome + format bar — drive shipped sources (not a reimplementation).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatFileSize, formatDateTime } from "../src/plugins/topmind-workspace/views/file-editor-chrome.tsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeSrc = readFileSync(
  path.join(root, "src/plugins/topmind-workspace/views/file-editor-chrome.tsx"),
  "utf8",
);

test("file-editor-chrome exports SaveBadge / ToolbarButton / format helpers", () => {
  assert.match(chromeSrc, /export type SaveState/);
  assert.match(chromeSrc, /export function formatFileSize/);
  assert.match(chromeSrc, /export function formatDateTime/);
  assert.match(chromeSrc, /export function ToolbarButton/);
  assert.match(chromeSrc, /export (?:function|const) SaveBadge/);
  assert.match(chromeSrc, /export function ToolbarSep/);
});

test("FileEditorView imports chrome + format-bar (no inline SaveBadge)", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
    "utf8",
  );
  assert.match(view, /from ["']\.\/file-editor-chrome["']/);
  assert.match(view, /from ["']\.\/file-editor-format-bar["']/);
  assert.match(view, /EditorFormatBar|EditorModeSwitch|EditorMoreMenu/);
  assert.doesNotMatch(view, /function SaveBadge\b/);
  assert.doesNotMatch(view, /function ToolbarButton\b/);
  assert.doesNotMatch(view, /function formatFileSize\b/);
});

test("file-editor-format-bar exports mode / format / more chrome", () => {
  const fmt = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/file-editor-format-bar.tsx"),
    "utf8",
  );
  assert.match(fmt, /export function EditorModeSwitch/);
  assert.match(fmt, /export function EditorFormatBar/);
  assert.match(fmt, /export function EditorMoreMenu/);
  assert.match(fmt, /from ["']\.\/file-editor-chrome["']/);
});

test("shipped formatFileSize / formatDateTime buckets", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
  assert.match(formatDateTime("2026-08-15T12:04:00.000Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});

test("EditorFormatBar ships format toggles; more ⋯ is exclusive", () => {
  const fmt = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/file-editor-format-bar.tsx"),
    "utf8",
  );
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
    "utf8",
  );
  const css = readFileSync(path.join(root, "src/styles/v4.css"), "utf8");
  for (const token of [
    "toggleBold",
    "toggleItalic",
    "toggleUnderline",
    "toggleStrike",
    "toggleCode",
    "toggleHeading",
    "toggleBulletList",
    "toggleOrderedList",
    "toggleBlockquote",
    "onInsertLink",
    "onInsertDateTime",
  ]) {
    assert.match(fmt, new RegExp(token));
  }
  assert.match(view, /const \[showFormat, setShowFormat\] = useState\(true\)/);
  assert.match(view, /EditorFormatBar/);
  assert.doesNotMatch(view, /showFormat.*selectionAi|selectionAi.*showFormat/u);
  // Single ⋯ menu — rail publish/AI-edit are not also DropdownItems
  assert.doesNotMatch(fmt, /ChromeOverflowActions/);
  assert.match(fmt, /formatBarOptions\.fileInfo/);
  assert.match(fmt, /formatBarOptions\.moreActions/);
  assert.match(fmt, /onPublish/);
  assert.match(fmt, /onRequestAiBar/);
  assert.match(fmt, /RiH3/);
  const dateIdx = fmt.indexOf("onInsertDateTime ? (");
  const showFormatIdx = fmt.indexOf("{showFormat ? (");
  assert.ok(showFormatIdx >= 0 && dateIdx > showFormatIdx, "date-time control must sit inside showFormat");
  // Compact hides labels via data-compact, not truncated unlabeled fragments
  assert.match(css, /\[data-compact="true"\] \[data-compact-hidden\]/);
  assert.match(view, /data-compact=\{toolbarCompact/);
  assert.match(fmt, /data-compact-hidden/);
});
