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
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MAX_FILES,
} from "./activity-window.mjs";
import { resolveAiLocale, resolveProductAiLanguage } from "./ai-content-sanitize.mjs";

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

/**
 * Compute a content hash for change detection (same algo as ai-operation-engine).
 * @param {string} content
 * @returns {string}
 */
function contentHash(content) {
  return createHash("sha1").update(String(content || "")).digest("hex").slice(0, 16);
}

/** Number of recent periods to scan for AI maintenance. */
const MAINTAIN_PERIOD_DEPTH = 4;

/**
 * Bilingual prompt templates for todo extraction and maintenance.
 * Locale is resolved from workspace contract; AI output language follows.
 */
const L10N = {
  zh: {
    extractIntro: "请从以下周期笔记及相关活动材料中深入分析并提取需要跟进的待办事项。\n不是简单匹配包含「待办」「任务」等关键字的行，而是理解全部内容的语义，找出真正需要行动的事项。\n注意：「相关活动材料」部分包含近期编辑的笔记、专题文件等，同样需要参考其中可能隐含的行动项。",
    extractDismissedHint: (texts) => `\n\n注意：以下待办已被用户删除，不要重新提取：\n${texts.map((t) => `- ${t}`).join("\n")}`,
    extractRules: `- 只输出待办内容本身，不要加序号、前缀、思考过程或解释\n- 不要使用 thinking 标签或 markdown 代码围栏\n- 用中文输出\n- 如果没有需要跟进的事项，不输出任何内容\n注意：基于全文语义分析，只提取真正需要行动的事项，不要提取纯记录性内容。\n- 事项可以是隐含的（如“周三截止”暗含“周三前完成某事”），需要从语义推断。`,
    maintainIntro: "维护待办清单。\n请同时参考周期笔记和「相关活动材料」中的内容，全面检查是否有新的待办、已完成的待办、或需更新的待办。",
    maintainDismissedHint: (n, texts) => n <= 5
      ? `\n勿重复提取已删项：${texts.map((t) => t.slice(0, 30)).join(" / ")}`
      : `\n勿重复提取已删项（${n}条）`,
    maintainDedupHint: (items) => `\n注意：以下待办已存在较久，新提取时请检查是否语义重复：${items.map((i) => `"${i.text.slice(0, 25)}"`).join(" / ")}`,
    maintainNoteLabel: "笔记",
    maintainTodoLabel: "待办",
    maintainTodoActive: (n) => `${n}条活跃`,
    maintainOps: `操作：\n1. 新增：笔记中需跟进的新事项\n2. 完成：笔记明确提到已完成的待办\n3. 更新：截止日期或内容变化`,
    maintainJsonFormat: '严格输出 JSON（不要 markdown 围栏、不要思考过程、不要 thinking 标签）：\n{"add":["新待办"],"complete":["匹配现有文本"],"update":[{"old":"旧","new":"新","dueDate":"YYYY-MM-DD"}]}\n无变化则 {"add":[],"complete":[],"update":[]}\n待办内容用中文输出。',
    todoListEmpty: "（空）",
    overdueLabel: (d) => ` ⚠逾期${d}`,
    dueLabel: (d) => ` 📅${d}`,
    truncated: "...（截断）",
  },
  en: {
    extractIntro: "Deeply analyze the following period note and related activity materials to extract actionable todo items.\nDo not simply match lines containing 'todo' or 'task' keywords — understand the full semantic context and identify what genuinely requires action.\nNote: The 'Related Activity Materials' section contains recently edited notes and topic files — also check these for implicit action items.",
    extractDismissedHint: (texts) => `\n\nNote: The following todos were deleted by the user; do NOT re-extract them:\n${texts.map((t) => `- ${t}`).join("\n")}`,
    extractRules: `- Output only the todo text itself; no numbering, prefixes, thinking process, or explanations\n- Do NOT use thinking tags or markdown code fences\n- Output in English\n- If no actionable items are found, output nothing\nOnly extract items that genuinely require action — do not extract purely informational content.\n- Items may be implicit (e.g., "deadline Wednesday" implies "complete something by Wednesday") — infer from semantic context.`,
    maintainIntro: "Maintain the todo list.\nReview both the period note and 'Related Activity Materials' section — check for new todos, completed items, or items needing updates across all provided content.",
    maintainDismissedHint: (n, texts) => n <= 5
      ? `\nDo not re-extract deleted items: ${texts.map((t) => t.slice(0, 30)).join(" / ")}`
      : `\nDo not re-extract ${n} deleted items`,
    maintainDedupHint: (items) => `\nNote: These todos have existed for a while; check for semantic duplicates before extracting: ${items.map((i) => `"${i.text.slice(0, 25)}"`).join(" / ")}`,
    maintainNoteLabel: "Note",
    maintainTodoLabel: "Todos",
    maintainTodoActive: (n) => `${n} active`,
    maintainOps: `Actions:\n1. Add: new actionable items from the note\n2. Complete: items the note explicitly marks as done\n3. Update: due date or content changes`,
    maintainJsonFormat: 'Output strictly JSON (no markdown fences, no thinking process, no thinking tags):\n{"add":["new todo"],"complete":["match existing text"],"update":[{"old":"old","new":"new","dueDate":"YYYY-MM-DD"}]}\nNo changes: {"add":[],"complete":[],"update":[]}\nOutput todo content in English.',
    todoListEmpty: "(empty)",
    overdueLabel: (d) => ` ⚠overdue ${d}`,
    dueLabel: (d) => ` 📅${d}`,
    truncated: "...(truncated)",
  },
};

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
 * @returns {{ processedPeriods: string[], dismissed: string[], dismissedAt: Record<string, string>, dismissedTexts: Record<string, string> }}
 */
