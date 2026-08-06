// ── topmind Todo Engine (Kernel extension) ────────────────────────────────
// Personal todo list management on the semantic plane (memory/todo.md).
//
// Design principle: todo-engine handles parsing, writing, and AI maintenance
// of the user's personal action items. All writes go through writeback-engine.
// The todo list is a simple markdown checklist — durable, portable, editable.
//
// Relationship to other systems:
// - NOT ActionStore/ActionBar (workspace management suggestions)
// - NOT TaskStore/TaskPanel (background engine tasks)
// - NOT KanbanView (note status board)
// This is the user's personal task tracker, maintained by AI + manual editing.
//
// Due dates: embedded in item text as `📅 YYYY-MM-DD` suffix.
// AI maintenance: not just extraction — also detects completed/updated items.
//
// Anti-re-extraction strategy:
// - Processed periods tracked in frontmatter → AI skips already-scanned periods
// - Dismissed items tracked in frontmatter → AI won't re-add user-deleted items
// - createdAt tracked → enables stale detection and auto-cleanup

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureMemoryPlane } from "./memory-engine.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import { loadContract } from "./contract-engine.mjs";
import { resolveWorkspaceModel, findStreamCategory, resolveStreamTarget } from "./workspace-model.mjs";
import { appendToPeriodBody } from "./stream-period.mjs";
import {
  resolveActivityWindow,
  periodItemsFromWindow,
  buildActivityCorpus,
} from "./activity-window.mjs";

/** Relative path to the todo file within the workspace. */
export const TODO_REL_PATH = "memory/todo.md";

/** Maximum items kept in the active list before archiving completed ones. */
const MAX_ACTIVE_ITEMS = 50;

/** Days before completed items are auto-archived. */
const COMPLETED_AUTO_ARCHIVE_DAYS = 7;

/** Days before active items are flagged as stale. */
const STALE_THRESHOLD_DAYS = 30;

/** Days before dismissed item hashes expire (allow re-extraction). */
const DISMISS_EXPIRY_DAYS = 30;

/** Number of recent periods to scan for AI maintenance. */
const MAINTAIN_PERIOD_DEPTH = 2;

/** Due date marker — Obsidian Tasks compatible `📅 YYYY-MM-DD`. */
const DUE_DATE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/u;

/**
 * @typedef {Object} TodoItem
 * @property {string} id — stable hash of text (for React keys + dedup)
 * @property {string} text — the task description (without due date marker)
 * @property {boolean} done — completion status
 * @property {string} [source] — "manual" | "ai" | "stream"
 * @property {string} [sourcePeriod] — e.g. "2026-W30" when extracted from stream
 * @property {string} [dueDate] — ISO date YYYY-MM-DD
 * @property {string} [createdAt] — ISO date when item was first added
 * @property {string} [completedAt] — ISO date when item was marked done
 */

/**
 * @typedef {Object} TodoHealth
 * @property {number} total
 * @property {number} active
 * @property {number} completed
 * @property {number} overdue
 * @property {number} stale — active items older than STALE_THRESHOLD_DAYS
 * @property {number} oldCompleted — completed items older than COMPLETED_AUTO_ARCHIVE_DAYS
 * @property {string[]} staleItems — texts of stale items for prompting
 */

/**
 * Resolve the absolute path to the todo file.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function resolveTodoPath(workspaceRoot) {
  return path.join(workspaceRoot, TODO_REL_PATH);
}

/**
 * Generate a stable ID from text content (for dedup + React keys).
 * @param {string} text
 * @returns {string}
 */
function todoId(text) {
  return createHash("sha1").update(text.trim().toLowerCase()).digest("hex").slice(0, 12);
}

/**
 * Parse due date from item text, returning clean text + dueDate.
 * @param {string} raw
 * @returns {{ text: string, dueDate: string | undefined }}
 */
function parseDueDate(raw) {
  const m = raw.match(DUE_DATE_RE);
  if (m) {
    return { text: raw.replace(DUE_DATE_RE, "").trim(), dueDate: m[1] };
  }
  // Also support shorthand: 📅 8/01 or 📅 08-01
  const shortMatch = raw.match(/\s*📅\s*(\d{1,2})[/-](\d{1,2})\s*$/u);
  if (shortMatch) {
    const year = new Date().getFullYear();
    const month = String(shortMatch[1]).padStart(2, "0");
    const day = String(shortMatch[2]).padStart(2, "0");
    return { text: raw.replace(/\s*📅\s*\d{1,2}[/-]\d{1,2}\s*$/u, "").trim(), dueDate: `${year}-${month}-${day}` };
  }
  return { text: raw.trim(), dueDate: undefined };
}

/**
 * Format due date marker for serialization.
 * @param {string} dueDate
 * @returns {string}
 */
function formatDueDate(dueDate) {
  return ` 📅 ${dueDate}`;
}

/**
 * Get today's date as YYYY-MM-DD.
 * @returns {string}
 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Days between two ISO date strings.
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
function daysBetween(from, to) {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

// ── Frontmatter parsing for processed periods + dismissed items ────────────

/**
 * Parse frontmatter to extract processed_periods and dismissed items.
 * @param {string} rawContent
 * @returns {{ processedPeriods: string[], dismissed: string[], dismissedAt: Record<string, string> }}
 */
