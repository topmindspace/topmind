/**
 * Shared period-note parsing for StreamView (sidebar) and StreamDetailView (canvas).
 * Split by `## ` headings; skip pure structural shells; surface real content always.
 *
 * Day sections soft-split into per-bullet cards so the feed reads as a quiet stream
 * of moments (not one dense multi-bullet blob per day).
 */

export interface StreamEntry {
  heading: string;
  body: string;
  sortKey: string;
  preview: string;
  rest: string;
  /** True when body is primarily a #### 续 / topmind:append follow-up. */
  isAppend?: boolean;
  /** 0-based inclusive line index in the original markdown (including frontmatter). */
  startLine?: number;
  /** 0-based exclusive end line index in the original markdown. */
  endLine?: number;
  /** First-line fingerprint used to verify append windows. */
  anchorText?: string;
  /**
   * Follow-ups that belong to this post (indented timed replies or #### 续).
   * Kept in file order; never reversed with the parent post.
   */
  replies?: StreamEntry[];
}

export interface StreamDayGroup {
  /** Display label for sticky day header */
  dayLabel: string;
  /** Stable key for React lists */
  dayKey: string;
  entries: Array<StreamEntry & { index: number }>;
}

/** Structural section titles that are scaffolds, not content cards by themselves */
export const STRUCTURAL_HEADINGS = new Set([
  "进行中",
  "记录",
  "In progress",
  "In Progress",
  "Notes",
  "Log",
  "日志",
]);

/**
 * Count real 增补 blocks in a stream entry body.
 *
 * Heading-block `formatAppendBlock` emits BOTH a marker and `#### 续`.
 * Nested-list replies emit only the marker. Counting both families would
 * double-count heading-block appends (1 append → badge "2 续").
 *
 * Prefer machine markers only; fall back to `#### 续` headings for legacy
 * bodies that lack the HTML comment.
 */
export function countStreamAppends(body: string): number {
  const text = String(body || "");
  if (!text) return 0;
  const markers = text.match(/<!--\s*topmind:append\b/giu);
  if (markers && markers.length > 0) return markers.length;
  // Legacy human-only headings (no machine marker present).
  // No \b after 续 — CJK is non-word so \b would never match.
  const heads = text.match(/^#{2,4}\s*续(?=\s|[·•.]|$)/gmu);
  return heads ? heads.length : 0;
}

/** Kernel 增补 chrome: HTML marker or `#### 续` heading. */
export function isStreamAppendChromeLine(line: string): boolean {
  const s = String(line || "").trim();
  if (!s) return false;
  if (/^<!--\s*topmind:append\b/iu.test(s)) return true;
  return /^#{2,4}\s*续(?=\s|[·•.]|$)/u.test(s);
}

/** Nested (or any) list item whose text starts with HH:MM. */
export function isTimedListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+\d{1,2}:\d{2}\b/u.test(String(line || ""));
}

/**
 * Unescape common over-escaped MD tokens seen in period notes
 * (display-only prep for feed cards — does not rewrite the file).
 *
 * Handles:
 * - `\[ \]` / `\[x\]` → task checkboxes
 * - line-start `\-` / `\*` / `\+` → list markers (paste/export noise)
 * - line-start `\#` → heading markers
 */
