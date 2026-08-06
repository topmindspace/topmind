// ── topmind Activity Window ────────────────────────────────────────────────
// Shared "what should AI organize right now?" scope for suggest / todo / AI ops.
//
// Ideal: not "latest period file only", but:
//   recent period notes
// ∪ markdown files touched in a time band (mtime)
// ∪ parents anchored by in-file append markers
//
// Content truth remains plain Markdown files. This module is read-only.

import fs from "node:fs";
import path from "node:path";
import { loadContract } from "./contract-engine.mjs";
import { resolveWorkspaceModel, findStreamCategory } from "./workspace-model.mjs";

/** Default lookback for mtime-based activity (days). */
export const DEFAULT_WINDOW_DAYS = 14;
/** Cap on total files returned. */
export const DEFAULT_MAX_FILES = 24;
/** Cap on stream period notes preferred into the window. */
export const DEFAULT_MAX_PERIODS = 4;

/** Skip these root-level names when walking for mtime activity. */
const SKIP_ROOT_NAMES = new Set([
  ".topmind",
  ".git",
  ".obsidian",
  "node_modules",
  "99-归档",
  "99-Archive",
  "99-archive",
]);

/**
 * @typedef {object} ActivityItem
 * @property {string} relPath
 * @property {string} absPath
 * @property {"period"|"note"|"topic"|"memory"|"other"} kind
 * @property {"recent_period"|"mtime"|"anchor"|"reply_parent"} reason
 * @property {number} mtimeMs
 * @property {string} [period]
 * @property {string} [content]
 * @property {string} [anchorOf] — child path that caused parent inclusion
 */

/**
 * @typedef {object} ActivityWindow
 * @property {ActivityItem[]} items
 * @property {{ sinceMs: number, collectedAt: string, maxFiles: number, windowDays: number }} meta
 */

/**
 * @param {string} fileName
 * @returns {boolean}
 */
export function isPeriodNoteFileName(fileName) {
  return (
    /^\d{4}-W\d{2}\.md$/u.test(fileName) ||
    /^\d{4}-M\d{2}\.md$/u.test(fileName) ||
    /^\d{4}-\d{2}-\d{2}\.md$/u.test(fileName) ||
    /^\d{4}-\d{2}\.md$/u.test(fileName)
  );
}

/**
 * Classify a workspace-relative path for activity items.
 * @param {string} relPath
 * @returns {"period"|"note"|"topic"|"memory"|"other"}
 */
export function classifyActivityPath(relPath) {
  const norm = String(relPath || "").replace(/\\/g, "/");
  if (norm.startsWith("memory/")) return "memory";
  const base = path.posix.basename(norm);
  if (isPeriodNoteFileName(base)) return "period";
  if (/(^|\/)topic\.md$/iu.test(norm)) return "topic";
  if (/\.md$/iu.test(norm)) return "note";
  return "other";
}

/**
 * Parse append markers that point at a parent file outside the current file.
 * Marker form (HTML comment, ignorable by readers):
 *   <!-- topmind:append parent="20-专题/2026-foo/note.md" heading="..." at="ISO" -->
 *
 * Same-file continuations use heading-only markers and do not force extra files:
 *   <!-- topmind:append heading="## 记录" at="ISO" -->
 *
 * @param {string} content
 * @returns {Array<{ parentRel?: string, heading?: string, at?: string }>}
 */
export function parseAppendMarkers(content) {
  const text = String(content || "");
  /** @type {Array<{ parentRel?: string, heading?: string, at?: string }>} */
  const out = [];
  const re = /<!--\s*topmind:append\b([^>]*)-->/giu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1] || "";
    const parent = attrs.match(/\bparent\s*=\s*"([^"]+)"/u)?.[1];
    const heading = attrs.match(/\bheading\s*=\s*"([^"]+)"/u)?.[1];
    const at = attrs.match(/\bat\s*=\s*"([^"]+)"/u)?.[1];
    if (parent || heading) {
      out.push({
        parentRel: parent ? parent.replace(/\\/g, "/").replace(/^\/+/u, "") : undefined,
        heading: heading || undefined,
        at: at || undefined,
      });
    }
  }
  return out;
}