function parseFrontmatterMeta(rawContent) {
  const result = { processedPeriods: [], dismissed: [], dismissedAt: {} };
  if (!rawContent || !rawContent.startsWith("---")) return result;

  const fmEnd = rawContent.indexOf("\n---", 3);
  if (fmEnd < 0) return result;
  const fm = rawContent.slice(0, fmEnd);

  // Parse processed_periods (YAML array inline or block)
  const ppMatch = fm.match(/processed_periods:\s*\[([^\]]*)\]/u);
  if (ppMatch) {
    result.processedPeriods = ppMatch[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  } else {
    const ppBlock = fm.match(/processed_periods:\s*\n((?:\s+-\s+.+\n?)+)/u);
    if (ppBlock) {
      result.processedPeriods = ppBlock[1].match(/-\s+(.+)/gu)?.map((s) => s.replace(/^-\s+/u, "").trim().replace(/["']/g, "")) || [];
    }
  }

  // Parse dismissed (array of hashes)
  const disMatch = fm.match(/dismissed:\s*\[([^\]]*)\]/u);
  if (disMatch) {
    result.dismissed = disMatch[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  } else {
    const disBlock = fm.match(/dismissed:\s*\n((?:\s+-\s+.+\n?)+)/u);
    if (disBlock) {
      result.dismissed = disBlock[1].match(/-\s+(.+)/gu)?.map((s) => s.replace(/^-\s+/u, "").trim().replace(/["']/g, "")) || [];
    }
  }

  // Parse dismissed_at (map of hash → date) for expiry
  const disAtBlock = fm.match(/dismissed_at:\s*\n((?:\s+-\s+.+\n?)+)/u);
  if (disAtBlock) {
    const entries = disAtBlock[1].match(/-\s+"?([^":]+)"?\s*:\s*"?(.+?)"?\s*$/gmu) || [];
    for (const entry of entries) {
      const m = entry.match(/-\s+"?([^":]+)"?\s*:\s*"?(.+?)"?\s*$/u);
      if (m) result.dismissedAt[m[1].trim()] = m[2].trim();
    }
  }

  return result;
}

/**
 * Serialize frontmatter with processed periods and dismissed items.
 * Preserves existing frontmatter fields, updates our custom fields.
 * @param {string} prevContent
 * @param {string[]} processedPeriods
 * @param {string[]} dismissed
 * @param {Record<string, string>} dismissedAt
 * @returns {string}
 */
function serializeFrontmatter(prevContent, processedPeriods, dismissed, dismissedAt) {
  const now = new Date().toISOString();
  const ppLine = `processed_periods: [${processedPeriods.map((p) => `"${p}"`).join(", ")}]`;
  const disLine = `dismissed: [${dismissed.map((d) => `"${d}"`).join(", ")}]`;

  // Build dismissed_at entries (only non-expired)
  const today = todayStr();
  const validDismissedAt = {};
  for (const [hash, date] of Object.entries(dismissedAt)) {
    if (daysBetween(date, today) < DISMISS_EXPIRY_DAYS) {
      validDismissedAt[hash] = date;
    }
  }

  // Default frontmatter lines
  const defaultLines = [
    "---",
    "title: 我的待办",
    "memory_layer: global",
    "protection: open",
    "source_type: user-original",
    `updated_at: "${now}"`,
    ppLine,
    disLine,
  ];

  if (Object.keys(validDismissedAt).length > 0) {
    defaultLines.push("dismissed_at:");
    for (const [hash, date] of Object.entries(validDismissedAt)) {
      defaultLines.push(`  - "${hash}": "${date}"`);
    }
  }
  defaultLines.push("---");

  // Try to preserve unknown fields from previous frontmatter
  if (prevContent && prevContent.startsWith("---")) {
    const fmEnd = prevContent.indexOf("\n---", 3);
    if (fmEnd > 0) {
      const prevFm = prevContent.slice(4, fmEnd);
      const knownKeys = new Set([
        "title", "memory_layer", "protection", "source_type",
        "updated_at", "processed_periods", "dismissed", "dismissed_at",
      ]);
      const prevLines = prevFm.split("\n");
      const extraLines = [];
      let skipBlock = false;

      for (const line of prevLines) {
        const keyMatch = line.match(/^(\w+):/u);
        if (keyMatch) {
          skipBlock = knownKeys.has(keyMatch[1]);
          if (!skipBlock) {
            extraLines.push(line);
          }
        } else if (skipBlock && line.startsWith("  - ")) {
          continue;
        } else if (!skipBlock && line.trim()) {
          extraLines.push(line);
        }
      }

      if (extraLines.length > 0) {
        defaultLines.splice(-1, 0, ...extraLines);
      }
    }
  }

  return defaultLines.join("\n") + "\n\n";
}

/**
 * Seed content for a new todo file.
 * @returns {string}
 */
function seedTodoContent() {
  const now = new Date().toISOString();
  return `---
title: 我的待办
memory_layer: global
protection: open
source_type: user-original
updated_at: "${now}"
processed_periods: []
dismissed: []
---

# 我的待办

`;
}

/**
 * Ensure the todo file exists. Creates with seed content if missing.
 * @param {string} workspaceRoot
 * @returns {{ absPath: string, relPath: string, created: boolean }}
 */
export function ensureTodoFile(workspaceRoot) {
  ensureMemoryPlane(workspaceRoot);
  const absPath = resolveTodoPath(workspaceRoot);
  if (fs.existsSync(absPath)) {
    return { absPath, relPath: TODO_REL_PATH, created: false };
  }
  executeWrite({
    targetPath: absPath,
    content: seedTodoContent(),
    workspaceRoot,
    contract: loadContract(workspaceRoot),
    operation: "create",
    actor: "user",
    confirmed: true,
    role: "memory",
    skipBackup: true,
    skipReceipt: true,
  });
  return { absPath, relPath: TODO_REL_PATH, created: true };
}

/**
 * Parse todo items from the todo markdown file.
 * Extracts `- [ ]` and `- [x]` checkboxes from the body (after frontmatter).
 * Also parses due dates (`📅 YYYY-MM-DD`) and source metadata (HTML comments).
 *
 * @param {string} workspaceRoot
 * @returns {{ items: TodoItem[], rawContent: string, relPath: string, processedPeriods: string[], dismissed: string[], dismissedAt: Record<string, string> } | null}
 */
export function readTodoList(workspaceRoot) {
  const absPath = resolveTodoPath(workspaceRoot);
  if (!fs.existsSync(absPath)) return null;
  const rawContent = fs.readFileSync(absPath, "utf8");

  // Parse frontmatter metadata
  const meta = parseFrontmatterMeta(rawContent);

  // Strip frontmatter
  let body = rawContent;
  const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  if (fmMatch) body = body.slice(fmMatch[0].length);

  // Also strip the # heading
  body = body.replace(/^#\s.*\r?\n/u, "");

  /** @type {TodoItem[]} */
  const items = [];
  const lines = body.split("\n");
  let pendingSource = null;
  let pendingPeriod = null;
  let pendingCreated = null;
  let pendingCompleted = null;

  for (const line of lines) {
    // HTML comment metadata: <!-- source: ai, period: 2026-W30, created: 2026-07-29 -->
    // Or standalone: <!-- created: 2026-07-29 --> or <!-- completed: 2026-07-29 -->
    const metaMatch = line.match(/<!--\s*source:\s*(\w+)(?:,\s*period:\s*([^\s,]+))?(?:,\s*created:\s*(\d{4}-\d{2}-\d{2}))?\s*-->/u);
    const createdMatch = !metaMatch ? line.match(/<!--\s*created:\s*(\d{4}-\d{2}-\d{2})\s*-->/u) : null;
    const completedMatch = line.match(/<!--\s*completed:\s*(\d{4}-\d{2}-\d{2})\s*-->/u);
    if (metaMatch) {
      pendingSource = metaMatch[1] || null;
      pendingPeriod = metaMatch[2] || null;
      pendingCreated = metaMatch[3] || null;
      continue;
    }
    if (createdMatch) {
      pendingCreated = createdMatch[1] || null;
      continue;
    }
    if (completedMatch) {
      // Will be applied to the next checkbox item as completedAt
      pendingCompleted = completedMatch[1] || null;
      continue;
    }

    // Checkbox line: - [ ] text  or  - [x] text
    const checkMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/u);
    if (checkMatch) {
      const done = checkMatch[1].toLowerCase() === "x";
      const { text, dueDate } = parseDueDate(checkMatch[2].trim());
      if (text) {
        items.push({
          id: todoId(text),
          text,
          done,
          source: pendingSource || "manual",
          sourcePeriod: pendingPeriod || undefined,
          dueDate,
          createdAt: pendingCreated || undefined,
          completedAt: done ? (pendingCompleted || pendingCreated || undefined) : undefined,
        });
      }
      pendingSource = null;
      pendingPeriod = null;
      pendingCreated = null;
      pendingCompleted = null;
    } else if (line.trim() && !line.startsWith("#")) {
      pendingSource = null;
      pendingPeriod = null;
      pendingCreated = null;
      pendingCompleted = null;
    }
  }

  return { items, rawContent, relPath: TODO_REL_PATH, processedPeriods: meta.processedPeriods, dismissed: meta.dismissed, dismissedAt: meta.dismissedAt };
}

/**
 * Serialize todo items back to markdown format.
 * Preserves frontmatter; rebuilds body with checkboxes.
 *
 * @param {TodoItem[]} items
 * @param {string} [prevContent] — previous file content (to preserve frontmatter)
 * @param {{ processedPeriods?: string[], dismissed?: string[], dismissedAt?: Record<string, string> }} [meta]
 * @returns {string}
 */
function serializeTodoList(items, prevContent, meta = {}) {
  const now = new Date().toISOString();
  const today = todayStr();

  const processedPeriods = meta.processedPeriods || [];
  const dismissed = meta.dismissed || [];
  const dismissedAt = meta.dismissedAt || {};

  let frontmatter = serializeFrontmatter(prevContent, processedPeriods, dismissed, dismissedAt);

  // Sort: active items by due date (overdue first), then undated; completed at bottom
  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  // Sort active: overdue first (by due date asc), then no due date
  active.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  let body = "# 我的待办\n\n";

  if (active.length === 0 && done.length === 0) {
    body += "<!-- 空列表：添加你的第一个待办 -->\n";
  } else {
    for (const item of active) {
      if (item.source && item.source !== "manual") {
        const parts = [`source: ${item.source}`];
        if (item.sourcePeriod) parts.push(`period: ${item.sourcePeriod}`);
        if (item.createdAt) parts.push(`created: ${item.createdAt}`);
        body += `<!-- ${parts.join(", ")} -->\n`;
      } else if (item.createdAt) {
        body += `<!-- created: ${item.createdAt} -->\n`;
      }
      const dueSuffix = item.dueDate ? formatDueDate(item.dueDate) : "";
      body += `- [ ] ${item.text}${dueSuffix}\n`;
    }
  }

  if (done.length > 0) {
    body += "\n## 已完成\n\n";
    for (const item of done) {
      if (item.completedAt) {
        body += `<!-- completed: ${item.completedAt} -->\n`;
      }
      const dueSuffix = item.dueDate ? formatDueDate(item.dueDate) : "";
      body += `- [x] ${item.text}${dueSuffix}\n`;
    }
  }

  return frontmatter + body;
}

/**
 * Write todo items to the file through writeback-engine.
 * @param {string} workspaceRoot
 * @param {TodoItem[]} items
 * @param {object} [contract]
 * @param {{ prevContent?: string, actor?: "user"|"ai", processedPeriods?: string[], dismissed?: string[], dismissedAt?: Record<string, string> }} [options]
 * @returns {{ ok: boolean, targetPath: string, writebackEvidence?: object }}
 */
export function writeTodoList(workspaceRoot, items, contract, options = {}) {
  const resolvedContract = contract || loadContract(workspaceRoot);
  const absPath = resolveTodoPath(workspaceRoot);
  const content = serializeTodoList(items, options.prevContent, {
    processedPeriods: options.processedPeriods,
    dismissed: options.dismissed,
    dismissedAt: options.dismissedAt,
  });

  const result = executeWrite({
    targetPath: absPath,
    content,
    workspaceRoot,
    contract: resolvedContract,
    operation: "create",
    actor: options.actor || "user",
    confirmed: true,
    role: "memory",
    skipBackup: options.actor === "user",
  });

  return {
    ok: result.wroteFiles !== false,
    targetPath: TODO_REL_PATH,
    writebackEvidence: result,
  };
}

/**
 * Add a new todo item. Deduplicates by text content.
 * Supports due date in text: "完成任务 📅 2026-08-01"
 * @param {string} workspaceRoot
 * @param {string} text
 * @param {{ source?: string, sourcePeriod?: string, contract?: object, actor?: "user"|"ai", dueDate?: string }} [options]
 * @returns {{ ok: boolean, item: TodoItem | null, items: TodoItem[], targetPath: string }}
 */
export function addTodoItem(workspaceRoot, text, options = {}) {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, item: null, items: [], targetPath: TODO_REL_PATH };

  // Parse due date from text if not explicitly provided
  const parsed = parseDueDate(trimmed);
  const dueDate = options.dueDate || parsed.dueDate;
  const cleanText = parsed.text;

  const existing = readTodoList(workspaceRoot);
  const items = existing?.items || [];
  const id = todoId(cleanText);

  if (items.some((i) => i.id === id)) {
    return { ok: false, item: null, items, targetPath: TODO_REL_PATH, reason: "duplicate" };
  }

  // Check against dismissed list — don't re-add user-deleted items
  const dismissed = existing?.dismissed || [];
  if (dismissed.includes(id)) {
    return { ok: false, item: null, items, targetPath: TODO_REL_PATH, reason: "dismissed" };
  }

  const newItem = {
    id,
    text: cleanText,
    done: false,
    source: options.source || "manual",
    sourcePeriod: options.sourcePeriod,
    dueDate,
    createdAt: todayStr(),
  };

  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const nextItems = [newItem, ...active, ...done].slice(0, MAX_ACTIVE_ITEMS + 20);

  const result = writeTodoList(workspaceRoot, nextItems, options.contract, {
    prevContent: existing?.rawContent,
    actor: options.actor || "user",
    processedPeriods: existing?.processedPeriods || [],
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
  });

  return { ok: result.ok, item: newItem, items: nextItems, targetPath: TODO_REL_PATH };
}

/**
 * Toggle a todo item's completion status.
 * When marking as done, sets completedAt. When un-toggling, clears it.
 * Optionally syncs completion to the stream.
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {object} [contract]
 * @param {{ syncToStream?: boolean, engineRoot?: string }} [options]
 * @returns {{ ok: boolean, items: TodoItem[], targetPath: string }}
 */
export function toggleTodoItem(workspaceRoot, id, contract, options = {}) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], targetPath: TODO_REL_PATH };

  const today = todayStr();
  const toggledItem = existing.items.find((i) => i.id === id);

  const items = existing.items.map((i) =>
    i.id === id
      ? { ...i, done: !i.done, completedAt: !i.done ? today : undefined }
      : i,
  );

  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const ordered = [...active, ...done];

  const result = writeTodoList(workspaceRoot, ordered, contract, {
    prevContent: existing.rawContent,
    actor: "user",
    processedPeriods: existing.processedPeriods || [],
    dismissed: existing.dismissed || [],
    dismissedAt: existing.dismissedAt || {},
  });

  // Sync completion to stream for user visibility
  if (options.syncToStream !== false && toggledItem && !toggledItem.done) {
    try {
      syncTodoToStream(workspaceRoot, options.engineRoot, contract, {
        action: "completed",
        text: toggledItem.text,
      });
    } catch {
      // Non-critical — don't fail the toggle
    }
  }

  return { ok: result.ok, items: ordered, targetPath: TODO_REL_PATH };
}

