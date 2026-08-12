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
 * Pre-process Markdown before parsing to prevent common formatting issues:
 *  1. Ensure blank line before block-level markers (headings, lists, quotes)
 *     when preceded by non-empty content. Without this, single `\n` before a
 *     list marker can be parsed as a hard break (`<br>`) inside a paragraph
 *     instead of starting a new block — especially with tiptap-markdown `breaks: true`.
 *  2. Ensure blank line when switching list types (bullet → ordered or vice-versa)
 *     so the parser creates separate list nodes instead of merging.
 *  3. Normalize consecutive blank lines within list blocks (max one blank line).
 */
function preprocessMarkdownForBlocks(text: string): string {
  let out = text;
  // Add blank line before block markers when missing (not at start of text)
  out = out.replace(/([^\n\s])\n(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/gu, "$1\n\n$2");
  // Ensure separation when switching between bullet and ordered list markers
  // e.g. "- item\n1. item" → "- item\n\n1. item"
  out = out.replace(/([-*+]\s.*)\n(\d+\.\s)/gu, "$1\n\n$2");
  out = out.replace(/(\d+\.\s.*)\n([-*+]\s)/gu, "$1\n\n$2");
  // Collapse 3+ blank lines to 2 (preserve one blank line between blocks)
  out = out.replace(/\n{3,}/gu, "\n\n");
  return out;
}

/**
 * Strip empty paragraphs and stray `<br>` tags from boundaries of parsed HTML.
 * tiptap-markdown with `breaks: true` can inject `<br>` at block boundaries
 * which creates visible empty lines in the editor.
 */
function cleanupParsedHtml(html: string): string {
  return html
    // Strip ALL leading/trailing empty paragraphs (including those with only <br>)
    .replace(/^(?:<p>\s*(?:<br\s*\/??>)?\s*<\/p>\s*)+/giu, "")
    .replace(/(?:\s*<p>\s*(?:<br\s*\/??>)?\s*<\/p>)+$/giu, "")
    // Strip leading/trailing <br> tags that create phantom empty lines
    .replace(/^(?:<br\s*\/??>\s*)+/giu, "")
    .replace(/(?:\s*<br\s*\/??>)+$/giu, "")
    // Collapse multiple consecutive <br> to one (within inline content)
    .replace(/(<br\s*\/??>)\s*(<br\s*\/??>)+/giu, "$1")
    .trim();
}

/**
 * Replace a ProseMirror range with Markdown (via tiptap-markdown parser → HTML).
 * Used by selection AI rewrite so lists / emphasis survive the replace.
 *
 * Format preservation rules:
 * - Inline content (no block markers) → parsed inline, no extra paragraph boundaries
 * - Block content → parsed as block, but empty leading/trailing paragraphs stripped
 * - Selection inside a list item → content inherits list context
 * - Nested lists (unordered with ordered children) → preserve indentation and marker types
 * - All leading/trailing empty paragraphs are stripped (not just one)
 * - List markers (- * + 1.) are detected even when indented (nested)
 * - Block markers get proper blank-line spacing via pre-processing
 * - Stray <br> tags at boundaries are cleaned
 */
export function replaceSelectionWithMarkdown(
  editor: Editor | null | undefined,
  from: number,
  to: number,
  md: string,
): boolean {
  if (!editor || from > to) return false;
  // Trim leading/trailing whitespace that causes extra blank lines
  const raw = String(md || "").replace(/^\n+/, "").replace(/\n+$/, "");
  if (!raw) return false;

  // Pre-process: ensure proper spacing before block elements
  const text = preprocessMarkdownForBlocks(raw);

  const storage = editor.storage as MarkdownParserStorage;
  let content: string = text;
  try {
    const parse = storage.markdown?.parser?.parse;
    if (typeof parse === "function") {
      // Multi-block markers → full block parse; otherwise keep inline for mid-paragraph
      // Detect block content including indented (nested) list markers
      const looksBlock =
        /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\s{2,}[-*+]\s|\s{2,}\d+\.\s)/mu.test(text) || /\n\s*\n/u.test(text);
      content = parse(text, { inline: !looksBlock });
      content = cleanupParsedHtml(content);
      // If content became empty after stripping, return false (no-op)
      if (!content) return false;
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
  const raw = String(md || "");
  if (!raw) return false;

  // Pre-process: ensure proper spacing before block elements
  const text = preprocessMarkdownForBlocks(raw);

  const storage = editor.storage as MarkdownParserStorage;
  let content: string = text;
  try {
    const parse = storage.markdown?.parser?.parse;
    if (typeof parse === "function") {
      // Detect block content including indented (nested) list markers
      const looksBlock =
        /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\s{2,}[-*+]\s|\s{2,}\d+\.\s)/mu.test(text) || /\n\s*\n/u.test(text);
      content = parse(text, { inline: !looksBlock });
      content = cleanupParsedHtml(content);
      if (!content) return false;
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
