// ── Stream packing: period notes for loose-stream categories ───────────────
// packing: atom | daily | weekly | monthly
// Shared by UTR / Desktop / tests. Content truth remains plain Markdown files.

export const STREAM_PACKINGS = Object.freeze(["atom", "daily", "weekly", "monthly"]);

export const DEFAULT_STREAM = Object.freeze({
  packing: "weekly",
  appendHeading: "day",
  // D1 (2026-08-09): yearDir defaults to true — period notes grouped under
  // {category}/{year}/{period}.md to prevent flat-dir bloat over multiple years.
  // Legacy workspaces with yearDir:false still work (listStreamPeriods scans both).
  yearDir: true,
});

export const DEFAULT_MEMORY = Object.freeze({
  /** Relative dir under workspace; null = first loose-stream / flat-default category */
  dir: null,
  profileFile: "profile.md",
  /** Extra markdown files in memory dir (not including profileFile) */
  files: Object.freeze([]),
});

/**
 * @param {unknown} raw
 * @returns {{ packing: string, appendHeading: string, yearDir: boolean }}
 */
export function normalizeStreamConfig(raw = {}) {
  const packing = STREAM_PACKINGS.includes(raw?.packing) ? raw.packing : DEFAULT_STREAM.packing;
  // Accept both camelCase (appendHeading) and snake_case (append_heading) from v4 contract
  const rawHeading = raw?.appendHeading ?? raw?.append_heading;
  const appendHeading =
    rawHeading === "none" || rawHeading === "day"
      ? rawHeading
      : DEFAULT_STREAM.appendHeading;
  // yearDir: accept both camelCase and snake_case; explicit false stays false;
  // undefined/missing defaults to true (new workspace default per D1).
  const rawYearDir = raw?.yearDir ?? raw?.year_dir;
  const yearDir = rawYearDir === false ? false : rawYearDir === true ? true : DEFAULT_STREAM.yearDir;
  return { packing, appendHeading, yearDir };
}

/**
 * Normalize memory config from v4 contract format.
 * Consumes both v4 nested (memory.layers.global.file) and legacy flat (memory.profileFile).
 *
 * @param {unknown} raw
 * @returns {{ dir: string|null, profileFile: string, files: string[], layers?: object, promotion?: object }}
 */
export function normalizeMemoryConfig(raw = {}) {
  let dir = null;
  if (typeof raw?.dir === "string" && raw.dir.trim()) {
    const cleaned = raw.dir.trim().replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
    if (cleaned && !cleaned.split("/").includes("..")) dir = cleaned;
  }

  // v4: extract profileFile from layers.global.file, fallback to legacy profileFile
  const globalLayer = raw?.layers?.global || {};
  let profileFile =
    (typeof globalLayer.file === "string" && globalLayer.file.trim())
      ? globalLayer.file.trim().replace(/^\/+/u, "")
      : (typeof raw?.profileFile === "string" && raw.profileFile.trim())
        ? raw.profileFile.trim().replace(/^\/+/u, "")
        : DEFAULT_MEMORY.profileFile;
  if (
    !profileFile ||
    profileFile.includes("..") ||
    profileFile.includes("/") ||
    profileFile.includes("\\")
  ) {
    profileFile = DEFAULT_MEMORY.profileFile;
  }

  const files = [];
  if (Array.isArray(raw?.files)) {
    for (const f of raw.files) {
      if (typeof f !== "string") continue;
      const name = f.trim().replace(/^\/+/u, "");
      if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) continue;
      if (!/\.md$/iu.test(name)) continue;
      if (name === profileFile) continue;
      if (!files.includes(name)) files.push(name);
    }
  }

  // Preserve v4 layers and promotion for contract round-trip
  const result = { dir, profileFile, files };
  if (raw?.layers) result.layers = raw.layers;
  if (raw?.promotion) result.promotion = raw.promotion;
  return result;
}

/**
 * ISO week parts (local calendar date; ISO-8601 week number).
 * @param {Date} [date]
 * @returns {{ year: number, week: number, isoYear: number, month: number, day: number, ymd: string, isoWeek: string, monthKey: string }}
 */