/**
 * Update a todo item's text and/or due date.
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {string} newText
 * @param {object} [contract]
 * @param {{ dueDate?: string | null }} [options]
 * @returns {{ ok: boolean, items: TodoItem[], targetPath: string }}
 */
export function updateTodoItem(workspaceRoot, id, newText, contract, options = {}) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], targetPath: TODO_REL_PATH };

  const parsed = parseDueDate(newText.trim());
  if (!parsed.text) return { ok: false, items: existing.items, targetPath: TODO_REL_PATH };

  // dueDate priority: explicit option > parsed from text > keep existing
  const dueDate = options.dueDate !== undefined
    ? (options.dueDate === null ? undefined : options.dueDate)
    : parsed.dueDate;

  const items = existing.items.map((i) =>
    i.id === id ? { ...i, text: parsed.text, id: todoId(parsed.text), dueDate } : i,
  );

  const result = writeTodoList(workspaceRoot, items, contract, {
    prevContent: existing.rawContent,
    actor: "user",
    processedPeriods: existing.processedPeriods || [],
    dismissed: existing.dismissed || [],
    dismissedAt: existing.dismissedAt || {},
  });

  return { ok: result.ok, items, targetPath: TODO_REL_PATH };
}

/**
 * Set due date for a todo item.
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {string | null} dueDate — ISO date or null to clear
 * @param {object} [contract]
 * @returns {{ ok: boolean, items: TodoItem[], targetPath: string }}
 */
