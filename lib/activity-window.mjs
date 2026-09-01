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
import { isMemoryPlaneRelPath, normalizeMemoryConfig } from "./stream-period.mjs";

/** Default lookback for mtime-based activity (days). */
export const DEFAULT_WINDOW_DAYS = 21;
/** Cap on total files returned. */
export const DEFAULT_MAX_FILES = 30;
/** Cap on stream period notes preferred into the window. */
export const DEFAULT_MAX_PERIODS = 6;
/** Suggest / AI-ops prompt corpus budget (chars). Todo extract matches this. */
export const SUGGEST_CORPUS_MAX_CHARS = 16000;

/** Always skip machine / VCS roots. Delivery + system dirs come from the live model. */
const SKIP_MACHINE_ROOTS = new Set([".topmind", ".git", ".obsidian", "node_modules"]);

/**
 * Root dir names to skip when walking activity (delivery + archive + machine).
 * Uses live contract roles so English / space-separator / renamed {NN-…} still skip.
 *
 * @param {string} workspaceRoot
 * @param {string} [engineRoot]
 * @param {object} [contract]
 * @returns {Set<string>}
 */
export function resolveActivitySkipRootNames(workspaceRoot, engineRoot, contract) {
  const skip = new Set(SKIP_MACHINE_ROOTS);
  try {
    const model = resolveWorkspaceModel({
      workspaceRoot,
      engineRoot,
      config: contract,
    });
    for (const cat of model.categories || []) {
      if ((cat.role === "system" || cat.role === "delivery") && cat.directory) {
        skip.add(cat.directory);
      }
    }
  } catch {
    /* role map optional */
  }
  return skip;
}

function shouldSkipActivityRoot(name, skipNames) {
  if (skipNames.has(name)) return true;
  // Slot 88/99 stay delivery/system even when the model is not loaded yet.
  return /^(88|99)[- ]/u.test(name);
}

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
 * True when `value` is a period-note filename stem (e.g. `2026-W26`),
 * not a relPath, locale label, or fallback token such as `undefined`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSafePeriodStem(value) {
  const s = String(value || "").trim();
  if (!s || s.length > 32 || /[\\/]|\.\./u.test(s) || s.startsWith(".")) return false;
  return isPeriodNoteFileName(`${s}.md`);
}

/**
 * Extract a safe period stem from a filename or workspace-relative path.
 * @param {unknown} fileNameOrPath
 * @returns {string|null}
 */
export function periodStemFromFileName(fileNameOrPath) {
  const base = String(fileNameOrPath || "").replace(/\\/g, "/").split("/").pop() || "";
  const stem = base.replace(/\.md$/iu, "");
  return isSafePeriodStem(stem) ? stem : null;
}

/**
 * Resolve a period stem from a lifecycle/activity candidate.
 * `{path, periodsOld}`-only rows are inputs — the stem comes from the filename.
 * @param {unknown} item
 * @returns {string|null}
 */
export function periodStemFromCandidate(item) {
  if (item == null) return null;
  if (typeof item === "string") {
    if (isSafePeriodStem(item)) return item.trim();
    return periodStemFromFileName(item);
  }
  if (typeof item !== "object") return null;
  const rec = /** @type {Record<string, unknown>} */ (item);
  if (isSafePeriodStem(rec.period)) return String(rec.period).trim();
  if (isSafePeriodStem(rec.stem)) return String(rec.stem).trim();
  return periodStemFromFileName(rec.path || rec.relPath || rec.fullPath || rec.name || "");
}

/**
 * Classify a workspace-relative path for activity items.
 * @param {string} relPath
 * @returns {"period"|"note"|"topic"|"memory"|"other"}
 */
