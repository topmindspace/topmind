// ── Shared utility functions ───────────────────────────────────────────────
//
// Pure functions used across views, modals, and services.
// Extracted to avoid duplication and ensure consistent behavior.

import type { StreamEntry, SuggestionCard, SuggestionKind, TodoItem, ImpactLevel } from "./types";

/** Max capture body length (guards pathological filenames / giant pastes). */
export const MAX_CAPTURE_LEN = 10_000;

/**
 * Extract #tags from text. Supports Chinese, alphanumeric, and hyphenated tags.
 *
 * @param text - input text
 * @returns array of tag strings (without the # prefix)
 */
export function extractTags(text: string): string[] {
  const matches = text.matchAll(/#([\w\u4e00-\u9fff-]+)/gu);
  return Array.from(matches).map((m) => m[1]);
}

/**
 * Normalize capture text: trim, reject empty, truncate oversize.
 * Pure helper used by KernelService.capture and unit tests.
 */
export function normalizeCaptureText(text: string): {
  ok: boolean;
  text?: string;
  error?: "empty-text";
  truncated?: boolean;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "empty-text" };
  }
  if (trimmed.length > MAX_CAPTURE_LEN) {
    return {
      ok: true,
      text: trimmed.slice(0, MAX_CAPTURE_LEN) + "…(truncated)",
      truncated: true,
    };
  }
  return { ok: true, text: trimmed, truncated: false };
}

/**
 * Detect a lone URL capture (route to inbox, not stream clutter).
 */
export function isLoneUrlCapture(text: string): boolean {
  return /^https?:\/\/\S+$/iu.test(text.trim());
}

/**
 * Map a Kernel todo-engine item onto the plugin TodoItem shape.
 * Kernel uses `done`; never read a non-existent `completed` field.
 */
export function mapKernelTodoItem(item: Record<string, unknown>): TodoItem {
  return {
    id: String(item.id || ""),
    text: String(item.text || ""),
    done: Boolean(item.done),
    dueDate: item.dueDate as string | undefined,
    createdAt: item.createdAt as string | undefined,
    completedAt: item.completedAt as string | undefined,
    source: item.source as string | undefined,
  };
}

/**
 * Normalize Kernel generateSuggestions return: direct array or legacy wrapper.
 */
export function normalizeSuggestionList(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { suggestions?: unknown[] }).suggestions)) {
    return (raw as { suggestions: Record<string, unknown>[] }).suggestions;
  }
  return [];
}

/**
 * Map a Kernel suggestion object to SuggestionCard.
 */
export function mapKernelSuggestion(s: Record<string, unknown>): SuggestionCard {
  return {
    id: String(s.id || ""),
    kind: (s.kind as SuggestionKind) || "promote_memory",
    title: String(s.title || ""),
    summary: String(s.summary || ""),
    impact: (s.impact as ImpactLevel) || "low",
    payload: s.payload as Record<string, unknown> | undefined,
    targetPath: s.targetPath as string | undefined,
  };
}

/**
 * Soft-refresh merge (Desktop ActionStore session cache parity).
 * Kernel fingerprint skip often returns a thinner set than the cards already
 * on screen; keep previous ids until apply/dismiss. `next` wins on id clash.
 */
export function mergeSoftSuggestionSession(
  previous: SuggestionCard[],
  next: SuggestionCard[],
  dropped: Set<string> = new Set(),
): SuggestionCard[] {
  const prev = Array.isArray(previous) ? previous : [];
  const incoming = Array.isArray(next) ? next : [];
  const nextIds = new Set(incoming.map((s) => s?.id).filter(Boolean) as string[]);
  const kept = prev.filter((s) => s?.id && !nextIds.has(s.id) && !dropped.has(s.id));
  return [...incoming.filter((s) => s?.id && !dropped.has(s.id)), ...kept];
}

/**
 * Visual meta for each suggestion kind.
 * `icon` is an Obsidian/Lucide icon name (used with setIcon).
 * `border` is a CSS border token for color-coding suggestion cards.
 */
export const SUGGESTION_KIND_META: Record<
  SuggestionKind,
  { icon: string; border: string }
> = {
  create_topic: { icon: "folder-plus", border: "blue" },
  promote_memory: { icon: "brain", border: "green" },
  ai_summary: { icon: "bar-chart-3", border: "purple" },
  inbox_organize: { icon: "folder-input", border: "blue" },
  inbox_review: { icon: "inbox", border: "blue" },
  stale_topic: { icon: "package", border: "orange" },
  catch_all: { icon: "brush", border: "orange" },
  stream_digest: { icon: "scroll-text", border: "purple" },
  open_profile: { icon: "user", border: "green" },
};

