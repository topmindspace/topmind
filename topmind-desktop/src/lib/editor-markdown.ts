/**
 * TipTap + tiptap-markdown helpers — load/save body without frontmatter YAML.
 *
 * Important: tiptap-markdown **overrides** `commands.setContent` to always run
 * `parser.parse(content)`. Passing an already-parsed doc would double-parse and
 * collapse formatting — always pass a Markdown **string**.
 *
 * Relative images: use mediaUrlsForEditor / mediaUrlsForDisk with note path
 * so the editor can load topmind-asset:// while disk stays relative.
 */
import type { Editor } from "@tiptap/react";
import { mediaUrlsForDisk, mediaUrlsForEditor } from "./editor-media";

type MarkdownStorage = {
  markdown?: {
    getMarkdown: () => string;
  };
};

/** Set editor document from Markdown source (string only — never pre-parsed JSON). */
export function setEditorMarkdown(
  editor: Editor | null | undefined,
  md: string,
  opts?: { noteRelativePath?: string },
): void {
  if (!editor) return;
  let body = typeof md === "string" ? md : "";
  if (opts?.noteRelativePath) {
    body = mediaUrlsForEditor(body, opts.noteRelativePath);
  }
  // Markdown extension intercepts setContent and runs parser.parse(string)
  editor.commands.setContent(body, { emitUpdate: false });
}

/** Serialize editor body to Markdown (falls back to plain text). */
export function getEditorMarkdown(
  editor: Editor | null | undefined,
  opts?: { noteRelativePath?: string },
): string {
  if (!editor || editor.isDestroyed) return "";
  const storage = editor.storage as MarkdownStorage;
  let md = "";
  try {
    if (storage.markdown?.getMarkdown) md = storage.markdown.getMarkdown() || "";
  } catch {
    /* */
  }
  if (!md) {
    try {
      md = editor.getText() || "";
    } catch {
      md = "";
    }
  }
  if (opts?.noteRelativePath) {
    md = mediaUrlsForDisk(md, opts.noteRelativePath);
  }
  return md;
}

/** HTML for static preview surface (styled with .v4-tiptap). */
export function getEditorHtml(editor: Editor | null | undefined): string {
  if (!editor || editor.isDestroyed) return "";
  try {
    // TipTap 3 may throw if view not mounted yet
    if (!editor.view) return "";
  } catch {
    return "";
  }
  try {
    return editor.getHTML() || "";
  } catch {
    return "";
  }
}

type MarkdownParserStorage = {
  markdown?: {
    parser?: {
      parse: (content: string, opts?: { inline?: boolean }) => string;
    };
  };
};

/**
 * Replace a ProseMirror range with Markdown (via tiptap-markdown parser → HTML).
 * Used by selection AI rewrite so lists / emphasis survive the replace.
 *
 * Format preservation rules:
 * - Inline content (no block markers) → parsed inline, no extra paragraph boundaries
 * - Block content → parsed as block, but empty leading/trailing paragraphs stripped
 * - Selection inside a list item → content inherits list context
 */
export function replaceSelectionWithMarkdown(
  editor: Editor | null | undefined,
  from: number,
  to: number,
  md: string,
): boolean {
  if (!editor || from > to) return false;
  // Trim leading/trailing whitespace that causes extra blank lines
  const text = String(md || "").replace(/^\n+/, "").replace(/\n+$/, "");
  if (!text) return false;

  const storage = editor.storage as MarkdownParserStorage;
  let content: string = text;
  try {
    const parse = storage.markdown?.parser?.parse;
    if (typeof parse === "function") {
      // Multi-block markers → full block parse; otherwise keep inline for mid-paragraph
      const looksBlock =
        /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/mu.test(text) || /\n\s*\n/u.test(text);
      content = parse(text, { inline: !looksBlock });
      // Strip empty paragraphs that cause extra blank lines
      content = content.replace(/^<p>\s*<\/p>/giu, "").replace(/<p>\s*<\/p>$/giu, "");
    }
  } catch {
    content = text;
  }

  return editor
    .chain()
    .focus()
    .insertContentAt({ from, to }, content)
    .run();
}

/** Insert Markdown at current selection (or caret). */
export function insertMarkdown(
  editor: Editor | null | undefined,
  md: string,
): boolean {
  if (!editor) return false;
  const { from, to } = editor.state.selection;
  return replaceSelectionWithMarkdown(editor, from, to, md);
}

/** Insert Markdown at a specific position (does not replace existing content). */
export function insertMarkdownAt(
  editor: Editor | null | undefined,
  md: string,
  pos: number,
): boolean {
  if (!editor || editor.isDestroyed) return false;
  const text = String(md || "");
  if (!text) return false;

  const storage = editor.storage as MarkdownParserStorage;
  let content: string = text;
  try {
    const parse = storage.markdown?.parser?.parse;
    if (typeof parse === "function") {
      const looksBlock =
        /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/mu.test(text) || /\n\s*\n/u.test(text);
      content = parse(text, { inline: !looksBlock });
    }
  } catch {
    content = text;
  }

  const docSize = editor.state.doc.content.size;
  const safePos = Math.max(0, Math.min(pos, docSize));
  return editor
    .chain()
    .focus()
    .insertContentAt(safePos, content)
    .run();
}

export type EditorContentWidth = "compact" | "reading" | "wide" | "full";

export const EDITOR_CONTENT_WIDTHS: { value: EditorContentWidth; labelKey: string; hintKey: string }[] = [
  { value: "compact", labelKey: "readingMenu.widthCompact", hintKey: "readingMenu.widthCompactHint" },
  { value: "reading", labelKey: "readingMenu.widthReading", hintKey: "readingMenu.widthReadingHint" },
  { value: "wide", labelKey: "readingMenu.widthWide", hintKey: "readingMenu.widthWideHint" },
  { value: "full", labelKey: "readingMenu.widthFull", hintKey: "readingMenu.widthFullHint" },
];

export function normalizeContentWidth(value: unknown): EditorContentWidth {
  if (value === "compact" || value === "reading" || value === "wide" || value === "full") {
    return value;
  }
  return "reading";
}