export function classifyActivityPath(relPath, memoryDirRel) {
  const norm = String(relPath || "").replace(/\\/g, "/");
  if (isMemoryPlaneRelPath(norm, memoryDirRel)) return "memory";
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

/** Indent of a markdown list marker in spaces (tabs count as 2), or -1. */
function listMarkerIndent(line) {
  const m = String(line || "").match(/^(\s*)(?:[-*+]|\d+\.)\s+\S/u);
  if (!m) return -1;
  return m[1].replace(/\t/gu, "  ").length;
}

/** Kernel 增补 chrome: HTML marker or `#### 续` heading. */
function isAppendChromeLine(line) {
  const s = String(line || "").trim();
  if (!s) return false;
  if (/^<!--\s*topmind:append\b/iu.test(s)) return true;
  return /^#{2,4}\s*续(?=\s|[·•.]|$)/u.test(s);
}

function headingTextAt(line) {
  const hm = String(line || "").match(/^(#{2,4})\s+(.+?)\s*$/u);
  return hm ? { level: hm[1].length, text: hm[2].trim() } : null;
}

/**
 * Exclusive end index of a list item (nested lines + immediately following
 * 续 chrome) or of a heading section (next same-or-higher heading).
 */
function listItemRangeEnd(lines, start) {
  const baseIndent = listMarkerIndent(lines[start]);
  if (baseIndent < 0) {
    const h = headingTextAt(lines[start]);
    const level = h ? h.level : 2;
    for (let i = start + 1; i < lines.length; i++) {
      const next = headingTextAt(lines[i]);
      if (next && next.level <= level && !isAppendChromeLine(lines[i])) return i;
    }
    return lines.length;
  }
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/u.test(line) && !isAppendChromeLine(line)) return i;
    const indent = listMarkerIndent(line);
    if (indent >= 0 && indent <= baseIndent) return i;
  }
  return lines.length;
}

function stripListChrome(s) {
  return String(s)
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/^\s*\d+\.\s+/gmu, "")
    .replace(/\b\d{1,2}:\d{2}\s+/gu, "");
}

function windowContainsAnchor(lines, start, end, needle) {
  if (!needle) return true;
  const slice = lines.slice(Math.max(0, start), Math.min(end, lines.length)).join("\n");
  if (slice.includes(needle)) return true;
  const stripped = stripListChrome(slice);
  return stripped.includes(stripListChrome(needle)) || stripped.includes(needle);
}

function locateHeadingAnchor(lines, heading) {
  if (!heading) return null;
  const headingAt = (i) => headingTextAt(lines[i])?.text ?? null;
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingAt(i) === heading) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart < 0) {
    const fuzzy = [];
    for (let i = 0; i < lines.length; i++) {
      const hText = headingAt(i);
      if (hText && (hText.includes(heading) || heading.includes(hText))) fuzzy.push(i);
    }
    if (fuzzy.length === 1) sectionStart = fuzzy[0];
  }
  if (sectionStart < 0) return null;
  return {
    start: sectionStart,
    end: listItemRangeEnd(lines, sectionStart),
    matchedHeading: headingAt(sectionStart) || lines[sectionStart].trim(),
  };
}

function locateListItemAnchor(lines, needle) {
  if (!needle) return null;
  const listHits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[-*+]\s+/u.test(lines[i])) continue;
    if (lines[i].includes(needle) || stripListChrome(lines[i]).includes(needle)) {
      listHits.push(i);
    }
  }
  if (listHits.length !== 1) return null;
  const start = listHits[0];
  return {
    start,
    end: listItemRangeEnd(lines, start),
    matchedHeading: lines[start].trim(),
  };
}

function formatNestedListContent(content, indent, hm) {
  const lines = String(content).split("\n");
  const first = `${indent}- ${hm} ${lines[0]}`;
  const cont = `${indent}  `;
  const rest = lines.slice(1).map((l) => (l.trim() ? `${cont}${l}` : ""));
  return [first, ...rest].join("\n");
}