function parseFrontmatterMeta(rawContent) {
  const result = { processedPeriods: [], dismissed: [], dismissedAt: {}, dismissedTexts: {} };
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

  // Parse dismissed_texts (map of hash → text) for AI anti-re-extraction hints
  const disTextsBlock = fm.match(/dismissed_texts:\s*\n((?:\s+-\s+.+\n?)+)/u);
  if (disTextsBlock) {
    const entries = disTextsBlock[1].match(/-\s+"?([^":]+)"?\s*:\s*"?(.+?)"?\s*$/gmu) || [];
    for (const entry of entries) {
      const m = entry.match(/-\s+"?([^":]+)"?\s*:\s*"?(.+?)"?\s*$/u);
      if (m) result.dismissedTexts[m[1].trim()] = m[2].trim();
    }
  }

  // Parse processed_hashes (inline mapping: {"period": "hash"})
  result.processedHashes = {};
  const phMatch = fm.match(/processed_hashes:\s*(\{[^}]*\})/u);
  if (phMatch) {
    const phEntries = phMatch[1].match(/"([^"]+)"\s*:\s*"([^"]+)"/gu) || [];
    for (const entry of phEntries) {
      const m = entry.match(/"([^"]+)"\s*:\s*"([^"]+)"/u);
      if (m) result.processedHashes[m[1].trim()] = m[2].trim();
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
 * @param {Record<string, string>} [processedHashes={}]
 * @param {Record<string, string>} [dismissedTexts={}]
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function serializeFrontmatter(prevContent, processedPeriods, dismissed, dismissedAt, processedHashes = {}, dismissedTexts = {}, locale = "zh") {
  const now = new Date().toISOString();
  const H = todoHeadings(locale === "en" ? "en" : "zh");
  const ppLine = `processed_periods: [${processedPeriods.map((p) => `"${p}"`).join(", ")}]`;
  const disLine = `dismissed: [${dismissed.map((d) => `"${d}"`).join(", ")}]`;
  const phEntries = Object.entries(processedHashes).filter(([k, v]) => v && processedPeriods.includes(k));
  const phLine = phEntries.length > 0
    ? `processed_hashes: {${phEntries.map(([k, v]) => `"${k}": "${v}"`).join(", ")}}`
    : `processed_hashes: {}`;

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
    `title: ${H.title}`,
    "memory_layer: global",
    "protection: open",
    "source_type: user-original",
    `updated_at: "${now}"`,
    ppLine,
    disLine,
    phLine,
  ];

  if (Object.keys(validDismissedAt).length > 0) {
    defaultLines.push("dismissed_at:");
    for (const [hash, date] of Object.entries(validDismissedAt)) {
      defaultLines.push(`  - "${hash}": "${date}"`);
    }
  }
  // Persist dismissed_texts so AI can see what was deleted (anti-re-extraction)
  // Only keep texts for non-expired dismissed hashes
  const validDismissedTexts = {};
  for (const [hash, text] of Object.entries(dismissedTexts)) {
    if (validDismissedAt[hash]) {
      validDismissedTexts[hash] = text;
    }
  }
  if (Object.keys(validDismissedTexts).length > 0) {
    defaultLines.push("dismissed_texts:");
    for (const [hash, text] of Object.entries(validDismissedTexts)) {
      const safeText = String(text).replace(/"/gu, "'").slice(0, 200);
      defaultLines.push(`  - "${hash}": "${safeText}"`);
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
        "updated_at", "processed_periods", "dismissed", "dismissed_at", "dismissed_texts", "processed_hashes",
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
 * Locale-aware headings for durable todo.md.
 * @param {"en"|"zh"} [locale="zh"]
 */
function todoHeadings(locale = "zh") {
  if (locale === "en") {
    return {
      title: "My Todos",
      h1: "My Todos",
      done: "Completed",
      emptyComment: "<!-- empty list: add your first todo -->",
    };
  }
  return {
    title: "我的待办",
    h1: "我的待办",
    done: "已完成",
    emptyComment: "<!-- 空列表：添加你的第一个待办 -->",
  };
}

/**
 * Seed content for a new todo file.
 * @param {"en"|"zh"|string} [locale="zh"]
 * @returns {string}
 */
function seedTodoContent(locale = "zh") {
  const lang = locale === "en" || String(locale).startsWith("en") ? "en" : "zh";
  const H = todoHeadings(lang);
  const now = new Date().toISOString();
  return `---
title: ${H.title}
memory_layer: global
protection: open
source_type: user-original
updated_at: "${now}"
processed_periods: []
dismissed: []
---

# ${H.h1}

`;
}

/**
 * Ensure the todo file exists. Creates with seed content if missing.
 * Locale for seed headings comes from workspace contract (default zh).
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @returns {{ absPath: string, relPath: string, created: boolean }}
 */
export function ensureTodoFile(workspaceRoot, contract) {
  ensureMemoryPlane(workspaceRoot);
  const absPath = resolveTodoPath(workspaceRoot);
  if (fs.existsSync(absPath)) {
    return { absPath, relPath: TODO_REL_PATH, created: false };
  }
  const resolved = contract || loadContract(workspaceRoot);
  executeWrite({
    targetPath: absPath,
    content: seedTodoContent(resolveAiLocale(resolved)),
    workspaceRoot,
    contract: resolved,
    operation: "create",
    actor: "user",
    confirmed: true,
    role: "memory",
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

  return { items, rawContent, relPath: TODO_REL_PATH, processedPeriods: meta.processedPeriods, dismissed: meta.dismissed, dismissedAt: meta.dismissedAt, dismissedTexts: meta.dismissedTexts || {}, processedHashes: meta.processedHashes || {} };
}

/**
 * Serialize todo items back to markdown format.
 * Preserves frontmatter; rebuilds body with checkboxes.
 * Headings follow contract locale (zh default).
 *
 * @param {TodoItem[]} items
 * @param {string} [prevContent] — previous file content (to preserve frontmatter)
 * @param {{ processedPeriods?: string[], dismissed?: string[], dismissedAt?: Record<string, string>, dismissedTexts?: Record<string, string>, processedHashes?: Record<string, string>, locale?: "en"|"zh" }} [meta]
 * @returns {string}
 */
function serializeTodoList(items, prevContent, meta = {}) {
  const locale = meta.locale === "en" ? "en" : "zh";
  const H = todoHeadings(locale);

  const processedPeriods = meta.processedPeriods || [];
  const dismissed = meta.dismissed || [];
  const dismissedAt = meta.dismissedAt || {};
  const processedHashes = meta.processedHashes || {};
  const dismissedTexts = meta.dismissedTexts || {};

  let frontmatter = serializeFrontmatter(prevContent, processedPeriods, dismissed, dismissedAt, processedHashes, dismissedTexts, locale);

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

  let body = `# ${H.h1}\n\n`;

  if (active.length === 0 && done.length === 0) {
    body += `${H.emptyComment}\n`;
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
    body += `\n## ${H.done}\n\n`;
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
 * Build writeTodoList options from existing state, reducing repetition.
 * Carries forward processedPeriods / dismissed / hashes from the prior read.
 * @param {{ rawContent?: string, processedPeriods?: string[], processedHashes?: Record<string, string>, dismissed?: string[], dismissedAt?: Record<string, string>, dismissedTexts?: Record<string, string> } | null} existing
 * @param {"user"|"ai"} [actor="user"]
 * @param {Partial<{ processedPeriods: string[], processedHashes: Record<string, string>, dismissed: string[], dismissedAt: Record<string, string>, dismissedTexts: Record<string, string> }>} [overrides]
 * @returns {{ prevContent?: string, actor: string, processedPeriods: string[], processedHashes: Record<string, string>, dismissed: string[], dismissedAt: Record<string, string>, dismissedTexts: Record<string, string> }}
 */
function buildWriteOptions(existing, actor = "user", overrides = {}) {
  return {
    prevContent: existing?.rawContent,
    actor,
    processedPeriods: overrides.processedPeriods ?? existing?.processedPeriods ?? [],
    processedHashes: overrides.processedHashes ?? existing?.processedHashes ?? {},
    dismissed: overrides.dismissed ?? existing?.dismissed ?? [],
    dismissedAt: overrides.dismissedAt ?? existing?.dismissedAt ?? {},
    dismissedTexts: overrides.dismissedTexts ?? existing?.dismissedTexts ?? {},
  };
}

/**
 * Write todo items to the file through writeback-engine.
 * @param {string} workspaceRoot
 * @param {TodoItem[]} items
 * @param {object} [contract]
 * @param {{ prevContent?: string, actor?: "user"|"ai", processedPeriods?: string[], dismissed?: string[], dismissedAt?: Record<string, string>, dismissedTexts?: Record<string, string>, processedHashes?: Record<string, string> }} [options]
 * @returns {{ ok: boolean, targetPath: string, writebackEvidence?: object }}
 */
export function writeTodoList(workspaceRoot, items, contract, options = {}) {
  const resolvedContract = contract || loadContract(workspaceRoot);
  const absPath = resolveTodoPath(workspaceRoot);
  // Lost-update guard: AI flows read the list, await a model call (seconds),
  // then serialize the stale snapshot. If the file changed in that window
  // (UI toggle, manual edit, second run), refuse instead of clobbering.
  if (options.expectedRawContent !== undefined) {
    const currentRaw = fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : null;
    if (currentRaw !== options.expectedRawContent) {
      return {
        ok: false,
        targetPath: TODO_REL_PATH,
        reason: "concurrent-modification",
      };
    }
  }
  const locale = resolveAiLocale(resolvedContract);
  const content = serializeTodoList(items, options.prevContent, {
    processedPeriods: options.processedPeriods,
    dismissed: options.dismissed,
    dismissedAt: options.dismissedAt,
    dismissedTexts: options.dismissedTexts,
    processedHashes: options.processedHashes,
    locale,
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
    processedHashes: existing?.processedHashes || {},
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
    dismissedTexts: existing?.dismissedTexts || {},
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

  const result = writeTodoList(workspaceRoot, ordered, contract, buildWriteOptions(existing));

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

  const result = writeTodoList(workspaceRoot, items, contract, buildWriteOptions(existing));

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

  const result = writeTodoList(workspaceRoot, items, contract, buildWriteOptions(existing));

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
  const dismissedTexts = { ...(existing.dismissedTexts || {}) };
  if (deletedItem && !dismissed.includes(id)) {
    dismissed.push(id);
    dismissedAt[id] = todayStr();
    dismissedTexts[id] = deletedItem.text;
  }

  const result = writeTodoList(workspaceRoot, items, contract,
    buildWriteOptions(existing, "user", { dismissed, dismissedAt, dismissedTexts }),
  );

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

  const result = writeTodoList(workspaceRoot, items, contract, buildWriteOptions(existing));

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

  // Clean up expired dismissed hashes + their texts
  const dismissedAt = { ...(existing.dismissedAt || {}) };
  const validDismissedSet = new Set();
  const dismissed = (existing.dismissed || []).filter((h) => {
    const date = dismissedAt[h];
    if (!date) return false; // No date → expired
    if (daysBetween(date, today) < DISMISS_EXPIRY_DAYS) {
      validDismissedSet.add(h);
      return true;
    }
    return false;
  });
  // Only keep texts for non-expired dismissed hashes
  const dismissedTexts = {};
  for (const h of validDismissedSet) {
    if (existing.dismissedTexts?.[h]) dismissedTexts[h] = existing.dismissedTexts[h];
  }

  const before = existing.items.length;
  const cleared = before - items.length;

  if (cleared === 0 && dismissed.length === (existing.dismissed || []).length) {
    return { ok: true, items: existing.items, cleared: 0, targetPath: TODO_REL_PATH, reason: "nothing-to-clean" };
  }

  const result = writeTodoList(workspaceRoot, items, contract,
    buildWriteOptions(existing, "ai", { dismissed, dismissedAt, dismissedTexts }),
  );

  return { ok: result.ok, items, cleared, targetPath: TODO_REL_PATH };
}

/**
 * Archive stale active todos (older than threshold) to a periodic snapshot.
 * Archived items are removed from the active list and written to
 * memory/periodic/todo-history/{period}-archived.md for traceability.
 * @param {string} workspaceRoot
 * @param {object} [contract]
 * @param {{ staleDays?: number }} [options]
 * @returns {{ ok: boolean, items: TodoItem[], archived: TodoItem[], targetPath: string }}
 */
export function archiveStaleTodos(workspaceRoot, contract, options = {}) {
  const staleDays = options.staleDays ?? STALE_THRESHOLD_DAYS;
  const existing = readTodoList(workspaceRoot);
  if (!existing) return { ok: false, items: [], archived: [], targetPath: TODO_REL_PATH };
  const locale = resolveAiLocale(contract);

  const today = todayStr();
  const toArchive = existing.items.filter((i) => {
    if (i.done || !i.createdAt) return false;
    return daysBetween(i.createdAt, today) > staleDays;
  });

  if (toArchive.length === 0) {
    return { ok: true, items: existing.items, archived: [], targetPath: TODO_REL_PATH, reason: "nothing-to-archive" };
  }

  // Write archive snapshot
  const archiveDir = path.join(workspaceRoot, "memory", "periodic", "todo-history");
  fs.mkdirSync(archiveDir, { recursive: true });
  const period = today.slice(0, 7); // YYYY-MM
  const archivePath = path.join(archiveDir, `${period}-archived.md`);
  const newItems = toArchive.map((i) =>
    `- [ ] ${i.text}${i.dueDate ? ` 📅 ${i.dueDate}` : ""} <!-- created: ${i.createdAt || "?"} -->`,
  ).join("\n");

  const archiveContent = fs.existsSync(archivePath)
    ? (() => {
        const prev = fs.readFileSync(archivePath, "utf8");
        const prevCountMatch = prev.match(/count:\s*(\d+)/u);
        const prevCount = prevCountMatch ? parseInt(prevCountMatch[1], 10) : 0;
        const updated = prev
          .replace(/count:\s*\d+/u, `count: ${prevCount + toArchive.length}`)
          .replace(/archived_at:\s*[^\n]+/u, `archived_at: ${new Date().toISOString()}`);
        return `${updated.trimEnd()}\n\n## 归档会话 ${new Date().toISOString()}\n\n${newItems}\n`;
      })()
    : `---\nperiod: ${period}\narchived_at: ${new Date().toISOString()}\ncount: ${toArchive.length}\n---\n\n# ${locale === "en" ? `Archived Todos ${period}` : `归档待办 ${period}`}\n\n${newItems}\n`;
  executeWrite({
    targetPath: archivePath,
    content: archiveContent,
    workspaceRoot,
    contract: contract || loadContract(workspaceRoot),
    operation: "update",
    actor: "ai",
    confirmed: true,
    role: "memory",
  });

  // Remove archived items from active list
  const archivedIds = new Set(toArchive.map((i) => i.id));
  const items = existing.items.filter((i) => !archivedIds.has(i.id));

  const result = writeTodoList(workspaceRoot, items, contract, buildWriteOptions(existing, "ai"));

  return { ok: result.ok, items, archived: toArchive, targetPath: TODO_REL_PATH };
}

/**
 * Save a periodic snapshot of the todo list to memory/periodic/todo-history/.
 * Called after AI maintenance to provide a historical record.
 * @param {string} workspaceRoot
 * @param {TodoItem[]} items
 * @param {string} period
 */
export function snapshotTodoList(workspaceRoot, items, period, contract) {
  try {
    const archiveDir = path.join(workspaceRoot, "memory", "periodic", "todo-history");
    fs.mkdirSync(archiveDir, { recursive: true });
    const snapshotPath = path.join(archiveDir, `${period}.md`);

    // Skip if snapshot already exists for this period
    if (fs.existsSync(snapshotPath)) return;

    const locale = resolveAiLocale(contract);
    const active = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    const now = new Date().toISOString();

    const heading = locale === "en" ? `Todo Snapshot ${period}` : `待办快照 ${period}`;
    const doneHeading = locale === "en" ? `Completed This Period` : `本期完成`;
    const activeHeading = locale === "en" ? `Still Active` : `仍活跃`;
    const emptyLabel = locale === "en" ? "(none)" : "（无）";
    const content = `---\nperiod: ${period}\nsnapshot_at: ${now}\nactive_count: ${active.length}\ncompleted_count: ${done.length}\n---\n\n# ${heading}\n\n## ${doneHeading} (${done.length})\n${done.length > 0 ? done.map((i) => `- [x] ${i.text}`).join("\n") : emptyLabel}\n\n## ${activeHeading} (${active.length})\n${active.length > 0 ? active.map((i) => `- [ ] ${i.text}${i.dueDate ? ` 📅 ${i.dueDate}` : ""}`).join("\n") : emptyLabel}\n`;
    executeWrite({
      targetPath: snapshotPath,
      content,
      workspaceRoot,
      contract: contract || loadContract(workspaceRoot),
      operation: "create",
      actor: "ai",
      confirmed: true,
      role: "memory",
    });
  } catch {
    // Non-critical — snapshot is best-effort
  }
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

    const locale = resolveAiLocale(contract);
    const emoji = change.action === "completed" ? "✅" : change.action === "added" ? "📝" : "🗑️";
    const label = change.action === "completed"
      ? (locale === "en" ? "Completed todo" : "完成待办")
      : change.action === "added"
      ? (locale === "en" ? "Added todo" : "新增待办")
      : (locale === "en" ? "Deleted todo" : "删除待办");

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
    // Route through writeback-engine (protection gate). Open stream notes: no backup.
    executeWrite({
      targetPath: target.periodAbsPath,
      content: fullContent,
      workspaceRoot,
      contract: contract || loadContract(workspaceRoot),
      operation: "update",
      actor: "user",
      confirmed: true,
      role: "loose-stream",
    });
    return { ok: true, relPath: target.periodRelPath };
  } catch {
    return { ok: false, relPath: null };
  }
}

// ── AI: Extraction + Maintenance ─────────────────────────────────────────

/** Marker heading used when folding non-period activity into the todo AI corpus. */
export const ACTIVITY_EXTRAS_HEADING = "## 相关活动材料";

/** Extract prompt budget (chars of period∪extras body inside the fence).
 * Aligns with suggest-engine SUGGEST_CORPUS_MAX_CHARS; keeps full semantic
 * context including activity extras (not keyword-filtered). */
export const EXTRACT_CORPUS_MAX = 16000;
/** Maintain prompt stream-body budget.
 * Enough for full period body + activity extras. */
export const MAINTAIN_CORPUS_MAX = 12000;
/** Folded non-period extras budget inside extract/maintain notes. */
const EXTRAS_CORPUS_MAX = 8000;

/**
 * Prompt corpus for a period note: period body + optional folded activity extras.
 * Skip/hash decisions MUST use this string (not raw period-only content), or new
 * activity-window material is ignored while the period file hash stays stable.
 * @param {{ content?: string, extrasCorpus?: string, rawContent?: string }} note
 * @returns {string}
 */
export function notePromptCorpus(note) {
  if (!note || typeof note !== "object") return "";
  const base = String(note.rawContent ?? note.content ?? "");
  const extra = String(note.extrasCorpus || "").trim();
  if (!extra) return base;
  // Avoid double-fold if content already includes the extras block
  if (String(note.content || "").includes(extra)) {
    return String(note.content || base);
  }
  return `${base}\n\n${ACTIVITY_EXTRAS_HEADING}\n\n${extra}`;
}

/**
 * Split a folded corpus into period body vs activity-extras section.
 * @param {string} content
 * @returns {{ base: string, extras: string }}
 */
export function splitPeriodAndExtras(content) {
  const text = String(content || "");
  const marker = `\n${ACTIVITY_EXTRAS_HEADING}\n`;
  const idx = text.indexOf(marker);
  if (idx >= 0) {
    return { base: text.slice(0, idx), extras: text.slice(idx + 1) };
  }
  if (text.startsWith(`${ACTIVITY_EXTRAS_HEADING}\n`)) {
    return { base: "", extras: text };
  }
  return { base: text, extras: "" };
}

/**
 * Fit period∪extras into maxChars **without dropping activity extras first**.
 * Long period bodies used to sit in front and `slice(0, N)` / keyword-fill
 * erased `## 相关活动材料` while the skip hash still covered the full corpus
 * — latest activity never reached the model, then skip hid it permanently.
 *
 * @param {string} content — full notePromptCorpus
 * @param {number} maxChars
 * @param {{ locale?: "en"|"zh" }} [opts]
 * @returns {string}
 */
export function budgetTodoPromptCorpus(content, maxChars, opts = {}) {
  const locale = opts.locale === "en" ? "en" : "zh";
  const L = L10N[locale] || L10N.zh;
  const text = String(content || "");
  if (text.length <= maxChars) return text;

  const { base, extras } = splitPeriodAndExtras(text);
  const extrasRaw = extras.trim();
  // Reserve a solid slice for extras (latest material); never below 1800 when extras exist
  // unless maxChars itself is smaller.
  const extrasCap = extrasRaw
    ? Math.min(extrasRaw.length, Math.max(Math.min(2400, maxChars - 600), Math.floor(maxChars * 0.4)))
    : 0;
  let extrasOut = extrasRaw;
  if (extrasOut && extrasOut.length > extrasCap) {
    extrasOut = `${extrasOut.slice(0, Math.max(0, extrasCap - 20))}\n${L.truncated}`;
  }
  const sep = extrasOut ? 2 : 0; // \n\n
  const baseBudget = Math.max(200, maxChars - (extrasOut ? extrasOut.length : 0) - sep);
  // Use smart corpus budgeting (preserves structural completeness, not keyword-filtered)
  let baseOut = smartBudgetCorpus(base, baseBudget, locale);
  if (!extrasOut) return baseOut.length > maxChars ? `${baseOut.slice(0, maxChars - 20)}\n${L.truncated}` : baseOut;
  if (!baseOut.trim()) {
    return extrasOut.length > maxChars ? `${extrasOut.slice(0, maxChars - 20)}\n${L.truncated}` : extrasOut;
  }
  const joined = `${baseOut}\n\n${extrasOut}`;
  if (joined.length <= maxChars) return joined;
  // Prefer keeping the extras tail if join still overflows
  const keepExtras = Math.min(extrasOut.length, Math.floor(maxChars * 0.5));
  const keepBase = Math.max(0, maxChars - keepExtras - 2);
  return `${baseOut.slice(0, keepBase)}\n\n${extrasOut.slice(0, keepExtras)}`;
}

/**
 * Content hash of the corpus that will be sent to the model (after budget).
 * @param {{ content?: string, extrasCorpus?: string, rawContent?: string }} note
 * @param {{ maxChars?: number, locale?: "en"|"zh" }} [opts]
 * @returns {string}
 */
export function noteCorpusHash(note, opts = {}) {
  const full = notePromptCorpus(note);
  const maxChars = opts.maxChars ?? EXTRACT_CORPUS_MAX;
  return contentHash(
    budgetTodoPromptCorpus(full, maxChars, {
      locale: opts.locale,
    }),
  );
}

/**
 * Find notes for todo AI — activity window first (periods + touched + anchors),
 * falling back to N newest period files.
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @param {number} [depth=2] — period depth preference
 * @returns {{ absPath: string, relPath: string, period: string, content: string, rawContent?: string, extrasCorpus?: string }[]}
 */
function findRecentPeriodNotes(workspaceRoot, engineRoot, contract, depth = MAINTAIN_PERIOD_DEPTH) {
  try {
    const win = resolveActivityWindow({
      workspaceRoot,
      engineRoot,
      contract,
      options: {
        windowDays: DEFAULT_WINDOW_DAYS,
        maxPeriods: Math.max(depth + 2, MAINTAIN_PERIOD_DEPTH),
        maxFiles: DEFAULT_MAX_FILES,
        minContentLength: 10,
        loadContent: true,
      },
    });
    const periods = periodItemsFromWindow(win)
      .filter((i) => (i.content || "").length >= 20)
      .filter((i) => !i.relPath.startsWith("memory/"))
      .map((i) => ({
        absPath: i.absPath,
        relPath: i.relPath,
        period: i.period || path.basename(i.relPath, ".md"),
        content: i.content || "",
        rawContent: i.content || "",
        extrasCorpus: "",
      }));
    if (periods.length > 0) {
      // Fold non-period activity into every period's extrasCorpus so whichever
      // period is selected for extract/maintain still sees latest related material.
      // Exclude memory plane (esp. memory/todo.md): writing todos must not change
      // the activity corpus hash and re-trigger extract on the next run.
      const extras = win.items.filter(
        (i) =>
          i.kind !== "period" &&
          (i.content || "").length >= 20 &&
          !String(i.relPath || "").startsWith("memory/") &&
          !String(i.relPath || "").endsWith("/todo.md") &&
          String(i.relPath || "") !== TODO_REL_PATH,
      );
      let extrasCorpus = "";
      if (extras.length > 0) {
        extrasCorpus = buildActivityCorpus(
          { items: extras, meta: win.meta },
          { maxChars: EXTRAS_CORPUS_MAX },
        ).trim();
      }
      for (const p of periods) {
        p.extrasCorpus = extrasCorpus;
        p.content = notePromptCorpus(p);
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
      return { absPath, relPath, period, content, rawContent: content, extrasCorpus: "" };
    }).filter((n) => n.content.length >= 20);
  } catch {
    return [];
  }
}

/**
 * Build a focused prompt for extracting actionable todo items from a period note.
 * @param {string} content
 * @param {string[]} dismissedTexts — texts of dismissed items to avoid re-extracting
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function buildTodoExtractionPrompt(content, dismissedTexts = [], locale = "zh") {
  const L = L10N[locale] || L10N.zh;
  // Prefer activity extras over long period heads when budgeting
  const trimmed = budgetTodoPromptCorpus(content, EXTRACT_CORPUS_MAX, { locale });
  const dismissedHint = dismissedTexts.length > 0
    ? L.extractDismissedHint(dismissedTexts)
    : "";

  return `${L.extractIntro}${dismissedHint}

---
${trimmed}
---

${locale === "en"
    ? "Extract 1-8 specific, actionable todo items, one per line, using concise imperative or verb-object phrases."
    : "请提取 1-8 条具体的、可执行的待办事项，每条一行，用简洁的祈使句或动宾短语。"}
${L.extractRules}`;
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

  const notes = findRecentPeriodNotes(workspaceRoot, engineRoot, resolvedContract, 2);
  if (notes.length === 0) {
    return { ok: false, extracted: [], added: [], skipped: 0, period: null, targetPath: TODO_REL_PATH, reason: "no-period-note" };
  }

  const note = notes[0];
  const locale = resolveProductAiLanguage({
    uiLocale: opts.localeOverride ?? opts.uiLocale,
    contract: resolvedContract,
    userText: opts.userText,
  });

  if (!aiProvider || typeof aiProvider.generate !== "function") {
    return { ok: false, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "no-ai-provider" };
  }

  const existing = readTodoList(workspaceRoot);
  let processedPeriods = existing?.processedPeriods || [];
  const processedHashes = existing?.processedHashes || {};

  // Force mode: clear this period from processed list + drop stale hash
  if (force && processedPeriods.includes(note.period)) {
    processedPeriods = processedPeriods.filter(p => p !== note.period);
  }

  // Budgeted corpus = what the model actually receives (extras preferred over long period head).
  // Hash must match that string so skip never hides material the model never saw.
  const promptCorpus = budgetTodoPromptCorpus(notePromptCorpus(note), EXTRACT_CORPUS_MAX, { locale });
  const currentHash = contentHash(promptCorpus);
  if (processedPeriods.includes(note.period)) {
    const storedHash = processedHashes[note.period];
    if (!force && (!storedHash || storedHash === currentHash)) {
      return { ok: true, extracted: [], added: [], skipped: 0, period: note.period, targetPath: TODO_REL_PATH, reason: "already-processed", processedPeriods };
    }
    // Corpus changed (period and/or extras) → re-scan
    processedPeriods = processedPeriods.filter(p => p !== note.period);
  }

  // Get dismissed item texts for the prompt — from the persistent dismissedTexts map
  // (items are already deleted from the active list, so we can't find them in items)
  const dismissedTexts = Object.values(existing?.dismissedTexts || {});

  let aiText = "";
  try {
    aiText = await aiProvider.generate(buildTodoExtractionPrompt(promptCorpus, dismissedTexts, locale), {
      workspaceRoot,
      operation: "todo_extract",
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
    const updatedHashes = { ...processedHashes, [note.period]: currentHash };
    writeTodoList(workspaceRoot, existing?.items || [], resolvedContract, {
      prevContent: existing?.rawContent,
      expectedRawContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      processedHashes: updatedHashes,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
      dismissedTexts: existing?.dismissedTexts || {},
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
    // Semantic dedup: skip if >0.7 similar to existing active item
    const semanticDups = findSemanticDuplicates(parsed.text, existing?.items || []);
    if (semanticDups.length > 0 && semanticDups[0].similarity > 0.7) continue;
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
    const updatedHashes = { ...processedHashes, [note.period]: currentHash };
    writeTodoList(workspaceRoot, existing?.items || [], resolvedContract, {
      prevContent: existing?.rawContent,
      expectedRawContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      processedHashes: updatedHashes,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
      dismissedTexts: existing?.dismissedTexts || {},
    });
    return { ok: true, extracted: [], added: [], skipped: lines.length, period: note.period, targetPath: TODO_REL_PATH, reason: "all-duplicates" };
  }

  const existingItems = existing?.items || [];
  const active = existingItems.filter((i) => !i.done);
  const done = existingItems.filter((i) => i.done);
  const merged = [...added, ...active, ...done].slice(0, MAX_ACTIVE_ITEMS + 20);

  const updatedHashes = { ...processedHashes, [note.period]: currentHash };
  const result = writeTodoList(workspaceRoot, merged, resolvedContract, {
    prevContent: existing?.rawContent,
    expectedRawContent: existing?.rawContent,
    actor: "ai",
    processedPeriods: updatedPeriods,
    processedHashes: updatedHashes,
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
    dismissedTexts: existing?.dismissedTexts || {},
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
 * Token-efficient CJK + Latin tokenizer for semantic dedup.
 * CJK: bigrams (2-char sliding window)
 * Latin: lowercase words (split on non-alnum)
 * @param {string} text
 * @returns {Set<string>}
 */
function tokenize(text) {
  const tokens = new Set();
  const cleaned = String(text || "").toLowerCase().trim();
  // Latin words
  const latinMatches = cleaned.match(/[a-z]{2,}/gu);
  if (latinMatches) {
    for (const w of latinMatches) {
      if (w.length >= 2) tokens.add(w);
    }
  }
  // CJK bigrams
  const cjkRanges = /[\u4e00-\u9fff\u3400-\u4dbf]/u;
  const cjkChars = Array.from(cleaned).filter((c) => cjkRanges.test(c));
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.add(cjkChars[i] + cjkChars[i + 1]);
  }
  return tokens;
}

/**
 * Jaccard similarity between two token sets.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number} 0..1
 */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter++;
  }
  return inter / (a.size + b.size - inter);
}

/**
 * Find existing items that are semantically similar to a new text.
 * Returns candidates with Jaccard >0.6; callers decide their own skip threshold
 * (extractTodosFromStream and maintainTodos use >0.7 for actual dedup skip).
 * @param {string} newText
 * @param {TodoItem[]} existingItems — only active (non-done) items
 * @returns {{ item: TodoItem, similarity: number }[]}
 */
function findSemanticDuplicates(newText, existingItems) {
  const newTokens = tokenize(newText);
  if (newTokens.size < 2) return [];
  return existingItems
    .filter((i) => !i.done)
    .map((i) => ({ item: i, similarity: jaccard(newTokens, tokenize(i.text)) }))
    .filter((r) => r.similarity > 0.6)
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Safe match for AI maintain complete/update against an existing todo text.
 *
 * Rejects single-token Latin overlap false positives (e.g. "Buy milk" vs
 * "I will buy groceries later"). Accepts:
 * - exact equality (case-insensitive)
 * - Jaccard token similarity ≥ 0.55
 * - substantial phrase containment (shorter ≥ 4 chars and ≥ 50% of longer length)
 *
 * Exported for unit tests of the real matching policy used by maintainTodos.
 * @param {string} itemText
 * @param {string} candidateText — AI complete string or update.old
 * @returns {boolean}
 */
export function matchTodoMaintainText(itemText, candidateText) {
  const a = String(itemText || "").toLowerCase().trim();
  const b = String(candidateText || "").toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;

  const sim = jaccard(tokenize(a), tokenize(b));
  if (sim >= 0.55) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.includes(shorter)) {
    if (shorter.length / longer.length >= 0.5) return true;
  }
  return false;
}

/**
 * Smart-budget a corpus to maxChars while preserving structural completeness.
 *
 * Replaces the old keyword-based `extractKeySegments` which filtered lines by
 * action-word matching — that approach starved the AI of full semantic context.
 * The new strategy preserves structural elements (frontmatter, headings,
 * paragraph boundaries) and truncates at paragraph boundaries when the budget
 * is exceeded, keeping the head + tail so the AI sees both context and recency.
 *
 * @param {string} content
 * @param {number} maxChars
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function smartBudgetCorpus(content, maxChars, locale = "zh") {
  const L = L10N[locale] || L10N.zh;
  const text = String(content || "");
  if (text.length <= maxChars) return text;

  // Preserve frontmatter block intact (---\n...\n---)
  let fm = "";
  let body = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---", 4);
    if (end > 0) {
      fm = text.slice(0, end + 4);
      body = text.slice(end + 4);
    }
  }

  // Split into paragraphs (double-newline separated)
  const paragraphs = body.split(/\n{2,}/u);
  const headRoom = maxChars - fm.length - 40; // reserve for separator + truncation marker

  // Strategy: keep first 30% of paragraphs (structural context) + last 70% (recency)
  // This preserves the narrative arc while staying within budget.
  const totalParas = paragraphs.length;
  const headCount = Math.max(1, Math.ceil(totalParas * 0.3));
  const headParas = paragraphs.slice(0, headCount);
  const tailParas = paragraphs.slice(headCount);

  // Measure head size
  const headText = headParas.join("\n\n");
  const tailBudget = Math.max(200, headRoom - headText.length);

  // Take tail paragraphs from the end backward until budget exhausted
  const keptTail = [];
  let tailUsed = 0;
  for (let i = tailParas.length - 1; i >= 0; i--) {
    const para = tailParas[i];
    if (tailUsed + para.length + 2 > tailBudget) break;
    keptTail.unshift(para);
    tailUsed += para.length + 2;
  }

  // If even head doesn't fit, truncate head
  if (headText.length > headRoom) {
    const headBudget = Math.max(200, Math.floor(headRoom * 0.4));
    const tailBudget2 = Math.max(200, headRoom - headBudget);
    const headTrimmed = headText.slice(0, headBudget);
    const tailTrimmed = tailParas.join("\n\n").slice(-tailBudget2);
    return `${fm}\n\n${headTrimmed}\n\n…${L.truncated}\n\n${tailTrimmed}`.slice(0, maxChars);
  }

  // Check if we dropped middle paragraphs
  const droppedCount = tailParas.length - keptTail.length;
  const dropMsg = locale === "en"
    ? `…${L.truncated} (${droppedCount} paragraphs omitted)`
    : `…${L.truncated}（省略 ${droppedCount} 段）`;
  const sep = droppedCount > 0 ? `\n\n${dropMsg}\n\n` : "\n\n";
  const result = `${fm}${fm ? "\n\n" : ""}${headText}${sep}${keptTail.join("\n\n")}`;
  return result.length > maxChars ? `${result.slice(0, maxChars - 20)}\n…${L.truncated}` : result;
}

/**
 * Compact todo list for prompt — only active items, compressed format.
 * Limits to top 20 by priority (overdue → due soon → undated → stale).
 * @param {TodoItem[]} existingItems
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function compactTodoList(existingItems, locale = "zh") {
  const L = L10N[locale] || L10N.zh;
  const today = todayStr();
  const active = existingItems.filter((i) => !i.done);
  if (active.length === 0) return L.todoListEmpty;
  // Sort by priority: overdue first, then by dueDate, then undated
  active.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const top = active.slice(0, 20);
  return top.map((i, idx) => {
    const parts = [i.text];
    if (i.dueDate) {
      const overdue = i.dueDate < today;
      parts.push(overdue ? L.overdueLabel(i.dueDate) : L.dueLabel(i.dueDate));
    }
    return `${idx + 1}. ${parts.join("")}`;
  }).join("\n");
}

/**
 * Build a token-optimized maintenance prompt for AI todo maintenance.
 * Strategy:
 * - Stream content: keyword-filtered segments (< 3500 chars vs 6000)
 * - Todo list: top 20 active items, compressed format
 * - Dismissed: only count, not full texts (unless < 5)
 * - Few-shot example replaces verbose instructions
 *
 * @param {string} streamContent
 * @param {TodoItem[]} existingItems
 * @param {string} period
 * @param {string[]} dismissedTexts
 * @param {"en"|"zh"} [locale="zh"]
 * @returns {string}
 */
function buildMaintenancePrompt(streamContent, existingItems, period, dismissedTexts = [], locale = "zh") {
  const L = L10N[locale] || L10N.zh;
  // Key-segment the period body only; always reserve budget for folded extras
  const trimmed = budgetTodoPromptCorpus(streamContent, MAINTAIN_CORPUS_MAX, {
    locale,
  });
  const todoList = compactTodoList(existingItems, locale);
  // Only include dismissed texts if < 5 (otherwise just count)
  const dismissedHint = dismissedTexts.length > 0
    ? L.maintainDismissedHint(dismissedTexts.length, dismissedTexts)
    : "";
  // Build semantic dedup hint for AI
  const activeItems = existingItems.filter((i) => !i.done);
  let dedupHint = "";
  if (activeItems.length > 0 && activeItems.length <= 20) {
    const staleItems = activeItems.filter((i) => {
      if (!i.createdAt) return false;
      return daysBetween(i.createdAt, todayStr()) > 14;
    });
    if (staleItems.length > 0) {
      dedupHint = L.maintainDedupHint(staleItems.slice(0, 5));
    }
  }

  return `${L.maintainIntro}${dismissedHint}${dedupHint}

## ${L.maintainNoteLabel}（${period}）
${trimmed}

## ${L.maintainTodoLabel}（${L.maintainTodoActive(activeItems.length)}）
${todoList}

${L.maintainOps}

${L.maintainJsonFormat}`;
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
  const processedHashes = existing?.processedHashes || {};

  // Force mode: clear the periods we're about to re-scan (and their hashes)
  let hashes = { ...processedHashes };
  if (force) {
    const periodsToClear = new Set(notes.map((n) => n.period));
    processedPeriods = processedPeriods.filter((p) => !periodsToClear.has(p));
    for (const p of periodsToClear) delete hashes[p];
  }

  const locale = resolveProductAiLanguage({
    uiLocale: opts.localeOverride ?? opts.uiLocale,
    contract: resolvedContract,
    userText: opts.userText,
  });
  const maintainBudget = { maxChars: MAINTAIN_CORPUS_MAX, locale };

  // Filter to only unprocessed periods (or periods whose budgeted prompt corpus changed)
  const unprocessedNotes = notes.filter((n) => {
    if (!processedPeriods.includes(n.period)) return true;
    const storedHash = hashes[n.period];
    if (!storedHash) return false; // No hash stored — backward compat: skip
    return storedHash !== noteCorpusHash(n, maintainBudget);
  });
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

  // Get dismissed item texts for the prompt — from the persistent dismissedTexts map
  const dismissedTexts = Object.values(existing?.dismissedTexts || {});

  // Prefer newest note among unprocessed (notes is newest-first from activity window)
  const note = unprocessedNotes[0];
  // Same string the model receives (key-segment base + reserved extras)
  const promptCorpus = budgetTodoPromptCorpus(notePromptCorpus(note), MAINTAIN_CORPUS_MAX, {
    locale,
  });
  const currentHash = contentHash(promptCorpus);

  let aiText = "";
  try {
    aiText = await aiProvider.generate(
      buildMaintenancePrompt(promptCorpus, existingItems, note.period, dismissedTexts, locale),
      { workspaceRoot, operation: "todo_maintain", period: note.period, sourcePath: note.relPath },
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

  // Process completions: semantic / substantial-phrase match only (no single-token Latin hits)
  for (const completeText of plan.complete) {
    const idx = items.findIndex(
      (i, iIdx) => !i.done && !matchedIndices.has(iIdx) && matchTodoMaintainText(i.text, completeText),
    );
    if (idx >= 0) {
      items[idx] = { ...items[idx], done: true, completedAt: todayStr() };
      matchedIndices.add(idx);
      completed.push(items[idx]);
    }
  }

  // Process updates: same safe match on update.old
  for (const upd of plan.update) {
    const idx = items.findIndex(
      (i, idx2) => !i.done && !matchedIndices.has(idx2) && matchTodoMaintainText(i.text, upd.old),
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

  // Process additions: deduplicate against current items + dismissed list + semantic dedup
  const currentIds = new Set(items.map((i) => i.id));
  const dismissedSet = new Set(existing?.dismissed || []);
  for (const text of plan.add) {
    const parsed = parseDueDate(text);
    if (parsed.text.length < 3 || parsed.text.length > 200) continue;
    const id = todoId(parsed.text);
    // Exact hash dedup
    if (currentIds.has(id) || dismissedSet.has(id)) continue;
    // Semantic dedup: skip if >0.6 similar to existing active item
    const semanticDups = findSemanticDuplicates(parsed.text, items.filter((i) => !i.done));
    if (semanticDups.length > 0 && semanticDups[0].similarity > 0.7) continue;
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
    // Still write to mark the period as processed (store corpus hash)
    const updatedHashes = { ...hashes, [note.period]: currentHash };
    writeTodoList(workspaceRoot, items, resolvedContract, {
      prevContent: existing?.rawContent,
      expectedRawContent: existing?.rawContent,
      actor: "ai",
      processedPeriods: updatedPeriods,
      processedHashes: updatedHashes,
      dismissed: existing?.dismissed || [],
      dismissedAt: existing?.dismissedAt || {},
      dismissedTexts: existing?.dismissedTexts || {},
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

  // Store hash of the prompt corpus (period ∪ extras) so future skip matches what was sent
  const updatedHashes = { ...hashes, [note.period]: currentHash };
  const result = writeTodoList(workspaceRoot, ordered, resolvedContract, {
    prevContent: existing?.rawContent,
    expectedRawContent: existing?.rawContent,
    actor: "ai",
    processedPeriods: updatedPeriods,
    processedHashes: updatedHashes,
    dismissed: existing?.dismissed || [],
    dismissedAt: existing?.dismissedAt || {},
    dismissedTexts: existing?.dismissedTexts || {},
  });

  // Save periodic snapshot for historical tracking (best-effort)
  snapshotTodoList(workspaceRoot, ordered, note.period, resolvedContract);

  return {
    ok: result.ok,
    added,
    completed,
    updated,
    period: note.period,
    targetPath: TODO_REL_PATH,
  };
}