export function periodParts(date = new Date()) {
  const local = date instanceof Date ? date : new Date(date);
  const y = local.getFullYear();
  const m = local.getMonth() + 1;
  const day = local.getDate();
  const ymd = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const d = new Date(Date.UTC(y, m - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const isoWeek = `${isoYear}-W${String(week).padStart(2, "0")}`;

  return {
    year: y,
    week,
    isoYear,
    month: m,
    day,
    ymd,
    isoWeek,
    monthKey: `${y}-${String(m).padStart(2, "0")}`,
  };
}

/**
 * File stem (no .md) for the current period under a packing mode.
 * @param {string} packing
 * @param {Date} [date]
 * @returns {string|null} null when atom (caller creates unique file)
 */
export function periodFileStem(packing, date = new Date()) {
  const p = periodParts(date);
  switch (packing) {
    case "daily":
      return p.ymd;
    case "weekly":
      return p.isoWeek;
    case "monthly":
      return p.monthKey;
    case "atom":
    default:
      return null;
  }
}

/**
 * Human title for a period note.
 * @param {string} packing
 * @param {Date} [date]
 */
export function periodNoteTitle(packing, date = new Date()) {
  const p = periodParts(date);
  switch (packing) {
    case "daily":
      return `${p.ymd} 动态`;
    case "weekly":
      return `${p.isoWeek} 动态`;
    case "monthly":
      return `${p.monthKey} 动态`;
    default:
      return "动态";
  }
}

const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * Day section heading inside a weekly/monthly note, e.g. `## 07-22 周二`
 * @param {Date} [date]
 */
export function daySectionHeading(date = new Date()) {
  const p = periodParts(date);
  const wd = WEEKDAY_CN[date.getDay()] || "";
  return `## ${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} 周${wd}`;
}

/**
 * Seed body for a new period note.
 * @param {string} packing
 * @param {Date} [date]
 */
export function seedPeriodNoteBody(packing, date = new Date()) {
  const title = periodNoteTitle(packing, date);
  if (packing === "weekly" || packing === "monthly") {
    return `# ${title}\n\n## 进行中\n\n## 记录\n\n${daySectionHeading(date)}\n`;
  }
  if (packing === "daily") {
    return `# ${title}\n\n## 进行中\n\n## 记录\n\n`;
  }
  return `# ${title}\n\n`;
}

/**
 * Append a capture bullet under today's heading (or end of file).
 * @param {string} existingBody
 * @param {object} opts
 * @param {string} opts.content
 * @param {string} [opts.title]
 * @param {string} opts.packing
 * @param {string} opts.appendHeading — day | none
 * @param {Date} [opts.date]
 * @returns {string}
 */
export function appendToPeriodBody(existingBody, opts) {
  const content = String(opts.content || "").trim();
  const title = opts.title ? String(opts.title).trim() : "";
  const packing = opts.packing || "weekly";
  const appendHeading = opts.appendHeading || "day";
  const date = opts.date || new Date();
  const time = date.toTimeString().slice(0, 5);
  const bullet =
    title && title !== content
      ? `- ${time} **${title}** — ${content}`
      : `- ${time} ${content || title || "(空)"}`;

  let body = (existingBody || "").replace(/\s+$/u, "");
  if (!body.trim()) {
    body = seedPeriodNoteBody(packing, date).replace(/\s+$/u, "");
  }

  const useDay =
    appendHeading === "day" && (packing === "weekly" || packing === "monthly");
  if (useDay) {
    const heading = daySectionHeading(date);
    if (body.includes(heading)) {
      const idx = body.indexOf(heading);
      const afterHeading = idx + heading.length;
      const rest = body.slice(afterHeading);
      const nextH = rest.search(/\n## /u);
      if (nextH === -1) {
        return `${body}\n${bullet}\n`;
      }
      const insertAt = afterHeading + nextH;
      return `${body.slice(0, insertAt).replace(/\s+$/u, "")}\n${bullet}\n${body.slice(insertAt)}`;
    }
    return `${body}\n\n${heading}\n${bullet}\n`;
  }

  return `${body}\n${bullet}\n`;
}

/**
 * Seed markdown for core profile file.
 * @param {string} [title]
 */
export function seedCoreProfileMarkdown(title = "我的情况") {
  const today = periodParts().ymd;
  return `---
title: ${title}
source_type: user-original
memory_layer: global
updated_at: ${today}
---

# ${title}

> 关于我的稳定信息。可以说「记住：…」或点「更新我的情况」让 AI 协助维护。

## 偏好

- （沟通、写作、工作习惯…）

## 当前目标

- （季度/阶段目标）

## 关键的人与协作

- （姓名 — 关系/场景）

## 进行中的事

- （可链到专题路径）
`;
}

/**
 * User-facing label for packing mode.
 * @param {string} packing
 */
export function packingLabel(packing) {
  switch (packing) {
    case "atom":
      return "每条一卡";
    case "daily":
      return "每天一页";
    case "weekly":
      return "每周一本";
    case "monthly":
      return "每月一本";
    default:
      return packing;
  }
}

/**
 * Normalize a bullet/todo line for fuzzy match (strip checkbox, time, bold).
 * @param {string} line
 */
export function normalizeTaskText(line) {
  return String(line || "")
    .replace(/^\s*[-*]\s*/u, "")
    .replace(/^\[[ xX]\]\s*/u, "")
    .replace(/^\d{1,2}:\d{2}\s*/u, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/[。.!！？?\s]+$/u, "")
    .trim()
    .toLowerCase();
}

/**
 * Detect completion signal in a free-text bullet.
 * @param {string} text
 * @returns {string|null} subject fragment if completed, else null
 */
export function detectCompletionSubject(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  // 「X 完成了」「X 已完成」「完成了 X」「X 做完了」
  let m = t.match(/^(?:已经|已)?(?:完成|做完|搞定)了?\s*[:：]?\s*(.+)$/u);
  if (m) return m[1].trim();
  m = t.match(/^(.+?)\s*(?:已经|已)?(?:完成|做完|搞定|结束)了?$/u);
  if (m) return m[1].replace(/^[\[\]xX\s*-]+/u, "").trim();
  m = t.match(/^(.+?)\s*done$/iu);
  if (m) return m[1].trim();
  return null;
}

/**
 * Deterministic period-note reconcile (no LLM).
 * - Dedup identical bullets under the same section
 * - Mark ## 进行中 todos complete when later lines say done
 * - Leave day narrative intact
 *
 * @param {string} body
 * @param {{ packing?: string }} [opts]
 * @returns {{
 *   body: string,
 *   changed: boolean,
 *   changes: string[],
 *   candidates: { core: string[], topics: string[] },
 * }}
 */
export function reconcilePeriodBody(body, opts = {}) {
  const changes = [];
  const candidates = { core: [], topics: [] };
  let text = String(body || "");
  if (!text.trim()) {
    return { body: text, changed: false, changes, candidates };
  }

  // Split into ## sections (keep H1 outside)
  const lines = text.split("\n");
  /** @type {{ heading: string|null, lines: string[] }[]} */
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const line of lines) {
    if (/^##\s+/u.test(line)) {
      sections.push(cur);
      cur = { heading: line, lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  sections.push(cur);

  // Collect completion subjects from all non-heading content
  const completions = [];
  for (const sec of sections) {
    for (const line of sec.lines) {
      if (!/^\s*[-*]\s+/u.test(line)) continue;
      const raw = line.replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/u, "").trim();
      // strip leading time
      const noTime = raw.replace(/^\d{1,2}:\d{2}\s*/u, "");
      const subj = detectCompletionSubject(noTime);
      if (subj) completions.push(normalizeTaskText(subj));
    }
  }

  // Update ## 进行中 section
  for (const sec of sections) {
    if (!sec.heading || !/进行中/u.test(sec.heading)) continue;
    const nextLines = [];
    for (const line of sec.lines) {
      if (/^\s*[-*]\s+\[\s\]\s+/u.test(line)) {
        const task = normalizeTaskText(line);
        const done = completions.some(
          (c) => c && task && (task.includes(c) || c.includes(task)),
        );
        if (done) {
          const marked = line.replace(/\[\s\]/u, "[x]");
          nextLines.push(marked);
          changes.push(`进行中已勾选：${task}`);
          continue;
        }
      }
      nextLines.push(line);
    }
    // Dedup exact lines in 进行中
    const seen = new Set();
    const deduped = [];
    for (const line of nextLines) {
      const key = line.trim();
      if (!key) {
        deduped.push(line);
        continue;
      }
      if (seen.has(key)) {
        changes.push(`去重：${key.slice(0, 40)}`);
        continue;
      }
      seen.add(key);
      deduped.push(line);
    }
    sec.lines = deduped;
  }

  // Dedup within each day section
  for (const sec of sections) {
    if (!sec.heading || /进行中|记录$/u.test(sec.heading)) {
      // still dedup bullets in 记录 / day
    }
    const seen = new Set();
    const deduped = [];
    for (const line of sec.lines) {
      if (!/^\s*[-*]\s+/u.test(line)) {
        deduped.push(line);
        continue;
      }
      const key = normalizeTaskText(line);
      if (key && seen.has(key)) {
        changes.push(`去重：${key.slice(0, 40)}`);
        continue;
      }
      if (key) seen.add(key);
      deduped.push(line);
    }
    sec.lines = deduped;
  }

  // Soft candidates: lines mentioning 目标/偏好/记住 (core) or repeated keywords
  const topicCounts = new Map();
  for (const sec of sections) {
    for (const line of sec.lines) {
      if (!/^\s*[-*]\s+/u.test(line)) continue;
      const raw = line.replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/u, "").replace(/^\d{1,2}:\d{2}\s*/u, "").trim();
      if (/偏好|习惯|目标|我喜欢|记住我/u.test(raw)) {
        if (!candidates.core.includes(raw)) candidates.core.push(raw.slice(0, 120));
      }
      // crude topic: **Title** or 「主题」
      const tm = raw.match(/\*\*([^*]{2,30})\*\*/u) || raw.match(/关于\s*[「"]?([^」"]{2,24})/u);
      if (tm) {
        const k = tm[1].trim();
        topicCounts.set(k, (topicCounts.get(k) || 0) + 1);
      }
    }
  }
  for (const [k, n] of topicCounts) {
    if (n >= 2) candidates.topics.push(k);
  }

  // Rebuild
  const out = [];
  for (const sec of sections) {
    if (sec.heading) out.push(sec.heading);
    out.push(...sec.lines);
  }
  let nextBody = out.join("\n");
  // collapse 3+ blank lines
  nextBody = nextBody.replace(/\n{4,}/gu, "\n\n\n");
  const changed = nextBody !== text || changes.length > 0;
  return {
    body: nextBody,
    changed,
    changes: [...new Set(changes)].slice(0, 40),
    candidates: {
      core: candidates.core.slice(0, 12),
      topics: candidates.topics.slice(0, 12),
    },
  };
}

/**
 * Resolve the sub-directory (if any) for a period note under yearDir mode.
 * Returns "" when yearDir is false, or "YYYY/" when true.
 * @param {string} packing
 * @param {boolean} yearDir
 * @param {Date} [date]
 * @returns {string}
 */
export function periodYearDir(packing, yearDir, date = new Date()) {
  if (!yearDir || packing === "atom") return "";
  const p = periodParts(date);
  // Use isoYear for weekly packing (ISO week may span calendar years)
  const year = packing === "weekly" ? p.isoYear : p.year;
  return `${year}`;
}

/**
 * ISO week key from an mtime / date string for timeline grouping.
 * @param {string|Date} input
 * @returns {string} e.g. 2026-W30
 */
export function isoWeekKeyFromDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return "未知";
  return periodParts(d).isoWeek;
}