export function normalizeStreamEscapes(md: string): string {
  let s = String(md || "");
  // Task checkboxes written as \[ \] / \[x\]
  s = s.replace(/\\\[([ xX]?)\\\]/gu, "[$1]");
  // Escaped list bullets at line start (optional indent)
  s = s.replace(/^(\s*)\\([-*+])(\s+)/gmu, "$1$2$3");
  // Escaped ATX headings at line start
  s = s.replace(/^(\s*)\\(#{1,6})(\s+)/gmu, "$1$2$3");
  return s;
}

/** Day-like ## headings → soft-split bullets into individual feed cards. */
export function isDayLikeHeading(heading: string): boolean {
  const h = String(heading || "").trim();
  if (!h) return false;
  if (/^\d{2}-\d{2}\b/u.test(h)) return true;
  if (/\d{4}-\d{2}-\d{2}/u.test(h)) return true;
  if (/\d{1,2}月\d{1,2}日/u.test(h)) return true;
  return false;
}

/**
 * Indent of a markdown list marker in spaces (tabs count as 2), or -1.
 * Used so nested items are not treated as new feed cards.
 */
export function listMarkerIndent(line: string): number {
  const m = String(line || "").match(/^(\s*)(?:[-*+]|\d+\.)\s+\S/u);
  if (!m) return -1;
  return m[1].replace(/\t/gu, "  ").length;
}

/** Top-level markdown list item (`-` / `*` / `+` / `1.`), not indented nested lists. */
export function isTopLevelListItem(line: string): boolean {
  const indent = listMarkerIndent(line);
  return indent >= 0 && indent <= 3;
}

export type LineRange = { start: number; end: number };

/**
 * First-level list ranges in `lines[from, to)`.
 * Nested items stay on the parent. `#### 续` / append chrome between items
 * stays on the preceding item (do not peel them out of the day first).
 */
export function splitFirstLevelListItemRanges(
  lines: string[],
  from = 0,
  to = lines.length,
): LineRange[] {
  const out: LineRange[] = [];
  let bufStart = -1;
  let baseIndent: number | null = null;

  const flush = (end: number) => {
    if (bufStart < 0 || end <= bufStart) {
      bufStart = -1;
      return;
    }
    let s = bufStart;
    let e = end;
    while (s < e && !lines[s].trim()) s += 1;
    while (e > s && !lines[e - 1].trim()) e -= 1;
    if (e > s) out.push({ start: s, end: e });
    bufStart = -1;
  };

  for (let i = from; i < to; i++) {
    const indent = listMarkerIndent(lines[i]);
    if (indent >= 0 && (baseIndent === null || indent <= baseIndent)) {
      if (baseIndent === null || indent < baseIndent) baseIndent = indent;
      if (indent === baseIndent) {
        // Untimed sibling after 续 chrome is the append body (list/task), not a new 记下.
        // Timed `- HH:MM` after 续 is a later 记下 and must start a new post.
        if (bufStart >= 0 && !isTimedListLine(lines[i])) {
          let sawChrome = false;
          for (let k = bufStart; k < i; k++) {
            if (isStreamAppendChromeLine(lines[k])) {
              sawChrome = true;
              break;
            }
          }
          if (sawChrome) continue;
        }
        flush(i);
        bufStart = i;
        continue;
      }
    }
    if (bufStart >= 0) continue;
    if (lines[i].trim()) bufStart = i;
  }
  flush(to);
  return out;
}

/**
 * Split a list-led block into **first-level** items only.
 * Nested list lines (greater indent than the first item) stay on the parent card.
 */
export function splitFirstLevelListItems(content: string): string[] {
  const lines = String(content || "").replace(/\r\n/gu, "\n").split("\n");
  return splitFirstLevelListItemRanges(lines, 0, lines.length).map((r) =>
    lines.slice(r.start, r.end).join("\n").replace(/^\n+|\n+$/gu, ""),
  );
}

/**
 * Whether a day/section should soft-split into per-item posts.
 * Skips blanks, HTML comments, and ATX headings so a `# Title` above a list
 * still counts as list-led. Prose-first sections stay one post (embedded
 * lists render as lists in preview — they are not extra cards).
 */
export function firstSubstantialLineIsList(md: string): boolean {
  const text = normalizeStreamEscapes(md).replace(/\r\n/gu, "\n");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^<!--/u.test(t)) continue;
    if (/^#{1,6}\s/u.test(t)) continue;
    return isTopLevelListItem(line);
  }
  return false;
}

/** Drop leading ATX headings / blanks so list-led split does not emit a title-only card. */
export function stripLeadingAtxHeadings(md: string): string {
  const lines = String(md || "").replace(/\r\n/gu, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t || /^#{1,6}\s/u.test(t) || /^<!--/u.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

/**
 * Split period body into main content + append chunks (#### 续 / topmind:append).
 * Each append chunk keeps its heading line for MD preview.
 */
export function splitMainAndAppendChunks(md: string): {
  main: string;
  appendChunks: string[];
} {
  const text = normalizeStreamEscapes(md).replace(/\r\n/gu, "\n");
  if (!text.trim()) return { main: "", appendChunks: [] };

  // Split before each append marker or #### 续 heading (keep delimiter)
  const parts = text.split(
    /(?=^<!--\s*topmind:append\b)|(?=^#{2,4}\s*续(?=\s|[·•.]|$))/gmu,
  );
  if (parts.length <= 1) {
    return { main: text.trim(), appendChunks: [] };
  }

  const main = (parts[0] || "").trim();
  const appendChunks: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = (parts[i] || "").trim();
    if (chunk) appendChunks.push(chunk);
  }
  return { main, appendChunks };
}

function frontmatterStartLine(markdown: string): { body: string; startLine: number } {
  const fmMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  if (!fmMatch) return { body: markdown, startLine: 0 };
  const startLine = (fmMatch[0].match(/\n/g) || []).length;
  return { body: markdown.slice(fmMatch[0].length), startLine };
}

function makeEntry(
  heading: string,
  content: string,
  opts?: { isAppend?: boolean; startLine?: number; endLine?: number },
): StreamEntry | null {
  const body = normalizeStreamEscapes(content).trim();
  if (!heading && !body) return null;
  const lines = body.split("\n").filter((l) => l.trim());
  const firstLine = lines[0] || body || heading;
  const preview = firstLine
    .replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/u, "")
    .replace(/^\d{1,2}:\d{2}\s*/u, "")
    .replace(/^#{1,4}\s*续\s*[·•.]?\s*/u, "")
    .trim();
  const rest = lines.slice(1).join("\n").trim();
  const isAppend =
    opts?.isAppend === true
    || (countStreamAppends(body) > 0 && !/^\s*[-*+]\s/u.test(body));
  return {
    heading,
    body,
    sortKey: heading || body.slice(0, 20),
    preview: preview || heading || body.slice(0, 80),
    rest,
    isAppend,
    startLine: opts?.startLine,
    endLine: opts?.endLine,
    anchorText: preview || heading || body.slice(0, 80),
  };
}

function lastBoundIsOpenChrome(lines: string[], bounds: number[], i: number): boolean {
  if (bounds.length === 0) return false;
  const prev = bounds[bounds.length - 1]!;
  if (!isStreamAppendChromeLine(lines[prev])) return false;
  for (let k = prev + 1; k < i; k++) {
    if (lines[k].trim() && !isStreamAppendChromeLine(lines[k])) return false;
  }
  return true;
}

function chunkIsAppendLed(lines: string[]): boolean {
  for (const line of lines) {
    if (!line.trim()) continue;
    return isStreamAppendChromeLine(line);
  }
  return false;
}

/**
 * Reply starts: append chrome, or nested timed list items under a parent bullet.
 * Untimed nested lists stay in the parent body (user outlines, not comments).
 */
function findReplyBoundaries(lines: string[], opts?: { chromeOnly?: boolean }): number[] {
  if (lines.length === 0) return [];
  const bounds: number[] = [];
  if (chunkIsAppendLed(lines)) bounds.push(0);

  const baseIndent = listMarkerIndent(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    if (isStreamAppendChromeLine(lines[i])) {
      if (lastBoundIsOpenChrome(lines, bounds, i)) continue;
      bounds.push(i);
      continue;
    }
    if (opts?.chromeOnly) continue;
    if (baseIndent >= 0 && isTimedListLine(lines[i])) {
      const indent = listMarkerIndent(lines[i]);
      if (indent > baseIndent) {
        if (lastBoundIsOpenChrome(lines, bounds, i)) continue;
        bounds.push(i);
      }
    }
  }
  return bounds;
}

function splitPostAndReplies(
  heading: string,
  chunkLines: string[],
  absStart: number,
  opts?: { chromeOnly?: boolean },
): { post: StreamEntry | null; replies: StreamEntry[] } {
  if (chunkLines.length === 0) return { post: null, replies: [] };
  const bounds = findReplyBoundaries(chunkLines, opts);
  const wholeEnd = absStart + chunkLines.length;

  const replyFrom = (rs: number, re: number): StreamEntry | null => {
    const text = chunkLines.slice(rs, re).join("\n").trim();
    if (!text) return null;
    return makeEntry(heading, text, {
      isAppend: true,
      startLine: absStart + rs,
      endLine: absStart + re,
    });
  };

  if (bounds.length === 0) {
    const post = makeEntry(heading, chunkLines.join("\n"), {
      startLine: absStart,
      endLine: wholeEnd,
    });
    return { post, replies: [] };
  }

  const replies: StreamEntry[] = [];
  for (let b = 0; b < bounds.length; b++) {
    const rs = bounds[b]!;
    const re = b + 1 < bounds.length ? bounds[b + 1]! : chunkLines.length;
    const reply = replyFrom(rs, re);
    if (reply) replies.push(reply);
  }

  const mainEnd = bounds[0]!;
  let mainLines = chunkLines.slice(0, mainEnd);
  while (mainLines.length && !mainLines[mainLines.length - 1]!.trim()) {
    mainLines = mainLines.slice(0, -1);
  }
  const mainText = mainLines.join("\n").trim();
  if (!mainText) {
    return { post: replies[0] ?? null, replies: replies.slice(1) };
  }

  const post = makeEntry(heading, mainText, {
    startLine: absStart,
    endLine: wholeEnd,
  });
  return { post, replies };
}

function skipLeadingChrome(lines: string[], from: number, to: number): number {
  let i = from;
  while (i < to) {
    const t = lines[i].trim();
    if (!t) {
      i += 1;
      continue;
    }
    if (isStreamAppendChromeLine(lines[i])) break;
    if (/^<!--/u.test(t) || /^#{1,6}\s/u.test(t)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function postsFromSection(
  heading: string,
  lines: string[],
  start: number,
  end: number,
  abs: (i: number) => number,
): StreamEntry[] {
  const content = lines.slice(start, end).join("\n");
  if (!content.trim()) return [];

  const pushSplit = (from: number, to: number, cap: number): StreamEntry[] => {
    const out: StreamEntry[] = [];
    // Structure scan is display-only unescape (line count unchanged); bodies still
    // come from original lines so makeEntry can normalize for preview.
    const structural = lines.map((l) => normalizeStreamEscapes(l));
    const ranges = splitFirstLevelListItemRanges(structural, from, to);
    for (const range of ranges) {
      if (out.length >= cap) break;
      const chunk = lines.slice(range.start, range.end);
      const { post, replies } = splitPostAndReplies(heading, chunk, abs(range.start));
      if (!post) continue;
      post.replies = replies;
      out.push(post);
    }
    return out;
  };

  if (firstSubstantialLineIsList(content)) {
    const i = skipLeadingChrome(lines, start, end);
    return pushSplit(i, end, 40);
  }

  // Prose-first (or named article): one post; trailing 续 become replies.
  const { post, replies } = splitPostAndReplies(heading, lines.slice(start, end), abs(start));
  if (!post) return [];
  post.replies = replies;
  return [post];
}

/**
 * Soft-split a day (or loose) section into per-bullet posts with nested replies.
 * Line offsets are relative to `content` unless `lineOffset` is passed.
 */
export function softSplitContentEntries(
  sectionHeading: string,
  content: string,
  lineOffset = 0,
): StreamEntry[] {
  const lines = String(content || "").replace(/\r\n/gu, "\n").split("\n");
  return postsFromSection(sectionHeading, lines, 0, lines.length, (i) => lineOffset + i);
}

/**
 * Parse period note markdown into entries (newest-first **posts**).
 * Replies stay nested on each post in file order — never reversed away from the parent.
 * - CRLF-safe frontmatter
 * - Day / structural sections: first-level list items, 续 attached to the preceding item
 * - Named non-day ## → one 文章卡 (trailing 续 as replies)
 */
export function parsePeriodNote(markdown: string): StreamEntry[] {
  const normalized = String(markdown || "").replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const { body, startLine: bodyStart } = frontmatterStartLine(normalized);
  const lines = body.split("\n");
  if (!body.trim()) return [];

  const headingLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^## (.+)$/u.test(lines[i])) headingLines.push(i);
  }

  type Section = { heading: string; start: number; end: number };
  const sections: Section[] = [];
  if (headingLines.length === 0) {
    sections.push({ heading: "", start: 0, end: lines.length });
  } else {
    if (headingLines[0]! > 0) {
      sections.push({ heading: "", start: 0, end: headingLines[0]! });
    }
    for (let h = 0; h < headingLines.length; h++) {
      const idx = headingLines[h]!;
      const heading = lines[idx].replace(/^##\s+/u, "").trim();
      const start = idx + 1;
      const end = h + 1 < headingLines.length ? headingLines[h + 1]! : lines.length;
      sections.push({ heading, start, end });
    }
  }

  const abs = (i: number) => bodyStart + i;
  const days: StreamEntry[][] = [];
  for (const sec of sections) {
    if (!sec.heading && !lines.slice(sec.start, sec.end).some((l) => l.trim())) continue;
    const namedArticle =
      Boolean(sec.heading)
      && !STRUCTURAL_HEADINGS.has(sec.heading)
      && !isDayLikeHeading(sec.heading);
    if (namedArticle) {
      const { post, replies } = splitPostAndReplies(
        sec.heading,
        lines.slice(sec.start, sec.end),
        abs(sec.start),
        { chromeOnly: true },
      );
      days.push(post ? [{ ...post, replies }] : []);
      continue;
    }
    days.push(postsFromSection(sec.heading, lines, sec.start, sec.end, abs));
  }

  const out: StreamEntry[] = [];
  for (let d = days.length - 1; d >= 0; d--) {
    const posts = days[d]!;
    for (let p = posts.length - 1; p >= 0; p--) out.push(posts[p]!);
  }
  return out;
}

/** Short time/date label from heading */
export function extractTimeLabel(heading: string): string | null {
  if (!heading) return null;
  const iso = heading.match(/\d{4}-\d{2}-\d{2}/u);
  if (iso) return iso[0];
  const cn = heading.match(/\d{1,2}月\d{1,2}日/u);
  if (cn) return cn[0];
  const daySection = heading.match(/^(\d{2}-\d{2})/u);
  if (daySection) return daySection[1];
  const time = heading.match(/\d{1,2}:\d{2}/u);
  if (time) return time[0];
  return heading.slice(0, 20);
}

/** Timestamp from first bullet line (or plain line start). Skips append chrome. */
export function extractBodyTimestamp(body: string): string | null {
  const text = normalizeStreamEscapes(body);
  for (const line of text.split("\n")) {
    if (!line.trim() || isStreamAppendChromeLine(line)) continue;
    const match = line.match(/^\s*[-*]\s+(\d{1,2}:\d{2})/u)
      || line.match(/^\s*(\d{1,2}:\d{2})\b/u);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Day key for grouping. Prefers full ISO date, then MM-DD, then Chinese, else "other".
 */
export function dayKeyFromEntry(entry: StreamEntry): { dayKey: string; dayLabel: string } {
  const h = entry.heading || "";
  const iso = h.match(/(\d{4}-\d{2}-\d{2})/u);
  if (iso) return { dayKey: iso[1], dayLabel: iso[1] };

  const cn = h.match(/(\d{1,2})月(\d{1,2})日/u);
  if (cn) {
    const label = `${cn[1]}月${cn[2]}日`;
    return { dayKey: `cn-${cn[1]}-${cn[2]}`, dayLabel: label };
  }

  const md = h.match(/^(\d{2}-\d{2})\b/u);
  if (md) {
    const rest = h.replace(/^\d{2}-\d{2}\s*/u, "").trim();
    const dayLabel = rest && rest.length < 12 ? `${md[1]} ${rest}` : md[1];
    return { dayKey: `md-${md[1]}`, dayLabel };
  }

  // Structural soft-entries (记录/进行中) group under their heading label
  if (h && STRUCTURAL_HEADINGS.has(h)) {
    return { dayKey: `struct-${h}`, dayLabel: h };
  }

  return { dayKey: "other", dayLabel: "" };
}

/**
 * Group newest-first entries into day sections (order preserved).
 * `otherLabel` used when day cannot be inferred (i18n).
 */
export function groupEntriesByDay(
  entries: StreamEntry[],
  otherLabel = "其他",
): StreamDayGroup[] {
  const groups: StreamDayGroup[] = [];
  const indexByKey = new Map<string, number>();

  entries.forEach((entry, index) => {
    const { dayKey, dayLabel } = dayKeyFromEntry(entry);
    const label = dayLabel || otherLabel;
    let gi = indexByKey.get(dayKey);
    if (gi === undefined) {
      gi = groups.length;
      indexByKey.set(dayKey, gi);
      groups.push({ dayKey, dayLabel: label, entries: [] });
    }
    groups[gi].entries.push({ ...entry, index });
  });

  return groups;
}