/**
 * Build the continuation block appended under / after a stream entry.
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.heading] — parent entry heading for human context
 * @param {string} [opts.parentRel] — optional cross-file parent
 * @param {Date} [opts.date]
 * @param {boolean} [opts.asNestedList] — list-item parent: indent as a nested bullet
 * @param {string} [opts.indent] — indent prefix when asNestedList
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
  const asNestedList = opts.asNestedList === true;
  const indent = asNestedList ? String(opts.indent ?? "  ") : "";

  const attrParts = [];
  if (parentRel) attrParts.push(`parent="${parentRel}"`);
  if (heading) attrParts.push(`heading="${heading.replace(/"/gu, "'")}"`);
  attrParts.push(`at="${date.toISOString()}"`);
  const marker = `${indent}<!-- topmind:append ${attrParts.join(" ")} -->`;

  if (asNestedList) {
    return `\n${marker}\n${formatNestedListContent(content, indent, hm)}\n`;
  }

  const titleLine = heading
    ? `#### 续 · ${ymd} ${hm}（对「${heading}」）`
    : `#### 续 · ${ymd} ${hm}`;

  return `\n${marker}\n${titleLine}\n\n${content}\n`;
}

/**
 * Insert an append block after the parent entry, or at end of body.
 *
 * Resolve order:
 * 1. Line window (`startLine`/`endLine`) when it still contains `anchorText`.
 * 2. Unique list-item match on `anchorText` (stops at next sibling list item).
 * 3. Heading match on `heading` (exact, then unique fuzzy).
 * 4. Unique list-item match on `heading`.
 * Zero / ambiguous hits fall back to end of file.
 *
 * List-item parents write a nested timed bullet (Markdown-native reply).
 * Heading / prose parents keep `#### 续`.
 *
 * @param {string} existingBody
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.heading]
 * @param {string} [opts.anchorText]
 * @param {number} [opts.startLine] — 0-based inclusive, original file
 * @param {number} [opts.endLine] — 0-based exclusive, original file
 * @param {string} [opts.parentRel]
 * @param {Date} [opts.date]
 * @returns {string}
 */
export function appendToStreamEntry(existingBody, opts) {
  return appendToStreamEntryDetailed(existingBody, opts).body;
}

/**
 * Same as `appendToStreamEntry` but reports where the block landed.
 *
 * @returns {{ body: string, location: { appendedAt: "heading"|"end", matchedHeading?: string, asNestedList?: boolean, ambiguous?: boolean } }}
 */
