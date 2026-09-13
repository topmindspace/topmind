/**
 * TitleBar injected actions — each canvas must portal the actions that belong
 * to that view, and must not leave a duplicate command strip in the page body.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

function sliceTitleBarActions(src) {
  const start = src.indexOf("<TitleBarActions");
  assert.ok(start >= 0, "missing TitleBarActions");
  const end = src.indexOf("</TitleBarActions>", start);
  assert.ok(end > start, "unclosed TitleBarActions");
  return src.slice(start, end);
}

test("TitleBar view-switcher trigger actually toggles the menu", () => {
  const src = read("src/components/shell/TitleBar.tsx");
  assert.match(src, /data-view-switcher/);
  assert.match(src, /onClick=\{\(\) => setViewMenuOpen\(\(open\) => !open\)\}/);
  assert.match(src, /aria-expanded=\{viewMenuOpen\}/);
  assert.match(src, /aria-haspopup="listbox"/);
  assert.match(src, /disabled=\{viewMenuOpen\}/);
});

test("TitleBar first crumb is longer and more readable than later crumbs", () => {
  const src = read("src/components/shell/TitleBar.tsx");
  assert.match(src, /i === 0 \? "max-w-36 shrink-0" : "max-w-28"/);
  assert.match(src, /text-xs font-semibold tracking-tight text-text-primary/);
  assert.doesNotMatch(src, /max-w-24 truncate text-3xs text-text-quaternary/);
});

test("three column headers share v4-column-chrome", () => {
  const sidebar = read("src/components/shell/Sidebar.tsx");
  const title = read("src/components/shell/TitleBar.tsx");
  const ai = read("src/components/ai/AiWorkspace.tsx");
  const css = read("src/styles/v4.css");
  assert.match(css, /\.v4-column-chrome\s*\{/);
  assert.match(sidebar, /v4-column-chrome/);
  assert.match(title, /v4-column-chrome/);
  assert.match(ai, /v4-column-chrome/);
});

test("stream injects organize + refresh into TitleBar", () => {
  const src = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  const slot = sliceTitleBarActions(src);
  assert.match(slot, /ChromeOverflowActions/);
  assert.match(src, /id:\s*"organize"/);
  assert.match(src, /id:\s*"reload"/);
  assert.doesNotMatch(src, /<PageHeader/);
});

test("inbox / outputs / archive inject refresh into TitleBar", () => {
  const inbox = read("src/plugins/topmind-workspace/views/InboxView.tsx");
  const inboxSlot = sliceTitleBarActions(inbox);
  assert.match(inboxSlot, /data-inbox-new-note/);
  assert.match(inboxSlot, /shared\.newNote/);
  assert.match(inboxSlot, /data-inbox-refresh/);
  const outputs = read("src/plugins/topmind-workspace/views/OutputsView.tsx");
  assert.match(sliceTitleBarActions(outputs), /common:action\.refresh/);
  const archive = read("src/plugins/topmind-workspace/views/ArchiveView.tsx");
  assert.match(sliceTitleBarActions(archive), /data-archive-refresh/);
});

test("category injects new topic + new note; topic injects memory / topic.md / new", () => {
  const category = read("src/plugins/topmind-workspace/views/CategoryView.tsx");
  const catSlot = sliceTitleBarActions(category);
  assert.match(catSlot, /shared\.newTopic/);
  assert.match(catSlot, /shared\.newNote/);
  const topic = read("src/plugins/topmind-workspace/views/TopicOverviewView.tsx");
  const topicSlot = sliceTitleBarActions(topic);
  assert.match(topicSlot, /topicOverview\.memory/);
  assert.match(topicSlot, /openTopicMd/);
  assert.match(topicSlot, /common:action\.new/);
});

test("memory injects open-folder + organize", () => {
  const src = read("src/plugins/topmind-workspace/views/MemoryBrowseView.tsx");
  const slot = sliceTitleBarActions(src);
  assert.match(slot, /data-memory-open-folder/);
  assert.match(slot, /data-memory-organize/);
});

test("file editor injects file-context actions; outline/appearance/focus live on properties row", () => {
  const view = read("src/plugins/topmind-workspace/views/FileEditorView.tsx");
  const fmt = read("src/plugins/topmind-workspace/views/file-editor-format-bar.tsx");
  const fm = read("src/components/editor/FrontmatterBar.tsx");
  assert.match(sliceTitleBarActions(view), /FileEditorTitleBarActions/);
  assert.match(fmt, /export function EditorViewChrome/);
  assert.match(fmt, /data-editor-view-chrome/);
  assert.match(fm, /trailing/);
  assert.match(fm, /data-editor-view-chrome-slot/);
  assert.match(view, /trailing=\{viewChrome\}/);
  const mopStart = view.indexOf("v4-editor-toolbar");
  const propsStart = view.indexOf("showProperties ? (");
  assert.ok(mopStart >= 0 && propsStart > mopStart);
  const mop = view.slice(mopStart, propsStart);
  assert.doesNotMatch(mop, /EditorReadingMenu/);
  assert.doesNotMatch(mop, /onToggleFocus/);
  assert.match(view, /EditorViewChrome/);
});
