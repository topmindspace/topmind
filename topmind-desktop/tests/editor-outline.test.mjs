/**
 * editor-outline.test.mjs — 验证 Markdown 大纲抽屉与动态流自适应 UX。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("EditorOutlinePanel & StreamDetailView UX enhancements", () => {
  it("EditorOutlinePanel source contains code block defense and scrollspy", () => {
    const src = fs.readFileSync(
      path.join(root, "src/components/editor/EditorOutlinePanel.tsx"),
      "utf8",
    );
    // Export and component integrity
    assert.match(src, /export function EditorOutlinePanel/);
    assert.match(src, /export function extractHeadings/);
    assert.match(src, /export function cleanHeadingText/);
    // Code block defense
    assert.match(src, /inCodeBlock/);
    assert.match(src, /trimmed\.startsWith\("```"\)/);
    // Scrollspy
    assert.match(src, /scrollContainer/);
    assert.match(src, /requestAnimationFrame/);
    // Real-time synchronization
    assert.match(src, /editor\.on\("update",/);
    assert.match(src, /editorVersion/);
    // Escape key
    assert.match(src, /e\.key === "Escape"/);
  });

  it("FileEditorView wires outline with ⌘⌥O shortcut and toolbar button", () => {
    const editor = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/views/FileEditorView.tsx"),
      "utf8",
    );
    assert.match(editor, /EditorOutlinePanel/);
    assert.match(editor, /showOutline/);
    assert.match(editor, /e\.altKey && e\.key\.toLowerCase\(\) === "o"/);
  });

  it("StreamDetailView implements auto-grow composer, append shortcuts and thread branch line", () => {
    const stream = fs.readFileSync(
      path.join(root, "src/plugins/topmind-workspace/views/StreamDetailView.tsx"),
      "utf8",
    );
    // Auto grow
    assert.match(stream, /el\.style\.height = "auto"/);
    assert.match(stream, /resize-none min-h-\[48px\]/);
    // Append textarea shortcuts (Cmd/Ctrl+Enter submit and Escape cancel)
    assert.match(stream, /onAppendSubmit/);
    assert.match(stream, /onAppendCancel/);
    // Thread branch line
    assert.match(stream, /-left-3 top-2\.5 h-px w-2/);
    // Floating back to top button
    assert.match(stream, /showBackToTop/);
    assert.match(stream, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  });
});
