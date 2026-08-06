/**
 * Stream card Markdown preview — pure transform for feed bodies.
 * Reuses export-markdown fragment converter (single MD→HTML path; no second engine).
 */
import { markdownToHtmlFragment } from "./export-markdown";
import {
  normalizeStreamEscapes,
  splitMainAndAppendChunks,
} from "./stream-period-parse";

/**
 * Strip HTML comments (incl. `<!-- topmind:append ... -->`) so markers
 * do not show as raw noise in the card preview.
 */
export function stripHtmlCommentsForPreview(md: string): string {
  return String(md || "").replace(/<!--[\s\S]*?-->/gu, "").trim();
}

/**
 * Soft-normalize period-note body before MD→HTML:
 * - unescape over-escaped task boxes etc.
 * - strip append markers (comments)
 * - collapse 3+ blank lines to 1 blank (paragraph separation)
 * - pull consecutive list/task items together (blank-between-bullets → single list)
 * - trim trailing spaces on lines (common source of "ugly" extra breaks)
 * never throws on empty/odd input.
 */
export function prepareStreamMarkdown(md: string): string {
  let s = normalizeStreamEscapes(md);
  s = stripHtmlCommentsForPreview(s);
  if (!s) return "";
  s = s.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  // Trim trailing spaces/tabs per line (except intentional 2-space hard-break → keep none for preview)
  s = s.replace(/[ \t]+$/gmu, "");
  // Collapse 3+ blank lines → single blank
  s = s.replace(/\n{3,}/gu, "\n\n");
  // Within list/task runs: remove blank lines that would split one list into many
  // e.g. "- a\n\n- b" → "- a\n- b" (keeps one <ul> in the fragment converter)
  s = s.replace(
    /(^|\n)([ \t]*[-*+](?:\s+\[[ xX]\])?\s+[^\n]+)\n\n+(?=[ \t]*[-*+](?:\s+\[[ xX]\])?\s+)/gmu,
    "$1$2\n",
  );
  s = s.replace(
    /(^|\n)([ \t]*\d+\.\s+[^\n]+)\n\n+(?=[ \t]*\d+\.\s+)/gmu,
    "$1$2\n",
  );
  // Drop a blank line immediately after a heading (common ugly gap)
  s = s.replace(/(^#{1,6}[^\n]+)\n\n+/gmu, "$1\n");
  return s.trim();
}

/**
 * Convert a stream entry body (or rest) to a safe HTML fragment for card preview.
 * Escapes raw HTML in the source via markdownToHtmlFragment.
 */
export function streamMarkdownToPreviewHtml(md: string): string {
  try {
    const cleaned = prepareStreamMarkdown(md);
    if (!cleaned) return "";
    return markdownToHtmlFragment(cleaned);
  } catch {
    // Degraded: never crash Stream cards on bad MD
    const fallback = String(md || "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;");
    return fallback ? `<p>${fallback}</p>` : "";
  }
}

export interface StreamAppendPart {
  /** Heading line without #### (e.g. 续 · 2026-08-03 11:17) */
  title: string;
  /** Full markdown chunk including heading */
  markdown: string;
  /** Body after heading */
  body: string;
}

/**
 * Split feed card MD into primary content + append follow-ups for quiet layout.
 */
export function splitStreamPreviewParts(md: string): {
  main: string;
  appends: StreamAppendPart[];
} {
  const prepared = prepareStreamMarkdown(md);
  if (!prepared) return { main: "", appends: [] };

  const { main, appendChunks } = splitMainAndAppendChunks(prepared);
  const appends: StreamAppendPart[] = appendChunks.map((chunk) => {
    const cleaned = prepareStreamMarkdown(chunk);
    const lines = cleaned.split("\n");
    const first = lines[0] || "";
    const h = first.match(/^#{1,4}\s+(.+)$/u);
    const title = h ? h[1].trim() : first.replace(/^#{1,4}\s*/u, "").trim() || "续";
    const body = lines.slice(1).join("\n").trim();
    return { title, markdown: cleaned, body };
  });

  return { main: main.trim(), appends };
}

/**
 * Whether the body looks like it benefits from MD rendering (vs plain one-liner).
 * Always true for multi-line or common MD tokens; short plain text still safe to run through fragment.
 */
export function prefersMarkdownPreview(md: string): boolean {
  const s = String(md || "").trim();
  if (!s) return false;
  if (s.includes("\n")) return true;
  return /[*_`#\[\]]|https?:\/\//u.test(s) || /^\s*[-*+]\s+/u.test(s);
}

/**
 * Strip leading list bullet + optional timestamp for compact single-bullet card title line.
 * Used when the whole card is one list item (time chip lives in card chrome).
 * Does NOT strip task checkboxes — keep `- [ ]` so MD→HTML renders a real checkbox.
 */
export function stripListChromeForDisplay(md: string): string {
  const s = prepareStreamMarkdown(md);
  const lines = s.split("\n");
  if (lines.length === 0) return s;
  let first = lines[0];
  // Task list: keep full line so task-list HTML works
  if (/^\s*[-*+]\s+\[[ xX]\]/u.test(first)) {
    return s;
  }
  first = first
    .replace(/^\s*[-*+]\s+/u, "")
    .replace(/^\s*\d+\.\s+/u, "")
    // Timestamp is shown as a quiet chip in the card header
    .replace(/^\d{1,2}:\d{2}\s+/u, "")
    .trim();
  return [first, ...lines.slice(1)].join("\n").trim();
}