/** All suggestion kinds the plugin UI must render. */
export const ALL_SUGGESTION_KINDS: readonly SuggestionKind[] = [
  "create_topic",
  "promote_memory",
  "ai_summary",
  "inbox_organize",
  "inbox_review",
  "stale_topic",
  "catch_all",
  "stream_digest",
  "open_profile",
];

/**
 * Whether an error should be retried by the AI provider (network / timeout / abort).
 * Kept pure here so unit tests can import without pulling requestUrl-side modules.
 *
 * Handles errors from both raw `fetch` (TypeError for network failures) and
 * Obsidian's `requestUrl` (which may throw Error with "net::" or "ERR_" prefixes
 * from Electron's net module).
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network error (fetch)
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("abort") ||
      msg.includes("net::") ||         // Electron net module errors (requestUrl)
      msg.includes("err_") ||          // e.g. ERR_CONNECTION_REFUSED
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout")
    );
  }
  return false;
}

/**
 * Append only tags not already present in the capture body.
 * Prevents `extractTags(text)` + re-append from doubling `#tag` → `#tag #tag`.
 */
export function mergeCaptureTags(text: string, tags?: string[]): string {
  const base = String(text || "");
  if (!tags?.length) return base;
  const existing = new Set(extractTags(base).map((t) => t.toLowerCase()));
  const toAdd = tags.filter((t) => t && !existing.has(String(t).toLowerCase()));
  if (toAdd.length === 0) return base;
  const suffix = toAdd.map((t) => (String(t).startsWith("#") ? String(t) : `#${t}`)).join(" ");
  return `${base.trimEnd()} ${suffix}`.trim();
}

/**
 * Map Kernel applySuggestion result to surface { ok, error?, openPath? }.
 *
 * Rules (aligned with suggest-engine returns):
 * - operation "open" / note "open only" → success with openPath (e.g. open_profile)
 * - ok === false OR operation === "skip" → failure (keep card)
 * - wroteFiles === false without open/ok:true → failure
 * - pending → failure (needs confirm)
 * - wroteFiles true or ok true → success
 */
export function mapApplySuggestionResult(
  result: unknown,
  suggestion: { kind: string; payload?: Record<string, unknown> },
): { ok: boolean; error?: string; openPath?: string } {
  if (result == null || typeof result !== "object") {
    return { ok: false, error: "empty-result" };
  }
  const r = result as Record<string, unknown>;
  const operation = String(r.operation || "");
  const note = String(r.note || "");
  const targetPath = r.targetPath != null
    ? String(r.targetPath).replace(/\\/g, "/")
    : undefined;

  // open-only success (profile exists, or explicit open)
  if (operation === "open" || /open\s*only/i.test(note)) {
    return { ok: true, openPath: targetPath };
  }

  if (r.pending === true || r.needsConfirm === true) {
    return { ok: false, error: "pending-confirmation" };
  }

  if (r.ok === false || operation === "skip") {
    return {
      ok: false,
      error: String(r.reason || r.note || "suggestion-skipped"),
    };
  }

  // Explicit write failure without open semantics
  if (r.wroteFiles === false && r.ok !== true) {
    return {
      ok: false,
      error: String(r.reason || r.note || "no-write"),
    };
  }

  if (r.ok === true || r.wroteFiles === true) {
    const payload = suggestion && typeof suggestion === "object"
      ? (suggestion as { payload?: Record<string, unknown> }).payload
      : undefined;
    const digest = typeof payload?.digestPath === "string" ? payload.digestPath.replace(/\\/g, "/") : "";
    const safe = (p?: string) => {
      if (!p) return undefined;
      const n = p.replace(/\\/g, "/").trim();
      if (!n || n.includes("..")) return undefined;
      if (/(?:^|\/)(?:undefined|period)\.md$/u.test(n)) return undefined;
      return n;
    };
    const written = safe(targetPath);
    const digestSafe = safe(digest);
    const openPath = written && /(?:^|\/)memory\/periodic\//u.test(written)
      ? written
      : (digestSafe || written);
    return openPath ? { ok: true, openPath } : { ok: true };
  }

  // Legacy evidence without ok/wroteFiles flags: treat non-skip as success
  if (operation && operation !== "skip") {
    const written = typeof targetPath === "string" ? targetPath : undefined;
    return written ? { ok: true, openPath: written } : { ok: true };
  }

  return { ok: false, error: String(r.reason || r.note || "apply-failed") };
}

