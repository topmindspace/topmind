/**
 * Editor markdown helpers — contentWidth normalize + pure contracts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("normalizeContentWidth accepts known modes and defaults to reading", async () => {
  // Import compiled TS via tsx (test runner)
  const mod = await import(pathToFileURL(path.join(root, "src/lib/editor-markdown.ts")).href);
  assert.equal(mod.normalizeContentWidth("compact"), "compact");
  assert.equal(mod.normalizeContentWidth("wide"), "wide");
  assert.equal(mod.normalizeContentWidth("full"), "full");
  assert.equal(mod.normalizeContentWidth("reading"), "reading");
  assert.equal(mod.normalizeContentWidth("nope"), "reading");
  assert.equal(mod.normalizeContentWidth(undefined), "reading");
  assert.ok(mod.EDITOR_CONTENT_WIDTHS.length >= 4);
  // setEditorMarkdown must only pass strings (Markdown extension parses once)
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(path.join(root, "src/lib/editor-markdown.ts"), "utf8"),
  );
  assert.match(src, /export function setEditorMarkdown[\s\S]*?setContent\(body/);
  // Executable path must not call parser.parse (strip line comments first)
  const fnBody = (src.match(/export function setEditorMarkdown[\s\S]*?\n\}/u)?.[0] || "")
    .replace(/\/\/.*$/gmu, "");
  assert.doesNotMatch(fnBody, /parser\.parse\s*\(/);
  assert.match(fnBody, /setContent\(body/);
});

test("FileEditorView preview is static HTML with shared reading prefs (not live TipTap)", async () => {
  const fs = await import("node:fs");
  const view = fs.readFileSync(
    path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
    "utf8",
  );
  assert.match(view, /getEditorHtml/);
  assert.match(view, /dangerouslySetInnerHTML=\{\{\s*__html:\s*previewHtml/);
  assert.match(view, /data-paper=\{paper\}/);
  assert.match(view, /data-content-width=\{contentWidth\}/);
  assert.match(view, /data-page-padding=\{pagePadding\}/);
  assert.match(view, /style=\{proseStyle\}/);
  assert.match(view, /fontSize: `\$\{editorSettings\.fontSize\}px`/);
  // Preview branch snapshots HTML; live EditorContent is only in the edit branch
  const previewRender = view.match(
    /viewMode === "preview" \|\| readOnly \? \([\s\S]*?\) : \([\s\S]*?<EditorContent/,
  );
  assert.ok(previewRender, "expected preview ternary then EditorContent in edit branch");
  assert.match(previewRender[0], /dangerouslySetInnerHTML/);
  assert.match(previewRender[0], /<EditorContent/);
});

test("mergeEditorPrefs (shipped) clamps and defaults reading fields", async () => {
  const { mergeEditorPrefs, DEFAULT_EDITOR_PREFS } = await import(
    pathToFileURL(path.join(root, "src/lib/editor-prefs.ts")).href
  );
  const next = mergeEditorPrefs({ fontSize: 99, paper: "sepia", contentWidth: "wide" }, null);
  assert.equal(next.fontSize, 24);
  assert.equal(next.paper, "sepia");
  assert.equal(next.contentWidth, "wide");
  assert.equal(next.lineHeight, DEFAULT_EDITOR_PREFS.lineHeight);
  assert.equal(next.inlineAiAutoPopup, true);
  const bad = mergeEditorPrefs({ paper: "neon", fontFamily: "comic" }, DEFAULT_EDITOR_PREFS);
  assert.equal(bad.paper, "default");
  assert.equal(bad.fontFamily, "sans");
  const off = mergeEditorPrefs({ fontSize: 18 }, { inlineAiAutoPopup: false });
  assert.equal(off.inlineAiAutoPopup, false);
  assert.equal(off.fontSize, 18);
});

test("settings normalizeEditorSettings preserves contentWidth", async () => {
  const mod = await import(pathToFileURL(path.join(root, "electron/settings.mjs")).href);
  const { createDefaultAppSettings, __settingsTest } = mod;
  const base = createDefaultAppSettings("/tmp/ws");
  assert.equal(base.editor.contentWidth, "reading");
  const next = __settingsTest.normalizeEditorSettings(
    { contentWidth: "wide", fontSize: 18 },
    base.editor,
  );
  assert.equal(next.contentWidth, "wide");
  assert.equal(next.fontSize, 18);
  const bad = __settingsTest.normalizeEditorSettings({ contentWidth: "huge" }, base.editor);
  assert.equal(bad.contentWidth, "reading");
  const off = __settingsTest.normalizeEditorSettings(
    { inlineAiAutoPopup: false },
    base.editor,
  );
  assert.equal(off.inlineAiAutoPopup, false);
});

test("preprocessMarkdownForBlocks does not invent blank lines between list items", async () => {
  const { preprocessMarkdownForBlocks, alignMarkdownIndent, prepareMarkdownForEditorInsert } =
    await import(pathToFileURL(path.join(root, "src/lib/editor-markdown.ts")).href);

  assert.equal(preprocessMarkdownForBlocks("- a\n- b"), "- a\n- b");
  assert.equal(preprocessMarkdownForBlocks("- a\n  - nested"), "- a\n  - nested");
  assert.equal(preprocessMarkdownForBlocks("para\n- a"), "para\n\n- a");
  assert.equal(preprocessMarkdownForBlocks("para\n## Heading"), "para\n\n## Heading");
  assert.equal(preprocessMarkdownForBlocks("- a\n\n\n- b"), "- a\n- b");
  assert.equal(preprocessMarkdownForBlocks("- a\n1. b"), "- a\n\n1. b");

  assert.equal(alignMarkdownIndent("- item", "    - item"), "- item");
  assert.equal(alignMarkdownIndent("  - item", "- item"), "  - item");
  assert.equal(alignMarkdownIndent("- a\n  - b", "- a\n  - b"), "- a\n  - b");

  const prepared = prepareMarkdownForEditorInsert("\n\n- a\n\n- b\n\n", "- a\n- b");
  assert.equal(prepared, "- a\n- b");
  const nested = prepareMarkdownForEditorInsert("    - child", "  - child");
  assert.equal(nested, "  - child");
});
