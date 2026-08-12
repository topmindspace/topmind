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
 * Visual meta for each suggestion kind.
 * `icon` is an Obsidian/Lucide icon name (used with setIcon).
 * `border` is a CSS border token for color-coding suggestion cards.
 */
export const SUGGESTION_KIND_META: Record<
  SuggestionKind,
  { icon: string; border: string }
> = {
  create_topic: { icon: "folder-plus", border: "blue" },
  todo_extract: { icon: "list-checks", border: "orange" },
  promote_memory: { icon: "brain", border: "green" },
  ai_summary: { icon: "bar-chart-3", border: "purple" },
  inbox_review: { icon: "inbox", border: "blue" },
  stale_topic: { icon: "package", border: "orange" },
  catch_all: { icon: "brush", border: "orange" },
  stream_digest: { icon: "scroll-text", border: "purple" },
  open_profile: { icon: "user", border: "green" },
  topic_classify: { icon: "tag", border: "blue" },
};

/** All suggestion kinds the plugin UI must render. */
export const ALL_SUGGESTION_KINDS: readonly SuggestionKind[] = [
  "create_topic",
  "promote_memory",
  "ai_summary",
  "todo_extract",
  "inbox_review",
  "stale_topic",
  "catch_all",
  "stream_digest",
  "open_profile",
  "topic_classify",
];

/**
 * Whether an error should be retried by the AI provider (network / timeout / abort).
 * Kept pure here so unit tests can import without pulling fetch-side modules.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // network error
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("fetch") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("abort")
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
    const openPath =
      targetPath ||
      (suggestion.kind === "open_profile" ? "memory/profile.md" : undefined);
    return { ok: true, openPath };
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
export function parseStreamEntries(content: string): StreamEntry[] {
  const entries: StreamEntry[] = [];
  const lines = content.split("\n");
  // Match bullet lines with time prefix: `- HH:MM text` or `* HH:MM text`
  const timeRegex = /^[-*]\s*(\d{1,2}:\d{2})\s+(.*)/u;
  // A continuation line: indented, or a non-heading, non-bullet, non-frontmatter line
  const isContinuation = (line: string): boolean => {
    if (!line.trim()) return true; // blank line within entry
    if (/^#{1,6}\s/u.test(line)) return false; // heading starts new section
    if (/^[-*]\s+\d{1,2}:\d{2}\s/u.test(line)) return false; // new time-stamped entry
    if (/^[-*]\s+\[/.test(line)) return false; // task list item
    // Indented continuation OR plain text line (part of multi-line entry)
    return /^\s+/u.test(line) || !/^[-*]\s/u.test(line);
  };
  const tagRegex = /#([\w\u4e00-\u9fff-]+)/gu;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(timeRegex);
    if (match) {
      const time = match[1];
      const firstText = match[2];
      // Collect continuation lines (multi-line entries)
      const textParts: string[] = [firstText];
      let j = i + 1;
      while (j < lines.length && isContinuation(lines[j])) {
        const cont = lines[j];
        // Stop at trailing blank lines (don't include padding)
        if (!cont.trim()) break;
        textParts.push(cont.trim());
        j++;
      }
      const text = textParts.join("\n").trim();
      const tags = Array.from(text.matchAll(tagRegex)).map((m) => m[1]);
      const rawLine = lines.slice(i, j).join("\n");
      entries.push({ time, text, tags, rawLine, lineOffset: i });
      i = j - 1; // skip consumed continuation lines
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
  if (filePath.includes("memory/todo")) return true;
  if (filePath.includes("memory/periodic/")) return true;
  return false;
}