/**
 * Parse stream entries from period note content.
 * Each entry is a bullet line starting with a time pattern: `- HH:MM <text>`.
 * Multi-line entries capture continuation lines (indented or non-bullet lines
 * following the time-stamped first line) so structured content is not lost.
 *
 * @param content - period note body (with or without frontmatter)
 * @returns parsed stream entries
 */
/** True when a line is Kernel 增补 chrome (comment or #### 续 heading). */
export function isStreamAppendChromeLine(line: string): boolean {
  const s = String(line || "").trim();
  if (!s) return false;
  if (/^<!--\s*topmind:append\b/iu.test(s)) return true;
  // No \b after 续 — CJK is non-word so \b would never match.
  return /^#{2,4}\s*续(?=\s|[·•.]|$)/u.test(s);
}

/**
 * Display-only prep for Obsidian stream cards.
 * Strips `<!-- topmind:append ... -->` so machine markers are not chrome-as-content.
 * Does not rewrite the period note.
 */
export function prepareStreamEntryTextForDisplay(text: string): string {
  let s = String(text || "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/\r\n/gu, "\n")
    .replace(/\t/gu, "  ");
  s = s.replace(/\n{3,}/gu, "\n\n");
  s = s.replace(/(^#{1,6}[^\n]+)\n\n+/gmu, "$1\n");
  s = s.replace(/\n\n+([-*+]\s)/gu, "\n$1");
  s = s.replace(/\n\n+(\d+\.\s)/gu, "\n$1");
  return s.trim();
}

/** Indent of a markdown list marker in spaces (tabs = 2), or -1. */
export function listMarkerIndent(line: string): number {
  const m = String(line || "").match(/^(\s*)(?:[-*+]|\d+\.)\s+\S/u);
  if (!m) return -1;
  return m[1].replace(/\t/gu, "  ").length;
}

function isTopLevelListItem(line: string): boolean {
  const indent = listMarkerIndent(line);
  return indent >= 0 && indent <= 3;
}

function skipAsSubstantial(line: string): boolean {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^<!--/u.test(t)) return true;
  if (/^#{1,6}\s/u.test(t)) return true;
  if (t === "---") return true;
  return false;
}

function firstSubstantialLineIsList(lines: string[]): boolean {
  for (const line of lines) {
    if (skipAsSubstantial(line)) continue;
    return isTopLevelListItem(line);
  }
  return false;
}

function frontmatterEndLine(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return 0;
}

/**
 * Parse stream entries from period note content.
 *
 * Structure-true chunking (aligned with Desktop parsePeriodNote):
 * - List-led day/section (`-` / `*` / `1.` first substantial line) → one post per
 *   top-level list item. Timed `- HH:MM` items stay separate. Extra paragraphs
 *   after a moment stay on the same post. Kernel 增补 stays on the parent card.
 * - Prose-first section (wrapped lines, no list markers) → **one** post; line
 *   breaks are paragraphs, not extra list cards. Embedded lists stay in the body.
 */
export interface StreamPreviewAppend {
  title: string;
  body: string;
  markdown: string;
}

/**
 * Split period entry text into main content + append chunks (#### 续 / topmind:append).
 * Mirrors Desktop's splitMainAndAppendChunks for identical stream card presentation.
 */
export function splitStreamPreviewParts(md: string): {
  main: string;
  appends: StreamPreviewAppend[];
} {
  const text = String(md || "").replace(/\r\n/gu, "\n");
  if (!text.trim()) return { main: "", appends: [] };

  const parts = text.split(
    /(?=^<!--\s*topmind:append\b)|(?=^#{2,4}\s*续(?=\s|[·•.]|$))/gmu,
  );
  if (parts.length <= 1) {
    return { main: text.trim(), appends: [] };
  }

  const main = (parts[0] || "").trim();
  const appends: StreamPreviewAppend[] = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = (parts[i] || "").trim();
    if (!chunk) continue;
    const lines = chunk.split("\n");
    const first = lines[0] || "";
    const h = first.match(/^#{1,4}\s+(.+)$/u);
    const title = h ? h[1].trim() : first.replace(/^#{1,4}\s*/u, "").trim() || "续";
    const body = lines.slice(1).join("\n").trim();
    appends.push({ title, markdown: chunk, body });
  }
  return { main, appends };
}

export function parseStreamEntries(content: string): StreamEntry[] {
  const entries: StreamEntry[] = [];
  const lines = String(content || "").split("\n");
  const timeRegex = /^[-*]\s*(\d{1,2}:\d{2})\s+(.*)/u;
  const tagRegex = /#([\w\u4e00-\u9fff-]+)/gu;
  const fmEnd = frontmatterEndLine(lines);

  const headingIdx: number[] = [];
  for (let i = fmEnd; i < lines.length; i++) {
    if (/^#{2,3}\s+/u.test(lines[i])) headingIdx.push(i);
  }

  type Section = { start: number; end: number; heading?: string };
  const sections: Section[] = [];
  if (headingIdx.length === 0) {
    sections.push({ start: fmEnd, end: lines.length });
  } else {
    if (headingIdx[0] > fmEnd) sections.push({ start: fmEnd, end: headingIdx[0] });
    for (let h = 0; h < headingIdx.length; h++) {
      const headingLine = lines[headingIdx[h]];
      const headingText = headingLine.replace(/^#{2,3}\s+/u, "").trim();
      const start = headingIdx[h] + 1;
      const end = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
      sections.push({ start, end, heading: headingText });
    }
  }

  const pushEntry = (start: number, end: number, firstLine: string, textParts: string[], secHeading?: string) => {
    const timeMatch = firstLine.match(timeRegex);
    const time = timeMatch ? timeMatch[1] : "";
    const text = textParts.join("\n").trim();
    if (!text && !time) return;
    const tags = Array.from(text.matchAll(tagRegex)).map((m) => m[1]);
    entries.push({
      time,
      text,
      tags,
      rawLine: lines.slice(start, end).join("\n"),
      lineOffset: start,
      heading: secHeading,
      startLine: start,
      endLine: end,
    });
  };

  for (const sec of sections) {
    const slice = lines.slice(sec.start, sec.end);
    const listLed = firstSubstantialLineIsList(slice);

    if (!listLed) {
      const textParts: string[] = [];
      let firstIdx = -1;
      for (let i = sec.start; i < sec.end; i++) {
        const line = lines[i];
        const t = line.trim();
        if (/^#{1,6}\s/u.test(t)) continue;
        if (t === "---") continue;
        if (firstIdx < 0 && t && !/^<!--/u.test(t)) firstIdx = i;
        textParts.push(line);
      }
      const text = textParts.join("\n").trim();
      if (!text) continue;
      const tags = Array.from(text.matchAll(tagRegex)).map((m) => m[1]);
      entries.push({
        time: "",
        text,
        tags,
        rawLine: text,
        lineOffset: firstIdx >= 0 ? firstIdx : sec.start,
        heading: sec.heading,
        startLine: firstIdx >= 0 ? firstIdx : sec.start,
        endLine: sec.end,
      });
      continue;
    }

    let baseIndent: number | null = null;
    const isTimedListLine = (line: string): boolean =>
      /^\s*(?:[-*+]|\d+\.)\s+\d{1,2}:\d{2}\b/u.test(line);

    const isContinuation = (line: string, afterAppend: boolean): boolean => {
      if (!line.trim()) return true;
      if (isStreamAppendChromeLine(line)) return true;
      if (/^#{1,6}\s/u.test(line) && !isStreamAppendChromeLine(line)) return false;
      const indent = listMarkerIndent(line);
      if (indent >= 0 && baseIndent !== null && indent <= baseIndent) {
        // Timed `- HH:MM` after 续 is a later 记下. Untimed list/task is append body.
        if (afterAppend && !isTimedListLine(line)) return true;
        return false;
      }
      return true;
    };

    let i = sec.start;
    while (i < sec.end) {
      const line = lines[i];
      const indent = listMarkerIndent(line);
      if (indent < 0) {
        i += 1;
        continue;
      }
      if (baseIndent === null) baseIndent = indent;
      if (indent > baseIndent) {
        i += 1;
        continue;
      }
      const timeMatch = line.match(timeRegex);
      const firstText = timeMatch
        ? timeMatch[2]
        : line.replace(/^\s*[-*+]\s+/u, "").replace(/^\s*\d+\.\s+/u, "");
      const textParts: string[] = [firstText];
      let j = i + 1;
      let afterAppend = false;
      while (j < sec.end && isContinuation(lines[j], afterAppend)) {
        const cont = lines[j];
        if (isStreamAppendChromeLine(cont)) afterAppend = true;
        if (!cont.trim()) {
          const next = lines[j + 1];
          if (!next || !isContinuation(next, afterAppend) || !next.trim()) break;
          j += 1;
          continue;
        }
        // Keep indent so nested lists render as lists, not extra cards.
        textParts.push(cont);
        j += 1;
      }
      pushEntry(i, j, line, textParts, sec.heading);
      i = j;
    }
  }

  return entries;
}

/** Strip YAML frontmatter from markdown, returning body only. */
export function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  return match ? raw.slice(match[0].length) : raw;
}

/** Extract YAML frontmatter block (including delimiters), or null if absent. */
export function extractFrontmatter(raw: string): string | null {
  const match = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n*)/u);
  return match ? match[0] : null;
}

/** Seed frontmatter for a new period note. */
export function seedPeriodFrontmatter(relPath: string): string {
  const fileName = relPath.split("/").pop()?.replace(".md", "") || "";
  return `---\nperiod: ${fileName}\n---\n\n`;
}

/** Sanitize a string for use as a file name (removes invalid chars). */
export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "-").replace(/^-+|-+$/g, "").trim() || "untitled";
}

/**
 * Check if a file path is relevant to the topmind stream/todo system.
 * Used to filter vault modification events for refresh triggers.
 *
 * Matches:
 * - Stream category directories (e.g., "10-动态/", "10-Stream/") — the first
 *   numbered dir segment, since stream roles use 10-19 prefix by convention.
 * - The todo file (memory/todo.md).
 * - Periodic memory files (memory/periodic/) — AI digests may update them.
 *
 * Does NOT match: output (88-), archive (99-), deep-work topics (20+),
 * or profile memory — those changes don't affect stream/todo UI.
 *
 * @param filePath - Obsidian file path (relative to vault root)
 * @returns true if the path may affect stream or todo data
 */
export function isStreamOrTodoPath(filePath: string): boolean {
  // Match stream/todo-relevant paths only (not all NN- categories)
  // Stream categories use 10-19 prefix range by convention
  if (/^1\d-/u.test(filePath)) return true;
  // Also match memory/todo and memory/periodic (AI digest updates)
  if (/(?:^|\/)todo\.md$/u.test(filePath)) return true;
  if (/(?:^|\/)periodic\//u.test(filePath)) return true;
  return false;
}

/* ── Suggestion apply/open labels ──
 * 与 Desktop `lib/suggest-apply-label.ts` 同语义（跨表面词汇规范）：
 * write 类主按钮「确认执行」；open-existing（open_profile）主按钮「打开」。
 * write 类卡片在可解析出目标文件时附「打开」次按钮供先查看再决定。
 */

/** Kinds whose confirm actually writes (everything except open_profile). */
const WRITE_SUGGESTION_KINDS: ReadonlySet<string> = new Set([
  "stream_digest",
  "ai_summary",
  "promote_memory",
  "inbox_review",
  "stale_topic",
  "catch_all",
  "inbox_organize",
  "create_topic",
]);

export function suggestionApplyIsWrite(kind?: string): boolean {
  if (!kind) return false;
  return WRITE_SUGGESTION_KINDS.has(kind);
}

/**
 * Resolve an inspectable target file for a suggestion card, if any.
 * Mirrors Desktop: targetPath → payload.sourcePath → payload.path; rejects
 * traversal and the placeholder `undefined.md` / `period.md` stems.
 */
export function suggestionOpenPath(card: {
  targetPath?: string;
  payload?: Record<string, unknown>;
}): string | null {
  const payload = card.payload || {};
  const candidates = [
    card.targetPath,
    typeof payload.sourcePath === "string" ? payload.sourcePath : "",
    typeof payload.path === "string" ? payload.path : "",
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const p = raw.replace(/\\/g, "/").trim();
    if (!p) continue;
    if (p.includes("..")) continue;
    if (/(?:^|\/)(?:undefined|period)\.md$/u.test(p)) continue;
    return p;
  }
  return null;
}

/** Shortened breadcrumb for card meta lines (last 2 segments, `… /` prefix). */
export function friendlySuggestionPath(rawPath?: string): string | null {
  if (!rawPath) return null;
  const parts = rawPath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] || rawPath;
  const last = parts.slice(-2).join(" / ");
  return parts.length > 2 ? `… / ${last}` : last;
}

/* ── Memory browse (read projection of profile / periodic / topics) ──
 * Grouping lives in Kernel `lib/memory-feed.mjs` — hosts must not fork a twin.
 */

export type MemoryFeedKind = "profile" | "periodic" | "topic";
export type MemoryFeedLayer = "all" | MemoryFeedKind;

export interface MemoryFeedItem {
  id: string;
  kind: MemoryFeedKind;
  path: string;
  title: string;
  preview: string;
  body: string;
  heading?: string;
  history?: boolean;
}

export interface MemoryFeedSource {
  profile: { path: string; markdown: string } | null;
  periodic: Array<{ path: string; markdown: string }>;
  topics: Array<{ path: string; markdown: string }>;
}

export {
  assembleMemoryFeed,
  filterMemoryFeedByLayer,
  isMemoryFeedLayer,
} from "../../lib/memory-feed.mjs";
