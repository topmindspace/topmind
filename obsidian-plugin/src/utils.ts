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
  suggestion: { kind: string },
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
    return { ok: true };
  }

  // Legacy evidence without ok/wroteFiles flags: treat non-skip as success
  if (operation && operation !== "skip") {
    return { ok: true };
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
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function isTopLevelListItem(line: string): boolean {
  return /^\s{0,3}[-*+]\s+\S/u.test(line) || /^\s{0,3}\d+\.\s+\S/u.test(line);
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

  type Section = { start: number; end: number };
  const sections: Section[] = [];
  if (headingIdx.length === 0) {
    sections.push({ start: fmEnd, end: lines.length });
  } else {
    if (headingIdx[0] > fmEnd) sections.push({ start: fmEnd, end: headingIdx[0] });
    for (let h = 0; h < headingIdx.length; h++) {
      const start = headingIdx[h] + 1;
      const end = h + 1 < headingIdx.length ? headingIdx[h + 1] : lines.length;
      sections.push({ start, end });
    }
  }

  const pushEntry = (start: number, end: number, firstLine: string, textParts: string[]) => {
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
      });
      continue;
    }

    const isContinuation = (line: string, afterAppend: boolean): boolean => {
      if (!line.trim()) return true;
      if (isStreamAppendChromeLine(line)) return true;
      if (/^#{1,6}\s/u.test(line) && !isStreamAppendChromeLine(line)) return false;
      if (/^[-*+]\s+\d{1,2}:\d{2}\s/u.test(line)) return false;
      if (isTopLevelListItem(line) && !afterAppend) return false;
      return true;
    };

    let i = sec.start;
    while (i < sec.end) {
      const line = lines[i];
      if (!isTopLevelListItem(line)) {
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
          textParts.push("");
          j += 1;
          continue;
        }
        textParts.push(cont.trim());
        j += 1;
      }
      pushEntry(i, j, line, textParts);
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
