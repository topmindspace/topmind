// ── Shared utility functions ───────────────────────────────────────────────
//
// Pure functions used across views, modals, and services.
// Extracted to avoid duplication and ensure consistent behavior.

import type { StreamEntry } from "./types";

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
 * Parse stream entries from period note content.
 * Each entry is a bullet line starting with a time pattern: `- HH:MM <text>`.
 *
 * @param content - period note body (without frontmatter)
 * @returns parsed stream entries
 */
export function parseStreamEntries(content: string): StreamEntry[] {
  const entries: StreamEntry[] = [];
  const lines = content.split("\n");
  const timeRegex = /^-\s*(\d{1,2}:\d{2})\s+(.*)/u;
  const tagRegex = /#([\w\u4e00-\u9fff-]+)/gu;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(timeRegex);
    if (match) {
      const time = match[1];
      const text = match[2];
      const tags = Array.from(text.matchAll(tagRegex)).map((m) => m[1]);
      entries.push({ time, text, tags, rawLine: line, lineOffset: i });
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