/**
 * Build the continuation block appended under / after a stream entry.
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.heading] — parent entry heading for human context
 * @param {string} [opts.parentRel] — optional cross-file parent
 * @param {Date} [opts.date]
 * @returns {string}
 */
export function formatAppendBlock(opts) {
  const content = String(opts.content || "").trim();
  if (!content) return "";
  const date = opts.date instanceof Date ? opts.date : new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const hm = date.toTimeString().slice(0, 5);
  const heading = opts.heading ? String(opts.heading).trim() : "";
  const parentRel = opts.parentRel ? String(opts.parentRel).replace(/\\/g, "/").replace(/^\/+/u, "") : "";

  const attrParts = [];
  if (parentRel) attrParts.push(`parent="${parentRel}"`);
  if (heading) attrParts.push(`heading="${heading.replace(/"/gu, "'")}"`);
  attrParts.push(`at="${date.toISOString()}"`);
  const marker = `<!-- topmind:append ${attrParts.join(" ")} -->`;

  const titleLine = heading
    ? `#### 续 · ${ymd} ${hm}（对「${heading}」）`
    : `#### 续 · ${ymd} ${hm}`;

  return `\n${marker}\n${titleLine}\n\n${content}\n`;
}

/**
 * Insert an append block after the section matching `heading`, or at end of body.
 * Heading match: exact `## heading` line, or first section whose heading equals/contains.
 *
 * @param {string} existingBody
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.heading]
 * @param {string} [opts.parentRel]
 * @param {Date} [opts.date]
 * @returns {string}
 */
export function appendToStreamEntry(existingBody, opts) {
  const block = formatAppendBlock(opts);
  if (!block) return existingBody || "";

  let body = String(existingBody || "").replace(/\s+$/u, "");
  const heading = opts.heading ? String(opts.heading).trim() : "";

  if (!heading) {
    return `${body}${block}`;
  }

  // Match ## heading (allow optional leading # count 2–4)
  const lines = body.split("\n");
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{2,4})\s+(.+?)\s*$/u);
    if (!hm) continue;
    const hText = hm[2].trim();
    if (hText === heading || hText.includes(heading) || heading.includes(hText)) {
      sectionStart = i;
      break;
    }
  }

  if (sectionStart < 0) {
    // Fallback: try matching a list-item line that starts the soft entry
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(heading) && /^\s*[-*+]\s+/u.test(lines[i])) {
        sectionStart = i;
        break;
      }
    }
  }

  if (sectionStart < 0) {
    return `${body}${block}`;
  }

  // Find end of this section: next heading of same or higher level, or EOF
  const startLine = lines[sectionStart];
  const levelMatch = startLine.match(/^(#{2,4})\s+/u);
  const level = levelMatch ? levelMatch[1].length : 2;
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#{2,4})\s+/u);
    if (hm && hm[1].length <= level) {
      sectionEnd = i;
      break;
    }
  }

  const before = lines.slice(0, sectionEnd).join("\n").replace(/\s+$/u, "");
  const after = lines.slice(sectionEnd).join("\n");
  return after.trim() ? `${before}${block}\n${after}` : `${before}${block}`;
}

/**
 * Find period notes under the stream category (newest first).
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @param {number} [limit]
 * @returns {Array<{ absPath: string, relPath: string, period: string, mtimeMs: number }>}
 */
function listPeriodNoteFiles(workspaceRoot, engineRoot, contract, limit = DEFAULT_MAX_PERIODS) {
  try {
    const model = resolveWorkspaceModel({ workspaceRoot, engineRoot, config: contract });
    const streamCat = findStreamCategory(model);
    if (!streamCat?.path || !fs.existsSync(streamCat.path)) return [];

    /** @type {Array<{ absPath: string, relPath: string, period: string, mtimeMs: number }>} */
    const found = [];

    const walk = (dirAbs, dirRel) => {
      let entries;
      try {
        entries = fs.readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const abs = path.join(dirAbs, e.name);
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (/^\d{4}$/u.test(e.name)) walk(abs, rel);
          continue;
        }
        if (!e.isFile() || !isPeriodNoteFileName(e.name)) continue;
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(abs).mtimeMs;
        } catch {
          /* ignore */
        }
        const catRel = streamCat.directory
          ? `${String(streamCat.directory).replace(/\\/g, "/")}/${rel}`.replace(/\/+/gu, "/")
          : rel;
        found.push({
          absPath: abs,
          relPath: catRel.replace(/\\/g, "/"),
          period: e.name.replace(/\.md$/u, ""),
          mtimeMs,
        });
      }
    };

    walk(streamCat.path, "");
    found.sort((a, b) => b.period.localeCompare(a.period) || b.mtimeMs - a.mtimeMs);
    return found.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Walk workspace for markdown files with mtime >= sinceMs.
 * @param {string} workspaceRoot
 * @param {number} sinceMs
 * @param {number} maxFiles
 * @returns {Array<{ absPath: string, relPath: string, mtimeMs: number }>}
 */