export function setTodoDueDate(workspaceRoot, id, dueDate, contract) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], targetPath: TODO_REL_PATH };

  const items = existing.items.map((i) =>
    i.id === id ? { ...i, dueDate: dueDate || undefined } : i,
  );

  const result = writeTodoList(workspaceRoot, items, contract, {
    prevContent: existing.rawContent,
    actor: "user",
    processedPeriods: existing.processedPeriods || [],
    dismissed: existing.dismissed || [],
    dismissedAt: existing.dismissedAt || {},
  });

  return { ok: result.ok, items, targetPath: TODO_REL_PATH };
}

/**
 * Delete a todo item. Adds its hash to the dismissed list to prevent AI re-extraction.
 * @param {string} workspaceRoot
 * @param {string} id
 * @param {object} [contract]
 * @returns {{ ok: boolean, items: TodoItem[], targetPath: string }}
 */
export function deleteTodoItem(workspaceRoot, id, contract) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], targetPath: TODO_REL_PATH };

  const deletedItem = existing.items.find((i) => i.id === id);
  const items = existing.items.filter((i) => i.id !== id);

  // Add to dismissed list to prevent AI re-extraction
  const dismissed = [...(existing.dismissed || [])];
  const dismissedAt = { ...(existing.dismissedAt || {}) };
  if (deletedItem && !dismissed.includes(id)) {
    dismissed.push(id);
    dismissedAt[id] = todayStr();
  }

  const result = writeTodoList(workspaceRoot, items, contract, {
    prevContent: existing.rawContent,
    actor: "user",
    processedPeriods: existing.processedPeriods || [],
    dismissed,
    dismissedAt,
  });

  return { ok: result.ok, items, targetPath: TODO_REL_PATH };
}

