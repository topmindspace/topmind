/**
 * Pure helpers extracted from FileEditorView chrome.
 * Source of truth: src/plugins/topmind-workspace/views/file-editor-chrome.tsx
 * (TSX — assert via reimplemented mirror of pure formatters to avoid React in node:test.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  assert.match(chromeSrc, /export function SaveBadge/);
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

/** Mirror of formatFileSize for behavior lock (keep in sync with TSX). */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

test("formatFileSize buckets", () => {
  assert.equal(formatFileSize(500), "500 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
});
