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
 * Shipped `formatAppendBlock` always emits BOTH:
 *   `<!-- topmind:append ... -->`  AND  `#### 续 · …`
 * Counting both would double-count (1 append → badge "2 续").
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

/** Top-level markdown list item (`-` / `*` / `+` / `1.`), not indented nested lists. */
export function isTopLevelListItem(line: string): boolean {
  return /^\s{0,3}[-*+]\s+\S/u.test(line) || /^\s{0,3}\d+\.\s+\S/u.test(line);
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

function stripFrontmatter(markdown: string): string {
  const fmMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  return fmMatch ? markdown.slice(fmMatch[0].length) : markdown;
}

function makeEntry(
  heading: string,
  content: string,
  opts?: { isAppend?: boolean },
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
  return {
    heading,
    body,
    sortKey: heading || body.slice(0, 20),
    preview: preview || heading || body.slice(0, 80),
    rest,
    isAppend: opts?.isAppend === true || countStreamAppends(body) > 0 && !/^\s*[-*+]\s/u.test(body),
  };
}

/** Pull list-item entries from a structural section so content is never invisible. */
function entriesFromStructuralBody(sectionHeading: string, content: string): StreamEntry[] {
  const body = normalizeStreamEscapes(content).trim();
  if (!body) return [];
  const lines = body.split("\n");
  const out: StreamEntry[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const chunk = buf.join("\n").trim();
    buf = [];
    if (!chunk) return;
    const e = makeEntry(sectionHeading, chunk);
    if (e) out.push(e);
  };
  for (const line of lines) {
    // New list item starts a new soft entry
    if (/^\s*[-*+]\s+\S/u.test(line) || /^\s*\d+\.\s+\S/u.test(line)) {
      flush();
      buf.push(line);
    } else if (buf.length > 0) {
      buf.push(line);
    } else if (line.trim()) {
      // loose paragraph under 记录
      buf.push(line);
    }
  }
  flush();
  // Cap noise from huge structural dumps
  return out.slice(0, 40);
}

/**
 * Soft-split a day (or loose) section into per-bullet feed cards + append cards.
 */
export function softSplitContentEntries(
  sectionHeading: string,
  content: string,
): StreamEntry[] {
  const { main, appendChunks } = splitMainAndAppendChunks(content);
  const out: StreamEntry[] = [];

  if (main) {
    if (firstSubstantialLineIsList(main)) {
      const listBody = stripLeadingAtxHeadings(main);
      const bullets = entriesFromStructuralBody(sectionHeading, listBody || main);
      if (bullets.length > 0) {
        out.push(...bullets);
      } else {
        const single = makeEntry(sectionHeading, main);
        if (single) out.push(single);
      }
    } else {
      // Prose-first: one post. Wrapped line-breaks stay paragraphs, not cards.
      const single = makeEntry(sectionHeading, main);
      if (single) out.push(single);
    }
  }

  for (const chunk of appendChunks) {
    const e = makeEntry(sectionHeading, chunk, { isAppend: true });
    if (e) out.push(e);
  }

  return out;
}

/**
 * Parse period note markdown into entries (newest first).
 * - CRLF-safe frontmatter
 * - Day sections soft-split into per-bullet + append cards
 * - Structural shells (进行中/记录) still yield list-item cards so the feed is never blank
 */
export function parsePeriodNote(markdown: string): StreamEntry[] {
  const body = stripFrontmatter(markdown);

  const parts = body.split(/^## (.+)$/mu);
  if (parts.length <= 1) {
    const trimmed = body.trim();
    if (!trimmed) return [];
    // No ## sections — soft-split whole body
    const soft = softSplitContentEntries("", trimmed);
    if (soft.length > 0) return soft.reverse();
    const single = makeEntry("", trimmed);
    return single ? [single] : [];
  }

  const entries: StreamEntry[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]?.trim() ?? "";
    const content = (parts[i + 1] ?? "").trim();
    if (!heading && !content) continue;

    if (STRUCTURAL_HEADINGS.has(heading)) {
      // Soft-extract content so 记录/进行中 list items still appear in the feed
      for (const e of softSplitContentEntries(heading, content)) {
        entries.push(e);
      }
      continue;
    }

    if (isDayLikeHeading(heading)) {
      for (const e of softSplitContentEntries(heading, content)) {
        entries.push(e);
      }
      continue;
    }

    // Named non-day ## → one 文章卡 (keep 增补 in the body; do not soft-split)
    const e = makeEntry(heading, content);
    if (e) entries.push(e);
  }

  return entries.reverse();
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

/** Timestamp from first bullet line (or plain line start). */
export function extractBodyTimestamp(body: string): string | null {
  const text = normalizeStreamEscapes(body);
  const match = text.match(/^\s*[-*]\s+(\d{1,2}:\d{2})/u)
    || text.match(/^\s*(\d{1,2}:\d{2})\b/u);
  return match ? match[1] : null;
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