/**
 * Clear all completed items (archive them away).
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @returns {{ ok: boolean, items: TodoItem[], cleared: number, targetPath: string }}
 */
export function clearCompleted(workspaceRoot, contract) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], cleared: 0, targetPath: TODO_REL_PATH };

  const before = existing.items.length;
  const items = existing.items.filter((i) => !i.done);
  const cleared = before - items.length;

  const result = writeTodoList(workspaceRoot, items, contract, {
    prevContent: existing.rawContent,
    actor: "user",
    processedPeriods: existing.processedPeriods || [],
    dismissed: existing.dismissed || [],
    dismissedAt: existing.dismissedAt || {},
  });

  return { ok: result.ok, items, cleared, targetPath: TODO_REL_PATH };
}

// ── Stale cleanup + Health ────────────────────────────────────────────────

/**
 * Get todo health metrics: overdue, stale, old completed items.
 * @param {string} workspaceRoot
 * @returns {TodoHealth | null}
 */
export function getTodoHealth(workspaceRoot) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return null;

  const items = existing.items;
  const today = todayStr();

  const active = items.filter((i) => !i.done);
  const completed = items.filter((i) => i.done);
  const overdue = active.filter((i) => i.dueDate && i.dueDate < today);
  const stale = active.filter((i) => {
    if (!i.createdAt) return false;
    return daysBetween(i.createdAt, today) > STALE_THRESHOLD_DAYS;
  });
  const oldCompleted = completed.filter((i) => {
    if (!i.completedAt) return false;
    return daysBetween(i.completedAt, today) > COMPLETED_AUTO_ARCHIVE_DAYS;
  });

  return {
    total: items.length,
    active: active.length,
    completed: completed.length,
    overdue: overdue.length,
    stale: stale.length,
    oldCompleted: oldCompleted.length,
    staleItems: stale.map((i) => i.text),
  };
}

/**
 * Clean up stale completed items — remove completed items older than threshold.
 * Also cleans up expired dismissed hashes.
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @returns {{ ok: boolean, items: TodoItem[], cleared: number, targetPath: string }}
 */
export function cleanupStaleTodos(workspaceRoot, contract) {
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], cleared: 0, targetPath: TODO_REL_PATH };

  const today = todayStr();

  // Remove completed items older than threshold
  const items = existing.items.filter((i) => {
    if (!i.done) return true;
    if (!i.completedAt) return true; // Keep if no completion date
    return daysBetween(i.completedAt, today) <= COMPLETED_AUTO_ARCHIVE_DAYS;
  });

  // Clean up expired dismissed hashes
  const dismissedAt = { ...(existing.dismissedAt || {}) };
  const dismissed = (existing.dismissed || []).filter((h) => {
    const date = dismissedAt[h];
    if (!date) return false; // No date → expired
    return daysBetween(date, today) < DISMISS_EXPIRY_DAYS;
  });

  const before = existing.items.length;
  const cleared = before - items.length;

  if (cleared === 0 && dismissed.length === (existing.dismissed || []).length) {
    return { ok: true, items: existing.items, cleared: 0, targetPath: TODO_REL_PATH, reason: "nothing-to-clean" };
  }

  const result = writeTodoList(workspaceRoot, items, contract, {
    prevContent: existing.rawContent,
    actor: "ai",
    processedPeriods: existing.processedPeriods || [],
    dismissed,
    dismissedAt,
  });

  return { ok: result.ok, items, cleared, targetPath: TODO_REL_PATH };
}

// ── Stream Sync ───────────────────────────────────────────────────────────

/**
 * Sync a todo state change to the current stream period note.
 * Appends a lightweight line to the current period note for user visibility.
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @param {{ action: "completed" | "added" | "deleted", text: string }} change
 * @returns {{ ok: boolean, relPath: string | null }}
 */
function syncTodoToStream(workspaceRoot, engineRoot, contract, change) {
  try {
    const target = resolveStreamTarget({ workspaceRoot, engineRoot, config: contract });
    if (!target?.periodAbsPath) return { ok: false, relPath: null };

    const emoji = change.action === "completed" ? "✅" : change.action === "added" ? "📝" : "🗑️";
    const label = change.action === "completed" ? "完成待办" : change.action === "added" ? "新增待办" : "删除待办";

    // Read existing body (after frontmatter)
    const raw = fs.existsSync(target.periodAbsPath)
      ? fs.readFileSync(target.periodAbsPath, "utf8")
      : "";
    let body = raw;
    const fmMatch = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
    if (fmMatch) body = body.slice(fmMatch[0].length);

    const newBody = appendToPeriodBody(body, {
      content: `${emoji} ${label}：${change.text}`,
      packing: target.packing,
      appendHeading: target.appendHeading || "day",
    });

    const fullContent = fmMatch ? fmMatch[0] + newBody : newBody;
    // Route through writeback-engine (protection gate) — lightweight append,
    // so skip backup/receipt to avoid noise (like editPath skipBackup design).
    executeWrite({
      targetPath: target.periodAbsPath,
      content: fullContent,
      workspaceRoot,
      contract: contract || loadContract(workspaceRoot),
      operation: "update",
      actor: "user",
      confirmed: true,
      role: "loose-stream",
      skipBackup: true,
      skipReceipt: true,
    });
    return { ok: true, relPath: target.periodRelPath };
  } catch {
    return { ok: false, relPath: null };
  }
}

// ── AI: Extraction + Maintenance ─────────────────────────────────────────

/**
 * Find notes for todo AI — activity window first (periods + touched + anchors),
 * falling back to N newest period files.
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @param {number} [depth=2] — period depth preference
 * @returns {{ absPath: string, relPath: string, period: string, content: string }[]}
 */