function listRecentlyTouchedMarkdown(workspaceRoot, sinceMs, maxFiles) {
  /** @type {Array<{ absPath: string, relPath: string, mtimeMs: number }>} */
  const found = [];

  const walk = (dirAbs, relBase, depth) => {
    if (found.length >= maxFiles * 3) return; // gather extra then sort/trim
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (depth === 0 && SKIP_ROOT_NAMES.has(e.name)) continue;
      const abs = path.join(dirAbs, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // Skip .derived anywhere
        if (e.name === ".derived" || e.name === "images") continue;
        walk(abs, rel, depth + 1);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      try {
        const st = fs.statSync(abs);
        if (st.mtimeMs >= sinceMs) {
          found.push({ absPath: abs, relPath: rel.replace(/\\/g, "/"), mtimeMs: st.mtimeMs });
        }
      } catch {
        /* ignore */
      }
    }
  };

  walk(workspaceRoot, "", 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.slice(0, maxFiles);
}

/**
 * Resolve the activity window for AI organize / suggest / todo.
 *
 * @param {object} opts
 * @param {string} opts.workspaceRoot
 * @param {string} [opts.engineRoot]
 * @param {object} [opts.contract]
 * @param {object} [opts.options]
 * @param {number} [opts.options.windowDays]
 * @param {number} [opts.options.sinceMs] — absolute cutoff (overrides windowDays)
 * @param {number} [opts.options.maxFiles]
 * @param {number} [opts.options.maxPeriods]
 * @param {boolean} [opts.options.loadContent=true]
 * @param {number} [opts.options.minContentLength=0] — skip empty stubs when loading
 * @returns {ActivityWindow}
 */
export function resolveActivityWindow({
  workspaceRoot,
  engineRoot,
  contract,
  options = {},
}) {
  const resolved = contract || loadContract(workspaceRoot);
  const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : DEFAULT_WINDOW_DAYS;
  const sinceMs =
    typeof options.sinceMs === "number"
      ? options.sinceMs
      : Date.now() - windowDays * 86400000;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPeriods = options.maxPeriods ?? DEFAULT_MAX_PERIODS;
  const loadContent = options.loadContent !== false;
  const minContentLength = options.minContentLength ?? 0;

  /** @type {Map<string, ActivityItem>} */
  const byRel = new Map();

  const upsert = (item) => {
    const key = item.relPath.replace(/\\/g, "/");
    const prev = byRel.get(key);
    if (!prev) {
      byRel.set(key, { ...item, relPath: key });
      return;
    }
    // Prefer richer reason priority: reply_parent > anchor > recent_period > mtime
    const rank = { reply_parent: 4, anchor: 3, recent_period: 2, mtime: 1 };
    const keepReason =
      (rank[item.reason] || 0) >= (rank[prev.reason] || 0) ? item.reason : prev.reason;
    byRel.set(key, {
      ...prev,
      ...item,
      relPath: key,
      reason: keepReason,
      mtimeMs: Math.max(prev.mtimeMs || 0, item.mtimeMs || 0),
      content: item.content ?? prev.content,
      period: item.period || prev.period,
      anchorOf: item.anchorOf || prev.anchorOf,
    });
  };

  // 1) Recent period notes (always preferred into the window)
  for (const p of listPeriodNoteFiles(workspaceRoot, engineRoot, resolved, maxPeriods)) {
    upsert({
      relPath: p.relPath,
      absPath: p.absPath,
      kind: "period",
      reason: "recent_period",
      mtimeMs: p.mtimeMs,
      period: p.period,
    });
  }

  // 2) mtime-touched markdown in the time band
  for (const f of listRecentlyTouchedMarkdown(workspaceRoot, sinceMs, maxFiles)) {
    upsert({
      relPath: f.relPath,
      absPath: f.absPath,
      kind: classifyActivityPath(f.relPath),
      reason: "mtime",
      mtimeMs: f.mtimeMs,
      period: isPeriodNoteFileName(path.basename(f.relPath))
        ? path.basename(f.relPath).replace(/\.md$/u, "")
        : undefined,
    });
  }

  // 3) Load content for current set; pull parent files from append markers
  if (loadContent) {
    for (const item of [...byRel.values()]) {
      try {
        if (!fs.existsSync(item.absPath)) continue;
        const content = fs.readFileSync(item.absPath, "utf8");
        item.content = content;
        if (minContentLength > 0 && content.trim().length < minContentLength) {
          // keep metadata but flag empty
        }
        for (const marker of parseAppendMarkers(content)) {
          if (!marker.parentRel) continue;
          const parentRel = marker.parentRel;
          if (byRel.has(parentRel)) {
            const parent = byRel.get(parentRel);
            if (parent) parent.reason = "reply_parent";
            continue;
          }
          const parentAbs = path.join(workspaceRoot, parentRel);
          if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isFile()) continue;
          let mtimeMs = 0;
          try {
            mtimeMs = fs.statSync(parentAbs).mtimeMs;
          } catch {
            /* ignore */
          }
          let parentContent = "";
          try {
            parentContent = fs.readFileSync(parentAbs, "utf8");
          } catch {
            /* ignore */
          }
          upsert({
            relPath: parentRel,
            absPath: parentAbs,
            kind: classifyActivityPath(parentRel),
            reason: "reply_parent",
            mtimeMs,
            content: parentContent,
            anchorOf: item.relPath,
          });
        }
      } catch {
        /* ignore unreadable */
      }
    }
  }

  // Sort: period notes first (by period desc), then by mtime desc
  let items = [...byRel.values()].sort((a, b) => {
    if (a.kind === "period" && b.kind !== "period") return -1;
    if (b.kind === "period" && a.kind !== "period") return 1;
    if (a.period && b.period && a.period !== b.period) return b.period.localeCompare(a.period);
    return (b.mtimeMs || 0) - (a.mtimeMs || 0);
  });

  if (items.length > maxFiles) {
    items = items.slice(0, maxFiles);
  }

  // Drop empty content when minContentLength requested (after sort/cap)
  if (minContentLength > 0) {
    items = items.filter(
      (i) => !loadContent || (i.content && i.content.trim().length >= minContentLength),
    );
  }

  return {
    items,
    meta: {
      sinceMs,
      collectedAt: new Date().toISOString(),
      maxFiles,
      windowDays,
    },
  };
}

