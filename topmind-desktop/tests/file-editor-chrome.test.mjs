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
  assert.match(fmt, /export function EditorViewChrome/);
  assert.match(chromeSrc, /v4-editor-tool-btn/);
  assert.match(fmt, /v4-editor-tool-btn/);
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
  // Properties row default-collapsed; save badge quiet when clean.
  assert.match(view, /const \[propertiesOpen, setPropertiesOpen\] = useState\(false\)/);
  assert.match(chromeSrc, /showLabel = effective !== "clean"/);
  assert.match(fmt, /showPropertiesToggle/);
  assert.match(view, /EditorFormatBar/);
  assert.doesNotMatch(view, /showFormat.*selectionAi|selectionAi.*showFormat/u);
  // Formatting retains its own menu; file actions use the shared titlebar rail.
  const formatTools = fmt.slice(fmt.indexOf("export function EditorFormatBar"), fmt.indexOf("export function EditorViewChrome"));
  assert.doesNotMatch(formatTools, /ChromeOverflowActions/);
  assert.match(fmt, /formatBarOptions\.fileInfo/);
  assert.match(fmt, /formatBarOptions\.moreActions/);
  assert.match(fmt, /export function FileEditorTitleBarActions/);
  assert.match(fmt, /data-file-titlebar-actions/);
  assert.match(fmt, /onPublish/);
  assert.match(fmt, /onRequestAiBar/);
  assert.match(view, /TitleBarActions/);
  assert.match(view, /FileEditorTitleBarActions/);
  const toolbarStart = view.indexOf("v4-editor-toolbar");
  const titlebarActions = view.indexOf("<TitleBarActions");
  assert.ok(toolbarStart >= 0 && titlebarActions > toolbarStart);
  const mop = view.slice(toolbarStart, titlebarActions);
  assert.doesNotMatch(mop, /workspace:menu\.moveToTopic/);
  assert.doesNotMatch(mop, /onPublish=\{\(\) => void handlePublish/);
  assert.match(mop, /EditorFormatBar/);
  assert.match(mop, /EditorModeSwitch/);
  // View chrome (outline / reading / focus) stays on the format toolbar even when
  // the properties row is collapsed — not parked on FrontmatterBar.trailing.
  assert.match(view, /EditorViewChrome/);
  assert.doesNotMatch(view, /trailing=\{viewChrome\}/);
  assert.match(mop, /\{viewChrome\}/);
  assert.doesNotMatch(fmt, /Format-rail status cluster — file-info \/ focus/);
  assert.match(fmt, /RiH3/);
  const dateIdx = fmt.indexOf("onInsertDateTime ? (");
  const showFormatIdx = fmt.indexOf("{showFormat ? (");
  assert.ok(showFormatIdx >= 0 && dateIdx > showFormatIdx, "date-time control must sit inside showFormat");
  // Compact hides optional labels via data-compact; mode switch is always icon-only
  // (tooltip carries meaning) so format-bar no longer ships compact-hidden text labels.
  assert.match(css, /\[data-compact="true"\] \[data-compact-hidden\]/);
  assert.match(view, /data-compact=\{toolbarCompact/);
  assert.match(view, /data-compact-hidden/);
  assert.doesNotMatch(fmt, /sm:inline.*formatBar\.edit|formatBar\.edit.*sm:inline/s);
  // Narrow width hides the collapsed-format sentence; the chevron keeps its tooltip.
  assert.match(fmt, /data-compact-hidden/);
  assert.match(fmt, /formatBar\.collapsed/);
});

test("dirty disk conflict is keep / take / merge, and Enter does not take disk", () => {
  const view = readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
    "utf8",
  );
  const dialog = readFileSync(path.join(root, "src/components/ui/Dialog.tsx"), "utf8");
  assert.match(view, /diskConflictKeepLocal/);
  assert.match(view, /diskConflictTakeDisk/);
  assert.match(view, /diskConflictMerge/);
  assert.match(view, /applyDiskConflict\("keep-local"\)/);
  assert.match(view, /applyDiskConflict\("take-disk"\)/);
  assert.match(view, /applyDiskConflict\("merge"\)/);
  const takeAt = view.indexOf("diskConflictTakeDisk");
  assert.ok(takeAt > 0);
  const conflict = view.slice(takeAt, takeAt + 700);
  assert.match(conflict, /destructive/);
  assert.match(dialog, /destructive \? "\[data-dialog-cancel\]"/);
});

test("tab strip is conditional; title bar carries tab ops when strip is hidden", () => {
  const recents = readFileSync(
    path.join(root, "src/components/shell/EditorRecentBar.tsx"),
    "utf8",
  );
  const titleBar = readFileSync(
    path.join(root, "src/components/shell/TitleBar.tsx"),
    "utf8",
  );
  // ≤1 open file: no strip row (TitleBar breadcrumb is the identity)
  assert.match(recents, /fileTabs\.length <= 1\) return null/);
  // TitleBar right-click opens the tab/file context menu for the active file
  assert.match(titleBar, /onContextMenu=\{activeFilePath \? openTitleTabMenu/);
  assert.match(titleBar, /closeFileTab/);
  assert.match(titleBar, /editorRecentBar\.close/);
});