function findRecentPeriodNotes(workspaceRoot, engineRoot, contract, depth = MAINTAIN_PERIOD_DEPTH) {
  try {
    const win = resolveActivityWindow({
      workspaceRoot,
      engineRoot,
      contract,
      options: {
        windowDays: 14,
        maxPeriods: Math.max(depth, MAINTAIN_PERIOD_DEPTH),
        maxFiles: 12,
        minContentLength: 40,
        loadContent: true,
      },
    });
    const periods = periodItemsFromWindow(win)
      .filter((i) => (i.content || "").length >= 40)
      .map((i) => ({
        absPath: i.absPath,
        relPath: i.relPath,
        period: i.period || path.basename(i.relPath, ".md"),
        content: i.content || "",
      }));
    if (periods.length > 0) {
      // Also fold non-period activity (old notes touched / anchors) into the newest bucket
      // so maintainTodos prompt sees related originals, not only period files.
      const extras = win.items.filter(
        (i) => i.kind !== "period" && (i.content || "").length >= 40,
      );
      if (extras.length > 0 && periods[0]) {
        const corpus = buildActivityCorpus(
          { items: extras, meta: win.meta },
          { maxChars: 4000 },
        );
        if (corpus.trim()) {
          periods[0] = {
            ...periods[0],
            content: `${periods[0].content}\n\n## 相关活动材料\n\n${corpus}`,
          };
        }
      }
      return periods.slice(0, Math.max(depth, 1));
    }

    // Legacy fallback
    const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
    const streamCat = findStreamCategory(model);
    if (!streamCat?.path) return [];
    const dir = streamCat.path;
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    const mdFiles = fs.readdirSync(dir)
      .filter((f) => /^\d{4}-[WM]\d{2}\.md$/u.test(f) || /^\d{4}-\d{2}-\d{2}\.md$/u.test(f) || /^\d{4}-\d{2}\.md$/u.test(f))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, depth);

    return mdFiles.map((fileName) => {
      const absPath = path.join(dir, fileName);
      const content = fs.readFileSync(absPath, "utf8");
      const relPath = path.relative(workspaceRoot, absPath).replace(/\\/g, "/");
      const period = fileName.replace(/\.md$/u, "");
      return { absPath, relPath, period, content };
    }).filter((n) => n.content.length >= 40);
  } catch {
    return [];
  }
}

/**
 * Build a focused prompt for extracting actionable todo items from a period note.
 * @param {string} content
 * @param {string[]} dismissedTexts — texts of dismissed items to avoid re-extracting
 * @returns {string}
 */