export function appendToStreamEntryDetailed(existingBody, opts) {
  opts = opts || {};
  let body = String(existingBody || "").replace(/\s+$/u, "");
  const heading = opts.heading ? String(opts.heading).trim() : "";
  const anchorText = opts.anchorText ? String(opts.anchorText).trim() : "";
  const startLine = Number.isInteger(opts.startLine) ? opts.startLine : null;
  const endLine = Number.isInteger(opts.endLine) ? opts.endLine : null;

  const lines = body.split("\n").map((l) => l.replace(/\r$/u, ""));

  let insertAt = -1;
  let parentStart = -1;
  let matchedHeading;

  if (endLine != null && endLine >= 0) {
    const clampedEnd = Math.min(endLine, lines.length);
    const from = startLine != null && startLine >= 0 ? Math.min(startLine, clampedEnd) : Math.max(0, clampedEnd - 1);
    const needle = (anchorText || heading).slice(0, 80);
    if (clampedEnd >= from && windowContainsAnchor(lines, from, clampedEnd, needle)) {
      insertAt = clampedEnd;
      parentStart = from;
      matchedHeading = heading || anchorText || undefined;
    }
  }

  if (insertAt < 0 && anchorText) {
    const listFound = locateListItemAnchor(lines, anchorText);
    if (listFound) {
      parentStart = listFound.start;
      insertAt = listFound.end;
      matchedHeading = listFound.matchedHeading;
    }
  }

  if (insertAt < 0 && heading) {
    const headFound = locateHeadingAnchor(lines, heading);
    if (headFound) {
      parentStart = headFound.start;
      insertAt = headFound.end;
      matchedHeading = headFound.matchedHeading;
    } else {
      const listFound = locateListItemAnchor(lines, heading);
      if (listFound) {
        parentStart = listFound.start;
        insertAt = listFound.end;
        matchedHeading = listFound.matchedHeading;
      }
    }
  }

  const eof = () => {
    const block = formatAppendBlock({ ...opts, asNestedList: false });
    if (!block) return { body: existingBody || "", location: { appendedAt: "end" } };
    return { body: `${body}${block}`, location: { appendedAt: "end" } };
  };

  if (insertAt < 0) return eof();

  // Nested-list replies only when the window is a single list item.
  // A heading/article window may start on a list line but spans siblings —
  // those keep `#### 续` at section end.
  const listParent =
    parentStart >= 0 && parentStart < lines.length && listMarkerIndent(lines[parentStart]) >= 0
      ? parentStart
      : -1;
  const asNestedList =
    listParent >= 0 && listItemRangeEnd(lines, listParent) >= insertAt;
  const indent = asNestedList ? " ".repeat(listMarkerIndent(lines[listParent]) + 2) : "  ";
  const block = formatAppendBlock({
    ...opts,
    heading: heading || anchorText,
    asNestedList,
    indent,
  });
  if (!block) return { body: existingBody || "", location: { appendedAt: "end" } };

  const minInsert = listParent >= 0 ? listParent + 1 : 0;
  while (insertAt > minInsert && insertAt > 0 && !String(lines[insertAt - 1] || "").trim()) {
    insertAt -= 1;
  }

  const before = lines.slice(0, insertAt).join("\n").replace(/\s+$/u, "");
  const after = lines.slice(insertAt).join("\n");
  const nextBody = after.trim()
    ? `${before}${block}${after.startsWith("\n") ? "" : "\n"}${after}`
    : `${before}${block}`;
  return {
    body: nextBody,
    location: {
      appendedAt: "heading",
      matchedHeading,
      asNestedList,
    },
  };
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
function listRecentlyTouchedMarkdown(workspaceRoot, sinceMs, maxFiles, skipRootNames) {
  /** @type {Array<{ absPath: string, relPath: string, mtimeMs: number }>} */
  const found = [];
  const skipNames = skipRootNames || SKIP_MACHINE_ROOTS;

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
      if (depth === 0 && shouldSkipActivityRoot(e.name, skipNames)) continue;
      // Skip node_modules and .derived at all depths (performance + noise)
      if (e.name === "node_modules" || e.name === ".derived" || e.name === "images") continue;
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
  const memoryDirRel = normalizeMemoryConfig(resolved?.memory || {}).dir || "memory";
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
  const skipRoots = resolveActivitySkipRootNames(workspaceRoot, engineRoot, resolved);
  for (const f of listRecentlyTouchedMarkdown(workspaceRoot, sinceMs, maxFiles, skipRoots)) {
    upsert({
      relPath: f.relPath,
      absPath: f.absPath,
      kind: classifyActivityPath(f.relPath, memoryDirRel),
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
            kind: classifyActivityPath(parentRel, memoryDirRel),
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
 * @param {number} [opts.maxChars=SUGGEST_CORPUS_MAX_CHARS]
 * @returns {string}
 */
/** Human-readable labels for internal reason codes (used in LLM prompt headers). */
const REASON_LABELS = {
  recent_period: "period note",
  mtime: "recently edited",
  anchor: "append target",
  reply_parent: "parent of appended content",
};

export function buildActivityCorpus(window, opts = {}) {
  const maxChars = opts.maxChars ?? SUGGEST_CORPUS_MAX_CHARS;
  const parts = [];
  let used = 0;
  for (const item of window.items || []) {
    const body = (item.content || "").trim();
    if (!body) continue;
    const reasonLabel = REASON_LABELS[item.reason] || item.reason || "activity";
    const header = `### ${item.relPath}${item.period ? ` (${item.period})` : ""} · ${reasonLabel}\n`;
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
