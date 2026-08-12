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
 * - normalize tabs to 2 spaces (common source of misaligned indent)
 * - protect code blocks (skip normalization inside ``` fences)
 * - collapse 3+ blank lines to 1 blank (paragraph separation)
 * - trim trailing spaces on lines (common source of "ugly" extra breaks)
 * - drop blank lines immediately after headings
 * - normalize excessive heading levels (#####+ → ###)
 *
 * List-item blank-line compression:
 * - Blank lines before list items are compressed (\n\n+ → \n) to prevent extra paragraph spacing
 * - Consecutive list items stay in the same <ul> regardless of blank lines between them
 *
 * NOT done (preserved as user wrote):
 * - Alternative bullet markers (– —) — preserved as user wrote
 * - Paragraph spacing (user controls their own rhythm)
 *
 * never throws on empty/odd input.
 */
export function prepareStreamMarkdown(md: string): string {
  let s = normalizeStreamEscapes(md);
  s = stripHtmlCommentsForPreview(s);
  if (!s) return "";
  s = s.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  // Per-line normalizations (outside code blocks only)
  s = normalizeLinesOutsideCodeBlocks(s);
  // Trim trailing spaces/tabs per line (except intentional 2-space hard-break → keep none for preview)
  s = s.replace(/[ \t]+$/gmu, "");
  // Collapse 3+ blank lines → single blank (preserve user's paragraph breaks)
  s = s.replace(/\n{3,}/gu, "\n\n");
  // Drop a blank line immediately after a heading (common ugly gap)
  s = s.replace(/(^#{1,6}[^\n]+)\n\n+/gmu, "$1\n");
  // Drop blank lines immediately before list items (prevents extra paragraph spacing)
  s = s.replace(/\n\n+([-*+]\s)/gu, "\n$1");
  s = s.replace(/\n\n+(\d+\.\s)/gu, "\n$1");
  return s.trim();
}

/**
 * Per-line normalizations outside fenced code blocks:
 * - Tab → 2 spaces (common source of misaligned indent)
 * - Excessive heading levels: #####+ → ###
 *
 * NOT normalized (preserved as user wrote):
 * - Alternative bullet markers (– — *) — user may intentionally use these
 * Lines inside ``` fences are preserved as-is.
 */
function normalizeLinesOutsideCodeBlocks(s: string): string {
  const lines = s.split("\n");
  let inFence = false;
  const result: string[] = [];
  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (inFence) {
      result.push(line);
      continue;
    }
    // Tab → 2 spaces
    let transformed = line.replace(/\t/gu, "  ");
    // Excessive heading levels: #####+ → ###
    transformed = transformed.replace(/^(#{5,})\s+/u, "### ");
    result.push(transformed);
  }
  return result.join("\n");
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