function buildTodoExtractionPrompt(content, dismissedTexts = []) {
  const trimmed = content.length > 6000 ? content.slice(0, 6000) + "\n...（截断）" : content;
  const dismissedHint = dismissedTexts.length > 0
    ? `\n\n注意：以下待办已被用户删除，不要重新提取：\n${dismissedTexts.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `请从以下周期笔记中提取需要跟进的待办事项。${dismissedHint}

---
${trimmed}
---

请提取 1-8 条具体的、可执行的待办事项，每条一行，用简洁的祈使句或动宾短语。
只输出待办内容本身，不要加序号、前缀、思考过程或解释。不要使用 thinking 标签。
如果没有需要跟进的事项，输出空。
注意：只提取真正需要行动的事项，不要提取纯记录性内容。`;
}

/**
 * Extract todo items from the latest stream period note using AI.
 * Deduplicates against existing items and dismissed items.
 * Marks the period as processed to prevent re-extraction.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.contract]
 * @param {{ generate: (prompt: string, context?: object) => Promise<string> }} [options.aiProvider]
 * @param {{ force?: boolean }} [options.options] — force: re-process even if already processed
 * @returns {Promise<{ ok: boolean, extracted: TodoItem[], added: TodoItem[], skipped: number, period: string | null, targetPath: string }>}
 */
export async function extractTodosFromStream({ workspaceRoot, engineRoot, contract, aiProvider, options }) {
  const opts = options || {};
  const force = opts.force ?? false;
  const resolvedContract = contract || loadContract(workspaceRoot);
  ensureTodoFile(workspaceRoot);

  const notes = findRecentPeriodNotes(workspaceRoot, engineRoot, resolvedContract, 1);
  if (notes.length === 0) {
    return { ok: false, extracted: [], added: [], skipped: 0, period: null, targetPath: TODO_REL_PATH, reason: "no-period-note" };
  }

  const note = notes[0];

  if (!aiProvider || typeof aiProvider.generate !== "function") {
    return { ok: false, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "no-ai-provider" };
  }

  const existing = readTodoList(workspaceRoot);
  let processedPeriods = existing?.processedPeriods || [];

  // Force mode: clear this period from processed list
  if (force && processedPeriods.includes(note.period)) {
    processedPeriods = processedPeriods.filter(p => p !== note.period);
  }

  // Skip if this period was already processed
  if (processedPeriods.includes(note.period)) {
    return { ok: true, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "already-processed", processedPeriods };
  }

  // Get dismissed item texts for the prompt
  const dismissedIds = new Set(existing?.dismissed || []);
  const dismissedTexts = (existing?.items || []).filter((i) => dismissedIds.has(i.id)).map((i) => i.text);

  let aiText = "";
  try {
    aiText = await aiProvider.generate(buildTodoExtractionPrompt(note.content, dismissedTexts), {
      workspaceRoot,
      period: note.period,
      sourcePath: note.relPath,
    });
  } catch {
    return { ok: false, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "ai-failed" };
  }

  const { validateAiOutput } = await import("./ai-content-sanitize.mjs");
  const { lines } = validateAiOutput(aiText, "todo-lines", { minLen: 3, maxLen: 200 });

  if (lines.length === 0) {
    // Mark as processed even if no items found
    const updatedPeriods = [...processedPeriods, note.period].slice(-20);
    writeTodoList(workspaceRoot, existing?.items || [], resolvedContract, {
      prevContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
    });
    return { ok: true, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "no-items-found" };
  }

  const existingIds = new Set((existing?.items || []).map((i) => i.id));
  const dismissedSet = new Set(existing?.dismissed || []);

  /** @type {TodoItem[]} */
  const added = [];
  for (const text of lines) {
    const parsed = parseDueDate(text);
    const id = todoId(parsed.text);
    if (existingIds.has(id) || dismissedSet.has(id)) continue;
    added.push({
      id,
      text: parsed.text,
      done: false,
      source: "ai",
      sourcePeriod: note.period,
      dueDate: parsed.dueDate,
      createdAt: todayStr(),
    });
  }

  // Mark period as processed
  const updatedPeriods = [...processedPeriods, note.period].slice(-20);

  if (added.length === 0) {
    writeTodoList(workspaceRoot, existing?.items || [], resolvedContract, {
      prevContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
    });
    return { ok: true, extracted: [], added: [], skipped: lines.length, period: note.period, targetPath: TODO_REL_PATH, reason: "all-duplicates" };
  }

  const existingItems = existing?.items || [];
  const active = existingItems.filter((i) => !i.done);
  const done = existingItems.filter((i) => i.done);
  const merged = [...added, ...active, ...done].slice(0, MAX_ACTIVE_ITEMS + 20);

  const result = writeTodoList(workspaceRoot, merged, resolvedContract, {
    prevContent: existing?.rawContent,
    actor: "ai",
    processedPeriods: updatedPeriods,
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
  });

  return {
    ok: result.ok,
    extracted: added,
    added,
    skipped: lines.length - added.length,
    period: note.period,
    targetPath: TODO_REL_PATH,
  };
}

/**
 * Build a comprehensive prompt for AI maintenance of the todo list.
 * Unlike extraction, this also detects completed items and updates.
 *
 * @param {string} streamContent
 * @param {TodoItem[]} existingItems
 * @param {string} period
 * @param {string[]} dismissedTexts
 * @returns {string}
 */
function buildMaintenancePrompt(streamContent, existingItems, period, dismissedTexts = []) {
  const trimmed = streamContent.length > 6000 ? streamContent.slice(0, 6000) + "\n...（截断）" : streamContent;

  const activeItems = existingItems.filter((i) => !i.done);
  const todoList = activeItems.length > 0
    ? activeItems.map((i, idx) => `${idx + 1}. ${i.text}${i.dueDate ? ` (截止: ${i.dueDate})` : ""}`).join("\n")
    : "（空）";

  const dismissedHint = dismissedTexts.length > 0
    ? `\n\n注意：以下待办已被用户删除，不要重新提取：\n${dismissedTexts.map((t) => `- ${t}`).join("\n")}`
    : "";

  return `你是一个智能待办清单助手。请分析用户的周期笔记，维护现有待办清单。${dismissedHint}

## 周期笔记（${period}）
---
${trimmed}
---

## 现有待办清单
${todoList}

请执行以下维护操作：

1. **新增**：从笔记中提取新的待办事项（不在现有清单中的）
2. **完成**：检测笔记中明确提到已完成的待办（如"完成了X""X已搞定"）
3. **更新**：如果笔记中提到了某个待办的截止日期变化或内容更新

请用以下 JSON 格式输出（只输出 JSON，不要思考过程、thinking 标签或解释）：
\`\`\`json
{
  "add": ["新待办内容1", "新待办内容2"],
  "complete": ["现有待办的完整文本（匹配上面列表中的文本）"],
  "update": [{"old": "现有待办文本", "new": "更新后的文本", "dueDate": "YYYY-MM-DD"}]
}
\`\`\`

规则：
- add: 只提取真正需要行动的事项，每条简洁可执行
- complete: 必须精确匹配现有待办的文本（可以部分匹配关键词）
- update: 只在有明确变化时才更新
- 如果没有任何变化，输出 {"add": [], "complete": [], "update": []}`;
}

/**
 * Parse AI maintenance response JSON safely.
 * @param {string} aiText
 * @returns {{ add: string[], complete: string[], update: Array<{old: string, new: string, dueDate?: string}> }}
 */
function parseMaintenanceResponse(aiText) {
  // Extract JSON from code block or raw
  const jsonMatch = aiText.match(/```json\s*([\s\S]*?)```/u) || aiText.match(/(\{[\s\S]*\})/u);
  if (!jsonMatch) return { add: [], complete: [], update: [] };
  try {
    const parsed = JSON.parse(jsonMatch[1]);
    return {
      add: Array.isArray(parsed.add) ? parsed.add.filter((s) => typeof s === "string" && s.trim()) : [],
      complete: Array.isArray(parsed.complete) ? parsed.complete.filter((s) => typeof s === "string" && s.trim()) : [],
      update: Array.isArray(parsed.update) ? parsed.update.filter((u) => u && typeof u.old === "string" && typeof u.new === "string") : [],
    };
  } catch {
    return { add: [], complete: [], update: [] };
  }
}

/**
 * AI-powered todo maintenance: scan stream + update todo states.
 * Not just extraction — also detects completed items and updates.
 * Scans recent periods (up to MAINTAIN_PERIOD_DEPTH), skipping already-processed ones.
 * Marks processed periods to prevent re-extraction on subsequent runs.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} [options.engineRoot]
 * @param {object} [options.contract]
 * @param {{ generate: (prompt: string, context?: object) => Promise<string> }} [options.aiProvider]
 * @param {{ force?: boolean, depth?: number }} [options.options] — force: re-process; depth: periods to scan
 * @returns {Promise<{ ok: boolean, added: TodoItem[], completed: TodoItem[], updated: TodoItem[], period: string | null, targetPath: string, reason?: string }>}
 */