/**
 * Build a single corpus string for LLM prompts from an activity window.
 * @param {ActivityWindow} window
 * @param {object} [opts]
 * @param {number} [opts.maxChars=12000]
 * @returns {string}
 */
export function buildActivityCorpus(window, opts = {}) {
  const maxChars = opts.maxChars ?? 12000;
  const parts = [];
  let used = 0;
  for (const item of window.items || []) {
    const body = (item.content || "").trim();
    if (!body) continue;
    const header = `### ${item.relPath}${item.period ? ` (${item.period})` : ""} · ${item.reason}\n`;
    const sliceBudget = Math.max(400, Math.floor((maxChars - used) / Math.max(1, (window.items.length - parts.length))));
    const chunk = body.length > sliceBudget ? `${body.slice(0, sliceBudget)}\n…` : body;
    const block = `${header}\n${chunk}\n`;
    if (used + block.length > maxChars) {
      const remain = maxChars - used;
      if (remain > 200) parts.push(block.slice(0, remain) + "\n…");
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join("\n");
}

/**
 * Convenience: period-like items only (for callers that still want period focus).
 * @param {ActivityWindow} window
 * @returns {ActivityItem[]}
 */
export function periodItemsFromWindow(window) {
  return (window.items || []).filter((i) => i.kind === "period" || i.period);
}
