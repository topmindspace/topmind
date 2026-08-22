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

/** Placeholder HTML for an empty TipTap document / path reset. */
export const EMPTY_PREVIEW_HTML = "<p></p>";

export function isEmptyPreviewHtml(html: string | null | undefined): boolean {
  const s = String(html || "").trim();
  return !s || s === EMPTY_PREVIEW_HTML;
}

/**
 * Next static-preview HTML for FileEditorView.
 * Path change: always reset (editor still holds the previous document until load).
 * Same path: apply incoming even when empty so frontmatter-only notes do not keep the last body.
 */
export function nextPreviewHtml(
  _prev: string,
  incoming: string | null | undefined,
  opts?: { pathChanged?: boolean },
): string {
  if (opts?.pathChanged) return EMPTY_PREVIEW_HTML;
  const s = String(incoming || "").trim();
  return s || EMPTY_PREVIEW_HTML;
}

/** HTML for static preview surface (styled with .v4-tiptap). */
export function getEditorHtml(editor: Editor | null | undefined): string {
  if (!editor || editor.isDestroyed) return "";
  try {
    const html = editor.getHTML();
    if (html) return html;
  } catch {
    /* TipTap 3 may throw if the view is not mounted yet */
  }
  return "";
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
 *  1. Ensure blank line before headings/quotes when the previous line is prose
 *     (not already a block marker). Do NOT insert blanks between same-type list items.
 *  2. Ensure blank line when switching list types (bullet → ordered or vice-versa)
 *     so the parser creates separate list nodes instead of merging.
 *  3. Collapse extra blank lines between same-type list items (tight lists).
 *  Fenced code (``` / ~~~) is left untouched so list rules cannot rewrite samples.
 */
export function preprocessMarkdownForBlocks(text: string): string {
  const src = String(text || "");
  if (!src) return "";
  const lines = src.split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string[] = [];
  let inFence = false;
  const flushProse = () => {
    if (!prose.length) return;
    out.push(transformMarkdownBlocksChunk(prose.join("\n")));
    prose = [];
  };
  const flushFence = () => {
    if (!fence.length) return;
    out.push(fence.join("\n"));
    fence = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/u.test(line)) {
      if (inFence) {
        fence.push(line);
        flushFence();
        inFence = false;
      } else {
        flushProse();
        fence = [line];
        inFence = true;
      }
      continue;
    }
    if (inFence) fence.push(line);
    else prose.push(line);
  }
  if (inFence) flushFence();
  else flushProse();
  return out.join("\n");
}

function transformMarkdownBlocksChunk(text: string): string {
  let out = text;
  // Heading / quote after prose — not after another block marker
  out = out.replace(
    /^(?!#{1,6}\s|[ \t]*(?:[-*+]\s|\d+\.\s)|>\s)(.+[^\n\s])\n(#{1,6}\s|>\s)/gmu,
    "$1\n\n$2",
  );
  // List after prose — not after an existing list item (including indented children)
  out = out.replace(
    /^(?![ \t]*(?:[-*+]\s|\d+\.\s))(.+[^\n\s])\n([ \t]*(?:[-*+]\s|\d+\.\s))/gmu,
    "$1\n\n$2",
  );
  // Separate different list types (line-start markers only — do not match **bold**)
  out = out.replace(/(^|\n)([-*+]\s.*)\n(\d+\.\s)/gmu, "$1$2\n\n$3");
  out = out.replace(/(^|\n)(\d+\.\s.*)\n([-*+]\s)/gmu, "$1$2\n\n$3");
  // Tight same-type lists: drop extra blank lines between sibling items
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/(^|\n)([-*+]\s.*)\n\n+([ \t]*[-*+]\s)/gmu, "$1$2\n$3");
    out = out.replace(/(^|\n)(\d+\.\s.*)\n\n+([ \t]*\d+\.\s)/gmu, "$1$2\n$3");
  }
  out = out.replace(/\n{3,}/gu, "\n\n");
  return out;
}

/** Match result indent to the source block — strip invented extra indent, restore missing. */
export function alignMarkdownIndent(source: string, result: string): string {
  const srcLines = String(source || "").split("\n").filter((l) => l.trim());
  const resLines = String(result || "").split("\n");
  if (srcLines.length === 0 || resLines.every((l) => !l.trim())) return String(result || "");

  const indentOf = (line: string): string => {
    const m = line.match(/^[ \t]*/u);
    return m ? m[0] : "";
  };
  const minOf = (lines: string[]): string =>
    lines.map(indentOf).reduce((a, b) => (a.length <= b.length ? a : b));

  const minSrc = minOf(srcLines);
  const minRes = minOf(resLines.filter((l) => l.trim()));

  if (minRes === minSrc) return String(result || "");

  if (minRes.length > minSrc.length && minRes.startsWith(minSrc)) {
    const drop = minRes.length - minSrc.length;
    return resLines
      .map((l) => {
        if (!l.trim()) return l;
        const ind = indentOf(l);
        return ind.length >= drop ? l.slice(drop) : l;
      })
      .join("\n");
  }

  if (minSrc.length > minRes.length) {
    const add = minSrc.slice(minRes.length);
    return resLines.map((l) => (l.trim() ? add + l : l)).join("\n");
  }

  return String(result || "");
}

export function prepareMarkdownForEditorInsert(
  raw: string,
  source?: string,
  opts?: { trimLeading?: boolean },
): string {
  let text = String(raw || "").replace(/\n+$/u, "");
  if (opts?.trimLeading !== false) {
    text = text.replace(/^\n+/u, "");
  }
  if (!text.trim()) return "";
  if (source) text = alignMarkdownIndent(source, text);
  return preprocessMarkdownForBlocks(text);
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
  let source = "";
  try {
    source = editor.state.doc.textBetween(from, to, "\n");
  } catch {
    source = "";
  }
  const text = prepareMarkdownForEditorInsert(md, source, { trimLeading: true });
  if (!text) return false;

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
  const text = prepareMarkdownForEditorInsert(md, undefined, { trimLeading: false });
  if (!text) return false;

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