export async function maintainTodos({ workspaceRoot, engineRoot, contract, aiProvider, options }) {
  const opts = options || {};
  const depth = opts.depth ?? MAINTAIN_PERIOD_DEPTH;
  const force = opts.force ?? false;

  const resolvedContract = contract || loadContract(workspaceRoot);
  ensureTodoFile(workspaceRoot);

  const notes = findRecentPeriodNotes(workspaceRoot, engineRoot, resolvedContract, depth);
  if (notes.length === 0) {
    return { ok: false, added: [], completed: [], updated: [], period: null, targetPath: TODO_REL_PATH, reason: "no-period-note" };
  }

  if (!aiProvider || typeof aiProvider.generate !== "function") {
    return { ok: false, added: [], completed: [], updated: [], period: notes[0].period, targetPath: TODO_REL_PATH, reason: "no-ai-provider" };
  }

  const existing = readTodoList(workspaceRoot);
  const existingItems = existing?.items || [];
  let processedPeriods = existing?.processedPeriods || [];

  // Force mode: clear the periods we're about to re-scan
  if (force) {
    const periodsToClear = notes.map(n => n.period);
    processedPeriods = processedPeriods.filter(p => !periodsToClear.includes(p));
  }

  // Filter to only unprocessed periods
  const unprocessedNotes = notes.filter((n) => !processedPeriods.includes(n.period));
  if (unprocessedNotes.length === 0) {
    return {
      ok: true,
      added: [],
      completed: [],
      updated: [],
      period: notes[0].period,
      targetPath: TODO_REL_PATH,
      reason: "all-periods-processed",
      processedPeriods,
    };
  }

  // Get dismissed item texts for the prompt
  const dismissedIds = new Set(existing?.dismissed || []);
  const dismissedTexts = existingItems.filter((i) => dismissedIds.has(i.id)).map((i) => i.text);

  // Use the latest unprocessed note for maintenance
  const note = unprocessedNotes[0];

  let aiText = "";
  try {
    aiText = await aiProvider.generate(
      buildMaintenancePrompt(note.content, existingItems, note.period, dismissedTexts),
      { workspaceRoot, period: note.period, sourcePath: note.relPath },
    );
  } catch {
    return { ok: false, added: [], completed: [], updated: [], period: note.period, targetPath: TODO_REL_PATH, reason: "ai-failed" };
  }

  // Parse JSON from raw model text first — do NOT run whole-payload sanitize
  // (that would wipe tool JSON dumps). Sanitize each add line individually.
  const { sanitizeAiContent, isPlaceholderOrPolluted } = await import("./ai-content-sanitize.mjs");
  const plan = parseMaintenanceResponse(aiText);
  plan.add = plan.add
    .map((t) => sanitizeAiContent(t))
    .filter((t) => t && !isPlaceholderOrPolluted(t) && t.length >= 3 && t.length < 200);

  // Apply changes immutably — never mutate objects from existingItems
  let items = existingItems.map((i) => ({ ...i }));
  /** @type {TodoItem[]} */
  const added = [];
  /** @type {TodoItem[]} */
  const completed = [];
  /** @type {TodoItem[]} */
  const updated = [];

  // Track which indices have been modified to avoid double-matching
  const matchedIndices = new Set();

  // Process completions: match by text similarity (substring works for CJK + Latin)
  for (const completeText of plan.complete) {
    const lower = completeText.toLowerCase();
    const idx = items.findIndex((i, idx) =>
      !i.done && !matchedIndices.has(idx) && (
        i.text.toLowerCase().includes(lower) ||
        lower.includes(i.text.toLowerCase()) ||
        // Word-based fallback for Latin text (split on whitespace)
        i.text.toLowerCase().split(/\s+/).some((w) => w.length > 2 && lower.includes(w))
      ),
    );
    if (idx >= 0) {
      items[idx] = { ...items[idx], done: true, completedAt: todayStr() };
      matchedIndices.add(idx);
      completed.push(items[idx]);
    }
  }

  // Process updates: match by old text
  for (const upd of plan.update) {
    const lower = upd.old.toLowerCase();
    const idx = items.findIndex((i, idx2) =>
      !i.done && !matchedIndices.has(idx2) && (
        i.text.toLowerCase() === lower ||
        i.text.toLowerCase().includes(lower) ||
        lower.includes(i.text.toLowerCase())
      ),
    );
    if (idx >= 0) {
      const parsed = parseDueDate(upd.new);
      const updatedItem = {
        ...items[idx],
        text: parsed.text,
        id: todoId(parsed.text),
        dueDate: upd.dueDate || parsed.dueDate || items[idx].dueDate,
      };
      items[idx] = updatedItem;
      matchedIndices.add(idx);
      updated.push(updatedItem);
    }
  }

  // Process additions: deduplicate against current items + dismissed list
  const currentIds = new Set(items.map((i) => i.id));
  const dismissedSet = new Set(existing?.dismissed || []);
  for (const text of plan.add) {
    const parsed = parseDueDate(text);
    if (parsed.text.length < 3 || parsed.text.length > 200) continue;
    const id = todoId(parsed.text);
    if (currentIds.has(id) || dismissedSet.has(id)) continue;
    const newItem = {
      id,
      text: parsed.text,
      done: false,
      source: "ai",
      sourcePeriod: note.period,
      dueDate: parsed.dueDate,
      createdAt: todayStr(),
    };
    items.unshift(newItem);
    added.push(newItem);
    currentIds.add(id);
  }

  // Mark period as processed
  const updatedPeriods = [...processedPeriods, note.period].slice(-20);

  // Only write if something changed (or period needs to be marked processed)
  if (added.length === 0 && completed.length === 0 && updated.length === 0) {
    // Still write to mark the period as processed
    writeTodoList(workspaceRoot, items, resolvedContract, {
      prevContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
    });
    return {
      ok: true,
      added: [],
      completed: [],
      updated: [],
      period: note.period,
      targetPath: TODO_REL_PATH,
      reason: "no-changes",
    };
  }

  // Reorder: active first (sorted by due date), then done
  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  active.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const ordered = [...active, ...done].slice(0, MAX_ACTIVE_ITEMS + 20);

  const result = writeTodoList(workspaceRoot, ordered, resolvedContract, {
    prevContent: existing?.rawContent,
    actor: "ai",
    processedPeriods: updatedPeriods,
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
  });

  return {
    ok: result.ok,
    added,
    completed,
    updated,
    period: note.period,
    targetPath: TODO_REL_PATH,
  };
}
