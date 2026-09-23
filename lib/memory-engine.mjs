// ── topmind Memory Engine (Kernel 4/8) ────────────────────────────────────
// Authoritative engine for memory plane (memory/ directory), 3-layer memory
// (global / periodic / topics), stream-to-memory promotion, and conflict detection.
//
// Design principle: memory-engine only handles deterministic physical operations
// on the memory plane. Intelligent decisions (suggest candidates, detect conflicts,
// generate digest content) belong to Surface layer (Desktop/UTR/Skills).

import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { buildFrontmatter } from "./yaml-writer.mjs";
import { executeWrite } from "./writeback-engine.mjs";
import {
  normalizeProfileFactKey,
  profileSectionHasFact,
  validateAiOutput,
} from "./ai-content-sanitize.mjs";
import { resolveAiLocale } from "./ai-output-locale.mjs";
import { loadContract } from "./contract-engine.mjs";
import { normalizeMemoryConfig } from "./stream-period.mjs";

export const MEMORY_DIR_NAME = "memory";

// ── Fact identity & provenance (Markdown comments, not a side store) ───────
// Bullet shape:
//   - （2026-09-17）事实正文 <!-- fid:a1b2c3 src:10-动态/… reason:已完成 -->
// Invisible in most Markdown previews; never pollutes normalizeProfileFactKey.

/**
 * Mint a short stable fact id.
 * @param {string} seed
 * @returns {string}
 */
export function mintFactId(seed = "") {
  if (seed) {
    return createHash("sha1").update(String(seed)).digest("hex").slice(0, 8);
  }
  return randomBytes(4).toString("hex");
}

/**
 * Parse `<!-- fid:… src:… reason:… -->` from a profile bullet (or bare text).
 * @param {string} line
 * @returns {{ fid: string|null, src: string|null, reason: string|null, sup: string|null, text: string }}
 */
export function parseFactMeta(line) {
  const raw = String(line || "");
  let fid = null;
  let src = null;
  let reason = null;
  let sup = null;
  const comment = raw.match(/<!--([\s\S]*?)-->/u);
  if (comment) {
    const body = comment[1];
    const fidM = body.match(/\bfid:([A-Za-z0-9_-]{4,32})/u);
    const srcM = body.match(/\bsrc:(\S+)/u);
    const reasonM = body.match(/\breason:(\S+)/u);
    const supM = body.match(/\bsup:([A-Za-z0-9_-]{4,32})/u);
    if (fidM) fid = fidM[1];
    if (srcM) src = srcM[1];
    if (reasonM) reason = reasonM[1];
    if (supM) sup = supM[1];
  }
  const text = raw
    .replace(/\s*<!--[\s\S]*?-->\s*/gu, " ")
    .replace(/^\s*[-*+]\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return { fid, src, reason, sup, text };
}

/**
 * Append / replace the HTML meta comment on a bullet line.
 * @param {string} line
 * @param {{ fid?: string|null, src?: string|null, reason?: string|null, sup?: string|null }} meta
 * @returns {string}
 */
export function withFactMetaComment(line, meta = {}) {
  const stripped = String(line || "").replace(/\s*<!--[\s\S]*?-->\s*/gu, " ").trimEnd();
  const parts = [];
  const prev = parseFactMeta(line);
  const fid = meta.fid !== undefined ? meta.fid : prev.fid;
  const src = meta.src !== undefined ? meta.src : prev.src;
  const reason = meta.reason !== undefined ? meta.reason : prev.reason;
  const sup = meta.sup !== undefined ? meta.sup : prev.sup;
  if (fid) parts.push(`fid:${fid}`);
  if (src) parts.push(`src:${String(src).replace(/\s+/gu, "_")}`);
  if (reason) parts.push(`reason:${String(reason).replace(/\s+/gu, "_")}`);
  if (sup) parts.push(`sup:${sup}`);
  if (parts.length === 0) return stripped;
  return `${stripped} <!-- ${parts.join(" ")} -->`;
}

/**
 * Locale-aware date / archive / update markers on profile bullets.
 * @param {"zh"|"en"} locale
 * @param {"active"|"archived"|"updated"} kind
 * @param {string} day YYYY-MM-DD
 * @param {string} [extra] e.g. superseded fid
 * @returns {string} prefix including trailing space, or ""
 */
export function profileDateMarker(locale, kind, day, extra = "") {
  if (locale === "en") {
    if (kind === "archived") return `(${day} archived) `;
    if (kind === "updated") return extra ? `(${day} updated → ${extra}) ` : `(${day} updated) `;
    return `(${day}) `;
  }
  if (kind === "archived") return `（${day} 归档）`;
  if (kind === "updated") return extra ? `（${day} 被更新为 ${extra}）` : `（${day} 更新）`;
  return `（${day}）`;
}

/**
 * Append-only change journal on the system plane (deletable / rebuildable).
 * Not a second content truth — audit trail for "what changed in 我的情况".
 * @param {string} workspaceRoot
 * @param {{ op: string, fid?: string|null, section?: string, beforeHash?: string, afterHash?: string, actor?: string, src?: string|null, note?: string }} rec
 */
export function appendMemoryJournal(workspaceRoot, rec) {
  if (!workspaceRoot || !rec?.op) return;
  const abs = path.join(workspaceRoot, ".topmind", "memory-journal.jsonl");
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const line = `${JSON.stringify({
      ts: new Date().toISOString(),
      op: rec.op,
      fid: rec.fid || undefined,
      section: rec.section || undefined,
      beforeHash: rec.beforeHash || undefined,
      afterHash: rec.afterHash || undefined,
      actor: rec.actor || undefined,
      src: rec.src || undefined,
      note: rec.note || undefined,
    })}\n`;
    fs.appendFileSync(abs, line, "utf8");
  } catch {
    /* system plane best-effort */
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
function shortHash(text) {
  return createHash("sha1").update(String(text || "")).digest("hex").slice(0, 10);
}

/**
 * Memory-plane config from the workspace contract (memory.dir +
 * layers.global.file / legacy profileFile). loadContract falls back to
 * in-memory defaults on missing/unreadable yaml, so callers always get a
 * usable config — the hardcoded "memory/profile.md" paths used to fork a
 * twin profile on workspaces with a custom dir or filename (v3 migration
 * itself can produce memory.profileFile).
 * @param {string} workspaceRoot
 * @returns {{ dir: string|null, profileFile: string, files: string[] }}
 */
function memoryConfig(workspaceRoot) {
  let raw = null;
  try {
    raw = loadContract(workspaceRoot)?.memory;
  } catch {
    raw = null;
  }
  return normalizeMemoryConfig(raw || {});
}

/** On-disk heading aliases — English workspaces must not grow a second Chinese section. */
export const PROFILE_SECTION_ALIASES = {
  inProgress: ["进行中的事", "In progress", "In Progress"],
  history: ["历史记录", "History"],
  preferences: ["偏好", "Preferences"],
  goals: ["当前目标", "Current goals"],
  people: ["关键的人与协作", "Key people"],
};

export const PROFILE_SECTION_DEFAULTS = {
  zh: {
    inProgress: "进行中的事",
    history: "历史记录",
    preferences: "偏好",
    goals: "当前目标",
    people: "关键的人与协作",
    title: "我的情况",
  },
  en: {
    inProgress: "In progress",
    history: "History",
    preferences: "Preferences",
    goals: "Current goals",
    people: "Key people",
    title: "My profile",
  },
};

function profileLocalePack(locale) {
  return locale === "en" ? "en" : "zh";
}

/**
 * Prefer a heading that already exists in the profile; otherwise the locale default.
 * @param {string} [body]
 * @param {keyof typeof PROFILE_SECTION_ALIASES} role
 * @param {string} [locale]
 * @returns {string}
 */
export function resolveProfileSectionTitle(body, role, locale = "zh") {
  const aliases = PROFILE_SECTION_ALIASES[role] || [];
  if (body) {
    for (const title of aliases) {
      const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "mu");
      if (re.test(String(body))) return title;
    }
  }
  const pack = PROFILE_SECTION_DEFAULTS[profileLocalePack(locale)];
  return pack[role] || PROFILE_SECTION_DEFAULTS.zh.inProgress;
}

function defaultProfileTemplate(locale = "zh") {
  const p = PROFILE_SECTION_DEFAULTS[profileLocalePack(locale)];
  return `---
title: ${p.title}
source_type: user-original
memory_layer: global
---

# ${p.title}

## ${p.preferences}

## ${p.goals}

## ${p.people}

## ${p.inProgress}
`;
}

/**
 * Canonical locale-aware seed for the global profile file. AI-side creation
 * paths (suggest open_profile apply) must use this instead of hand-rolled
 * frontmatter — a divergent template used to produce a structurally different
 * twin profile.
 * @param {string} [locale] "zh" | "en"
 * @returns {string} markdown body
 */
export function globalProfileSeedMarkdown(locale = "zh") {
  return defaultProfileTemplate(locale);
}

/**
 * Resolve memory directory path in workspace (semantic plane).
 * Honors contract memory.dir; defaults to workspace/memory/.
 * @param {string} workspaceRoot
 * @returns {string} absolute path to the memory dir
 */
export function resolveMemoryDir(workspaceRoot) {
  return path.join(workspaceRoot, memoryConfig(workspaceRoot).dir || MEMORY_DIR_NAME);
}

/**
 * Workspace-relative memory directory (`memory` or contract `memory.dir`).
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function memoryDirRel(workspaceRoot) {
  return memoryConfig(workspaceRoot).dir || MEMORY_DIR_NAME;
}

/**
 * Workspace-relative global profile path (contract dir + profile file).
 * Skip/open evidence must use this, not a hardcoded memory/profile.md.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function globalProfileRelPath(workspaceRoot) {
  const cfg = memoryConfig(workspaceRoot);
  const dir = cfg.dir || MEMORY_DIR_NAME;
  return `${String(dir).replace(/\\/g, "/")}/${cfg.profileFile}`;
}

/**
 * Resolve memory layer paths.
 * The global layer honors contract layers.global.file (v3 profileFile
 * fallback included); periodic/topics live under the configured memory dir.
 * @param {string} workspaceRoot
 * @param {string} layer - "global" | "periodic" | "topics"
 * @param {string} [identifier] - period stem (e.g., "2026-W30") or topic slug
 * @returns {string} absolute path to memory layer (dir for periodic/topics; file for global)
 */
export function resolveMemoryLayerPath(workspaceRoot, layer, identifier) {
  const cfg = memoryConfig(workspaceRoot);
  const memDir = path.join(workspaceRoot, cfg.dir || MEMORY_DIR_NAME);
  switch (layer) {
    case "global":
      return path.join(memDir, cfg.profileFile);
    case "periodic":
      // D4 (2026-08-09): periodic memory uses year subdirectories to align with
      // stream year dirs. Period stems like "2026-W30" → memory/periodic/2026/
      // Legacy flat files (memory/periodic/2026-W30.md) still readable via readMemoryLayer.
      if (identifier) {
        const year = extractPeriodYear(identifier);
        if (year) {
          return path.join(memDir, "periodic", year);
        }
      }
      return path.join(memDir, "periodic");
    case "topics":
      return path.join(memDir, "topics");
    default:
      throw new Error(`Unknown memory layer: ${layer}`);
  }
}

/**
 * Extract 4-digit year from a period stem (e.g., "2026-W30" → "2026", "2026-07-22" → "2026").
 * @param {string} stem
 * @returns {string|null}
 */
function extractPeriodYear(stem) {
  const m = String(stem || "").match(/^(\d{4})-/u);
  return m ? m[1] : null;
}

/** Tokens that must never become a periodic filename (copy/fallback interpolation). */
const FALLBACK_PERIOD_TOKENS = new Set(["period", "undefined", "近期活动", "recent activity"]);

function isFallbackPeriodToken(period) {
  return FALLBACK_PERIOD_TOKENS.has(String(period || "").trim().toLowerCase());
}

/**
 * Workspace-relative path for a periodic reflection.
 * Year subdirectory when the stem has a year (`memory/periodic/{YYYY}/{stem}.md`);
 * otherwise the legacy flat file.
 *
 * With `options.workspaceRoot` the path is resolved exactly like the write
 * side (resolvePeriodMemoryPath): contract memory.dir honored + sticky to an
 * existing legacy flat file, so payload digestPath values never point at a
 * nonexistent year-dir twin. Without it this stays a pure string builder
 * (default memory/ dir, year-shaped).
 * @param {string} period
 * @param {{ workspaceRoot?: string }} [options]
 * @returns {string}
 */
export function periodMemoryRelPath(period, options = {}) {
  const stem = String(period || "").trim();
  if (
    !stem
    || isFallbackPeriodToken(stem)
    || stem.length > 120
    || /[\\/]|\.\./u.test(stem)
    || stem.startsWith(".")
  ) {
    return "";
  }
  if (options.workspaceRoot) {
    const abs = resolvePeriodMemoryPath(options.workspaceRoot, stem);
    return path.relative(options.workspaceRoot, abs).replace(/\\/g, "/");
  }
  const year = extractPeriodYear(stem);
  if (year) return `memory/periodic/${year}/${stem}.md`;
  return `memory/periodic/${stem}.md`;
}

/**
 * Resolve the full file path for a periodic memory file.
 * Prefers year subdirectory (memory/periodic/{year}/{stem}.md);
 * falls back to flat (memory/periodic/{stem}.md) for legacy compat.
 * @param {string} workspaceRoot
 * @param {string} period - period stem (e.g., "2026-W30")
 * @returns {string} absolute path
 */
export function resolvePeriodMemoryPath(workspaceRoot, period) {
  const stem = String(period || "").trim();
  if (isUnsafeMemoryIdentifier(stem)) {
    throw new Error(`resolvePeriodMemoryPath: unsafe period stem ${JSON.stringify(period)}`);
  }
  const memDir = resolveMemoryDir(workspaceRoot);
  const year = extractPeriodYear(stem);
  if (year) {
    const yearPath = path.join(memDir, "periodic", year, `${stem}.md`);
    // Period-path stickiness: a pre-year-grouping workspace may already hold
    // this reflection as a flat file — digest writes must keep landing there
    // instead of forking a year-dir twin (same rationale as stream notes).
    if (!fs.existsSync(yearPath)) {
      const flatPath = path.join(memDir, "periodic", `${stem}.md`);
      if (fs.existsSync(flatPath)) return flatPath;
    }
    return yearPath;
  }
  return path.join(memDir, "periodic", `${stem}.md`);
}

/**
 * Content-truth gate for "period already reflected".
 * True when the sticky digest path holds a non-empty body after frontmatter.
 * Accept then no longer depends on session-only appliedIds — regenerate will
 * skip this period until force (manual refresh) or the file is emptied.
 * @param {string} workspaceRoot
 * @param {string} period
 * @param {{ minBodyLength?: number }} [options]
 * @returns {boolean}
 */
export function hasUsablePeriodDigest(workspaceRoot, period, options = {}) {
  const stem = String(period || "").trim();
  if (!stem || isUnsafeMemoryIdentifier(stem) || isFallbackPeriodToken(stem)) return false;
  const min = Number.isFinite(options.minBodyLength) ? Number(options.minBodyLength) : 40;
  let abs = "";
  try {
    abs = resolvePeriodMemoryPath(workspaceRoot, stem);
  } catch {
    return false;
  }
  if (!fs.existsSync(abs)) return false;
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
    return body.length >= min;
  } catch {
    return false;
  }
}

/**
 * Ensure memory plane 3-layer directory structure exists.
 * @param {string} workspaceRoot
 */
export function ensureMemoryPlane(workspaceRoot) {
  const memDir = resolveMemoryDir(workspaceRoot);
  const periodicDir = path.join(memDir, "periodic");
  const topicsDir = path.join(memDir, "topics");

  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  if (!fs.existsSync(periodicDir)) fs.mkdirSync(periodicDir, { recursive: true });
  if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });
}

/**
 * Read the global core profile memory (memory/profile.md).
 * @param {string} workspaceRoot
 * @returns {string} markdown body
 */
export function readGlobalMemory(workspaceRoot) {
  const file = resolveMemoryLayerPath(workspaceRoot, "global");
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8");
  }
  return "";
}

/**
 * Read memory layer content.
 * @param {string} workspaceRoot
 * @param {string} layer - "global" | "periodic" | "topics"
 * @param {string} [identifier] - period stem (e.g., "2026-W30") or topic slug
 * @returns {string} markdown body
 */
export function readMemoryLayer(workspaceRoot, layer, identifier) {
  const layerPath = resolveMemoryLayerPath(workspaceRoot, layer);
  if (layer === "global") {
    return readGlobalMemory(workspaceRoot);
  }
  if (!identifier) {
    throw new Error(`identifier required for layer ${layer}`);
  }
  if (layer === "periodic") {
    if (isUnsafeMemoryIdentifier(identifier)) {
      throw new Error(`unsafe periodic identifier: ${identifier}`);
    }
    // D4: Try year-subdir path first, then fall back to legacy flat path
    const newPath = resolvePeriodMemoryPath(workspaceRoot, identifier);
    if (fs.existsSync(newPath)) {
      return fs.readFileSync(newPath, "utf8");
    }
    // Legacy flat path: memory/periodic/{period}.md (pre-yearDir)
    const legacyPath = path.join(resolveMemoryDir(workspaceRoot), "periodic", `${identifier}.md`);
    if (fs.existsSync(legacyPath)) {
      return fs.readFileSync(legacyPath, "utf8");
    }
    return "";
  }
  if (isUnsafeMemoryIdentifier(identifier)) {
    throw new Error(`unsafe topics identifier: ${identifier}`);
  }
  const file = path.join(layerPath, `${identifier}.md`);
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8");
  }
  return "";
}

/**
 * Append entry to global profile memory (memory/profile.md).
 * Appends to appropriate section based on entry type.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {object} options.entry - { section: string, content: string }
 * @param {object} [options.contract] - v4 contract object
 * @returns {object} write evidence
 */
/**
 * Normalize entry: string | { section?, content } → { section, content }.
 * Never write bare "undefined" when callers pass a string.
 */
export function normalizeMemoryEntry(entry, defaultSection = "进行中的事") {
  if (entry == null) {
    throw new Error("appendProfileEntry requires entry");
  }
  if (typeof entry === "string") {
    const content = entry.trim();
    if (!content) throw new Error("appendProfileEntry entry content empty");
    return { section: defaultSection, content };
  }
  if (typeof entry === "object") {
    const content = String(entry.content ?? entry.text ?? entry.body ?? "").trim();
    if (!content) throw new Error("appendProfileEntry entry.content required");
    let section = String(entry.section || defaultSection).trim() || defaultSection;
    // Section titles become `## ${section}` headings — reject structure injection.
    if (/[#\n\r/\\]/u.test(section) || section.length > 80) {
      throw new Error(`appendProfileEntry: invalid section title ${JSON.stringify(section)}`);
    }
    return { section, content };
  }
  throw new Error("appendProfileEntry entry must be string or { section, content }");
}

/**
 * Write-gate args for profile mutations. Default actor is "ai" so callers
 * that forget to pass actor cannot silently impersonate the user and skip
 * confirm-mode writeback. Surfaces that already confirmed (UTR / applySuggestion
 * / user RPC) must pass actor:"user" explicitly.
 * Desktop AI wrapWrite passes actor:"ai" and confirmed from writeback mode.
 * @param {{ actor?: string, confirmed?: boolean }} opts
 */
function memoryWriteGate({ actor, confirmed } = {}) {
  const writeActor = actor === "user" ? "user" : "ai";
  return {
    actor: writeActor,
    confirmed: writeActor === "user" ? confirmed !== false : confirmed === true,
  };
}

export function appendProfileEntry({ workspaceRoot, entry, contract, actor, confirmed, writebackModeOverride, src }) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  ensureMemoryPlane(workspaceRoot);
  const locale = resolveAiLocale(contract);
  const lang = profileLocalePack(locale);

  // Read existing profile first so the default section matches headings already
  // on disk (English "In progress" must not fork a second 「进行中的事」).
  let body = "";
  if (fs.existsSync(profilePath)) {
    body = fs.readFileSync(profilePath, "utf8").replace(/\r\n?/gu, "\n");
  } else {
    body = defaultProfileTemplate(locale);
  }
  const defaultSection = resolveProfileSectionTitle(body, "inProgress", locale);
  let { section, content } = normalizeMemoryEntry(entry, defaultSection);

  // Sanitize AI-sourced lines; never append placeholders / thinking dumps.
  // Entry may be short (a single fact) — central gate with minimal length floor.
  const checked = validateAiOutput(content, "memory", { minLength: 1 });
  if (!checked.ok) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "skipped empty or polluted profile entry",
      reason: checked.reason || "placeholder-or-polluted",
    };
  }
  content = checked.text;
  // Normalize to a list bullet so inventory / retire / update line math stays
  // consistent even when callers pass bare prose.
  if (!/^\s*[-*+]\s+/u.test(content)) {
    content = `- ${content}`;
  }
  // Mint fid + provenance (src) on every new live fact.
  const day = new Date().toISOString().slice(0, 10);
  const existingMeta = parseFactMeta(content);
  const fid = existingMeta.fid || mintFactId(`${section}|${normalizeProfileFactKey(content)}|${day}`);
  const srcHint = existingMeta.src || (src ? String(src).replace(/\\/g, "/").slice(0, 160) : null);
  // Ensure a date marker on the live fact (locale-aware).
  const strippedText = parseFactMeta(content).text.replace(/^[（(]\d{4}-\d{2}-\d{2}[^)）]*[)）]\s*/u, "");
  const dated = `- ${profileDateMarker(lang, "active", day)}${strippedText}`;
  content = withFactMetaComment(dated, { fid, src: srcHint });

  // Live-section dedupe (not just the target heading): a second append of the
  // same fact must not create a live duplicate in another section. History is
  // not live — re-appending a retired fact is allowed (re-activation).
  if (liveProfileHasFact(body, content, locale)) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "profile fact already present (deduped)",
      reason: "duplicate-fact",
    };
  }

  // `[ \t]*` tolerates trailing whitespace after the heading so a stray space
  // does not fork a duplicate section at file end.
  const sectionRegex = new RegExp(`(## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`, "u");
  const match = body.match(sectionRegex);

  if (match) {
    const sectionContent = match[2].trim();
    const newSectionContent = sectionContent
      ? `${sectionContent}\n\n${content}`
      : content;
    body = body.replace(sectionRegex, `$1\n${newSectionContent}\n`);
  } else {
    body += `\n## ${section}\n\n${content}\n`;
  }

  const evidence = executeWrite({
    targetPath: profilePath,
    content: body,
    workspaceRoot,
    contract,
    operation: "update",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
    writebackModeOverride,
  });
  if (evidence.wroteFiles !== false) {
    appendMemoryJournal(workspaceRoot, {
      op: "append",
      fid,
      section,
      afterHash: shortHash(content),
      actor: actor || "ai",
      src: srcHint,
    });
  }
  return evidence;
}

/**
 * True when `content` already exists as a live (non-history) profile fact.
 * Used so append never forks a second live line in a different section.
 * @param {string} body
 * @param {string} content
 * @param {string} [locale]
 * @returns {boolean}
 */
function liveProfileHasFact(body, content, locale = "zh") {
  const historyTitle = resolveProfileSectionTitle(body, "history", locale);
  const historyTitles = new Set(PROFILE_SECTION_ALIASES.history);
  historyTitles.add(historyTitle);
  for (const b of parseProfileSections(body)) {
    if (b.title == null || historyTitles.has(b.title)) continue;
    if (profileSectionHasFact(b.body, content)) return true;
  }
  return false;
}

/**
 * Parse profile body into `## section` blocks (frontmatter kept in a pseudo
 * block so indexes stay rebuildable). Used by consolidation operations.
 * @param {string} body
 * @returns {Array<{ title: string|null, start: number, end: number, body: string }>}
 */
function parseProfileSections(body) {
  const lines = String(body || "").split("\n");
  const blocks = [];
  let current = { title: null, start: 0, end: lines.length, body: "" };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/u);
    if (m) {
      current.end = i;
      blocks.push(current);
      current = { title: m[1], start: i, end: lines.length, body: "" };
    }
  }
  blocks.push(current);
  for (const b of blocks) {
    b.body = lines.slice(b.start, b.end).join("\n");
  }
  return blocks;
}

/**
 * Indices of fact lines in `sectionBody` matching `match` (normalized equality
 * or short-query containment inside an existing fact — one direction only).
 * Bidirectional substring (`key.includes(existing)`) let a long match
 * retire/update every shorter fact it contained. Containment is
 * `existing.includes(key)` only: a short distinctive query like「技术论文」
 * may match a longer fact; a long query must not match a short fact.
 * Section heading lines never match.
 * @param {string} sectionBody
 * @param {string} match
 * @returns {number[]}
 */
function findProfileFactLineIndexes(sectionBody, match) {
  const key = normalizeProfileFactKey(match);
  // Fid-first: a stable id addresses one fact even after rephrase.
  const fidMatch = String(match || "").match(/^(?:fid:)?([A-Za-z0-9_-]{4,32})$/u);
  const lines = String(sectionBody || "").split("\n");
  if (fidMatch && /^[0-9a-f]{8}$/u.test(fidMatch[1])) {
    const fid = fidMatch[1];
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/u.test(lines[i])) continue;
      const meta = parseFactMeta(lines[i]);
      if (meta.fid === fid) hits.push(i);
    }
    if (hits.length > 0) return hits;
  }
  if (!key || key.length < 2) return [];
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/u.test(lines[i])) continue;
    const existing = normalizeProfileFactKey(lines[i]);
    if (!existing) continue;
    if (existing === key) { hits.push(i); continue; }
    if (existing.includes(key)) {
      hits.push(i);
    }
  }
  return hits;
}

/**
 * Read raw profile body ("" when absent) without creating the plane.
 * CRLF is normalized to LF so consolidation line math stays consistent.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function readProfileBody(workspaceRoot) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  if (!fs.existsSync(profilePath)) return "";
  return fs.readFileSync(profilePath, "utf8").replace(/\r\n?/gu, "\n");
}

/**
 * Reject identifiers that could escape their slot under memory/ (path
 * separators, parent segments, hidden names). Slugs and period stems must
 * stay single path segments — workspace-level fencing does not stop an
 * in-workspace hop from memory/topics to memory/profile.md.
 * @param {string} id
 * @returns {boolean}
 */
function isUnsafeMemoryIdentifier(id) {
  const s = String(id || "").trim();
  return !s || s.length > 120 || /[\\/]|\.\./u.test(s) || s.startsWith(".");
}

/**
 * Collapse the history section of an already-read profile body to a count line.
 * Surfaces that cannot call `readProfileActiveBody` (packaging twins) can reuse
 * this on a raw string so archived facts never re-enter prompts as current truth.
 * @param {string} body
 * @param {{ historySection?: string, locale?: string, profileRel?: string }} [options]
 * @returns {string}
 */
export function collapseProfileHistoryBody(body, { historySection, locale = "zh", profileRel = "memory/profile.md" } = {}) {
  const text = String(body || "");
  if (!text) return "";
  const historyTitle = historySection || resolveProfileSectionTitle(text, "history", locale);
  const blocks = parseProfileSections(text);
  const hist = blocks.find((b) => b.title === historyTitle);
  if (!hist) return text;
  const lines = text.split("\n");
  const retiredCount = hist.body.split("\n").filter((l) => /^\s*[-*+]\s+\S/u.test(l)).length;
  const summaryLine = historyTitle === "History" || locale === "en"
    ? `- ${retiredCount} archived fact(s) (see ${profileRel})`
    : `- ${retiredCount} 条已归档条目（略，见 ${profileRel}）`;
  const summary = `## ${historyTitle}\n\n${summaryLine}\n`;
  return `${lines.slice(0, hist.start).join("\n")}\n${summary}`;
}

/**
 * Read the profile for AI prompt context with the history section collapsed
 * to a one-line summary. Retired facts must not re-enter prompts formatted
 * identically to current facts — and must not crowd active sections out of
 * the char budget as the archive grows.
 * @param {string} workspaceRoot
 * @param {{ historySection?: string, locale?: string }} [options]
 * @returns {string}
 */
export function readProfileActiveBody(workspaceRoot, { historySection, locale = "zh" } = {}) {
  const body = readProfileBody(workspaceRoot);
  if (!body) return "";
  return collapseProfileHistoryBody(body, {
    historySection,
    locale,
    profileRel: globalProfileRelPath(workspaceRoot),
  });
}

/**
 * Retire a fact from active profile sections into a history section.
 * Confirm-gated consolidation (mem0-style DELETE semantics, but visible and
 * reversible in markdown): the fact line moves to `## {historySection}` with a
 * retirement date marker — nothing is deleted from the file.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.match - fact text to locate (exact/normalized containment)
 * @param {string} [options.section] - restrict search to this section; default scan all non-history
 * @param {string} [options.historySection="历史记录"]
 * @param {object} [options.contract] - v4 contract object
 * @returns {object} write evidence
 */
export function retireProfileEntry({ workspaceRoot, match, section, historySection, contract, actor, confirmed, writebackModeOverride, reason }) {
  const opts = { reason };
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  const target = String(match || "").trim();
  if (!target) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "retire requires match text", reason: "no-match-text" };
  }
  const locale = resolveAiLocale(contract);
  const bodyForDetect = readProfileBody(workspaceRoot);
  const historyTitle = historySection || resolveProfileSectionTitle(bodyForDetect, "history", locale);
  const historyTitles = new Set(PROFILE_SECTION_ALIASES.history);
  historyTitles.add(historyTitle);
  if (section && historyTitles.has(section)) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "cannot retire from the history section itself", reason: "invalid-section" };
  }
  const body = bodyForDetect;
  if (!body) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "profile.md not found", reason: "no-profile" };
  }

  const blocks = parseProfileSections(body);
  const searchable = section
    ? blocks.filter((b) => b.title === section)
    : blocks.filter((b) => b.title !== null && !historyTitles.has(b.title));

  let hitBlock = null;
  let hitLines = [];
  for (const b of searchable) {
    const hits = findProfileFactLineIndexes(b.body, target);
    if (hits.length > 0) { hitBlock = b; hitLines = hits; break; }
  }
  if (!hitBlock) {
    // Already retired (present in history) is a benign skip, not an error.
    const hist = blocks.find((b) => b.title === historyTitle);
    if (hist && findProfileFactLineIndexes(hist.body, target).length > 0) {
      return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "fact already retired to history section", reason: "already-retired" };
    }
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "no matching fact in active sections", reason: "no-matching-fact" };
  }

  // Remove matched lines from the owning section block (global line index).
  const blockStartLine = hitBlock.start;
  const removed = hitLines.map((i) => {
    const globalIdx = blockStartLine + i;
    return body.split("\n")[globalIdx];
  });
  const lines = body.split("\n");
  for (let i = hitLines.length - 1; i >= 0; i--) {
    lines.splice(blockStartLine + hitLines[i], 1);
  }
  let newBody = lines.join("\n");

  // Append retired lines under history section (create it when absent).
  // Preserve fid; record optional reason in the meta comment.
  const retireDate = new Date().toISOString().slice(0, 10);
  const lang = profileLocalePack(locale);
  const retireReason = String(opts?.reason || "").trim().slice(0, 40) || null;
  const retiredFids = [];
  const retiredLines = removed
    .map((l) => {
      const meta = parseFactMeta(l);
      const plain = parseFactMeta(l).text
        .replace(/^[（(]\d{4}-\d{2}-\d{2}[^)）]*[)）]\s*/u, "")
        .trim();
      if (!plain) return null;
      if (meta.fid) retiredFids.push(meta.fid);
      const body = `- ${profileDateMarker(lang, "archived", retireDate)}${plain}`;
      return withFactMetaComment(body, {
        fid: meta.fid || null,
        src: meta.src || null,
        reason: retireReason || meta.reason || null,
      });
    })
    .filter(Boolean);
  const histRegex = new RegExp(`^(## ${historyTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*)$`, "mu");
  if (histRegex.test(newBody)) {
    newBody = newBody.replace(histRegex, `$1\n${retiredLines.join("\n")}`);
  } else {
    newBody = `${newBody.replace(/\s*$/u, "")}\n\n## ${historyTitle}\n\n${retiredLines.join("\n")}\n`;
  }

  const evidence = executeWrite({
    targetPath: profilePath,
    content: newBody,
    workspaceRoot,
    contract,
    operation: "update",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
    writebackModeOverride,
  });
  if (evidence.wroteFiles !== false) {
    for (const fid of retiredFids.length ? retiredFids : [null]) {
      appendMemoryJournal(workspaceRoot, {
        op: "retire",
        fid,
        section: historyTitle,
        actor: actor || "ai",
        note: retireReason || undefined,
      });
    }
  }
  return evidence;
}

/**
 * Update a fact in place with corrected content (mem0-style UPDATE semantics).
 * The matched line is replaced by a dated new fact; the old wording is not
 * retained (git/history section covers audit for retire, not update).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.match - fact text to locate
 * @param {string} options.content - corrected fact content
 * @param {string} [options.section] - restrict search to this section
 * @param {string} [options.historySection="历史记录"] - archived facts are never updated in place
 * @param {object} [options.contract] - v4 contract object
 * @returns {object} write evidence
 */
export function updateProfileEntry({ workspaceRoot, match, content, section, historySection, contract, actor, confirmed, writebackModeOverride }) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  const target = String(match || "").trim();
  if (!target) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "update requires match text", reason: "no-match-text" };
  }
  const locale = resolveAiLocale(contract);
  const bodyForDetect = readProfileBody(workspaceRoot);
  const historyTitle = historySection || resolveProfileSectionTitle(bodyForDetect, "history", locale);
  const historyTitles = new Set(PROFILE_SECTION_ALIASES.history);
  historyTitles.add(historyTitle);
  if (section && historyTitles.has(section)) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "archived facts are not updated in place; edit the file manually", reason: "invalid-section" };
  }
  const checked = validateAiOutput(content, "memory", { minLength: 1 });
  if (!checked.ok) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "skipped empty or polluted profile update", reason: checked.reason || "placeholder-or-polluted" };
  }
  const body = bodyForDetect;
  if (!body) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "profile.md not found", reason: "no-profile" };
  }

  const blocks = parseProfileSections(body);
  // History section is an audit record — update never rewrites archived lines.
  const searchable = section
    ? blocks.filter((b) => b.title === section && !historyTitles.has(b.title))
    : blocks.filter((b) => b.title !== null && !historyTitles.has(b.title));
  let hitBlock = null;
  let hitLine = -1;
  for (const b of searchable) {
    const hits = findProfileFactLineIndexes(b.body, target);
    if (hits.length > 0) { hitBlock = b; hitLine = hits[0]; break; }
  }
  if (!hitBlock) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "no matching fact to update", reason: "no-matching-fact" };
  }

  // Dedupe: replacement already present elsewhere → nothing to change.
  const lines = body.split("\n");
  const globalIdx = hitBlock.start + hitLine;
  const without = lines.filter((_, i) => i !== globalIdx).join("\n");
  const sectionOfLine = hitBlock.title || "";
  const remainingSectionBody = parseProfileSections(without)
    .find((b) => (b.title || "") === sectionOfLine)?.body || "";
  if (profileSectionHasFact(remainingSectionBody, checked.text)) {
    return { operation: "skip", wroteFiles: false, wrote_files: false, targetPath: globalProfileRelPath(workspaceRoot), target_path: profilePath, note: "updated fact already present (deduped)", reason: "duplicate-fact" };
  }

  const day = new Date().toISOString().slice(0, 10);
  const lang = profileLocalePack(locale);
  const oldLine = lines[globalIdx];
  const oldMeta = parseFactMeta(oldLine);
  const newFid = oldMeta.fid || mintFactId(`${normalizeProfileFactKey(checked.text)}|${day}`);
  const plainNew = parseFactMeta(checked.text).text
    .replace(/^[（(]\d{4}-\d{2}-\d{2}[^)）]*[)）]\s*/u, "")
    .trim();
  lines[globalIdx] = withFactMetaComment(
    `- ${profileDateMarker(lang, "active", day)}${plainNew}`,
    { fid: newFid, src: oldMeta.src || null },
  );
  // Audit: superseded wording moves to history (precious memory keeps a trail).
  let nextBody = lines.join("\n");
  const supersededPlain = (oldMeta.text || "")
    .replace(/^[（(]\d{4}-\d{2}-\d{2}[^)）]*[)）]\s*/u, "")
    .trim();
  if (supersededPlain && supersededPlain !== plainNew) {
    const archived = withFactMetaComment(
      `- ${profileDateMarker(lang, "archived", day)}${supersededPlain}`,
      { fid: oldMeta.fid || mintFactId(supersededPlain), sup: newFid, src: oldMeta.src || null },
    );
    const histTitle = historyTitle;
    const histRegex2 = new RegExp(`^(## ${histTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*)$`, "mu");
    if (histRegex2.test(nextBody)) {
      nextBody = nextBody.replace(histRegex2, `$1\n${archived}`);
    } else {
      nextBody = `${nextBody.replace(/\s*$/u, "")}\n\n## ${histTitle}\n\n${archived}\n`;
    }
  }
  const evidence = executeWrite({
    targetPath: profilePath,
    content: nextBody,
    workspaceRoot,
    contract,
    operation: "update",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
    writebackModeOverride,
  });
  if (evidence.wroteFiles !== false) {
    appendMemoryJournal(workspaceRoot, {
      op: "update",
      fid: newFid,
      section: sectionOfLine || undefined,
      beforeHash: shortHash(oldMeta.text || ""),
      afterHash: shortHash(plainNew),
      actor: actor || "ai",
    });
  }
  return evidence;
}

/**
 * Append entry to topic memory (memory/topics/{slug}.md).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.slug - topic slug
 * @param {object} options.entry - { content: string }
 * @param {object} [options.contract] - v4 contract object
 * @returns {object} write evidence
 */
export function appendTopicEntry({ workspaceRoot, slug, entry, contract, actor, confirmed }) {
  const topicsDir = resolveMemoryLayerPath(workspaceRoot, "topics");
  ensureMemoryPlane(workspaceRoot);

  const topicPath = path.join(topicsDir, `${slug}.md`);
  if (isUnsafeMemoryIdentifier(slug)) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: `${memoryDirRel(workspaceRoot)}/topics/${slug}.md`,
      target_path: topicPath,
      note: "topic slug must be a single safe path segment",
      reason: "invalid-slug",
    };
  }
  let { content } = normalizeMemoryEntry(entry, "notes");

  // Sanitize AI-sourced lines; never append placeholders / thinking dumps.
  const checked = validateAiOutput(content, "memory", { minLength: 1 });
  if (!checked.ok) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: `${memoryDirRel(workspaceRoot)}/topics/${slug}.md`,
      target_path: topicPath,
      note: "skipped empty or polluted topic entry",
      reason: checked.reason || "placeholder-or-polluted",
    };
  }
  content = checked.text;

  // Read existing topic memory
  let body = "";
  if (fs.existsSync(topicPath)) {
    body = fs.readFileSync(topicPath, "utf8");
  } else {
    // Create new topic memory
    body = `---
title: ${slug}
source_type: user-original
memory_layer: topic
created_at: ${new Date().toISOString()}
---

# ${slug}

`;
  }

  body += `\n${content}\n`;

  return executeWrite({
    targetPath: topicPath,
    content: body,
    workspaceRoot,
    contract,
    operation: fs.existsSync(topicPath) ? "update" : "create",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
  });
}

/**
 * Write period reflection to memory/periodic/{year}/{period}.md.
 *
 * D4 (2026-08-09): Periodic memory is now a REFLECTION (insights about the user),
 * not a DIGEST (compressed stream copy). The content should capture patterns,
 * preferences, knowledge gains, and behavioral signals — not event summaries.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.period - period stem (e.g., "2026-W30")
 * @param {string} options.body - reflection content (without frontmatter)
 * @param {object} [options.contract] - v4 contract object
 * @param {string[]} [options.derivedFrom] - source paths
 * @returns {object} write evidence
 */
export function writePeriodDigest({ workspaceRoot, period, body, contract, derivedFrom = [], actor, confirmed }) {
  ensureMemoryPlane(workspaceRoot);

  const periodKey = String(period || "").trim();
  if (!periodKey || isUnsafeMemoryIdentifier(periodKey) || isFallbackPeriodToken(periodKey)) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: "",
      target_path: "",
      note: "period stem must be a single safe path segment",
      reason: "invalid-period",
    };
  }

  const digestPath = resolvePeriodMemoryPath(workspaceRoot, periodKey);
  const digestRel = periodMemoryRelPath(periodKey, { workspaceRoot });

  // Ensure year subdirectory exists
  const yearDir = path.dirname(digestPath);
  if (!fs.existsSync(yearDir)) {
    fs.mkdirSync(yearDir, { recursive: true });
  }

  // Never write placeholder / thinking / empty pollution into memory/periodic
  const usable = validateAiOutput(body, "memory", { minLength: 8 });
  if (!usable.ok) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: digestRel,
      target_path: digestRel,
      note: "skipped empty or polluted period reflection",
      reason: usable.reason || "placeholder-or-polluted",
    };
  }
  const cleanBody = usable.text;

  const exists = fs.existsSync(digestPath);
  // Update-in-place for same period (merge = replace body, refresh meta) — never
  // stack redundant repeated summaries under a new name or append to the same file.
  const prevDerived = [];
  if (exists) {
    try {
      const prev = fs.readFileSync(digestPath, "utf8");
      const m = prev.match(/derived_from:\s*\n((?:\s+-\s+.+\n?)+)/u);
      if (m) {
        for (const line of m[1].match(/-\s+(.+)/gu) || []) {
          const p = line.replace(/^-\s+/u, "").trim().replace(/^["']|["']$/gu, "");
          if (p) prevDerived.push(p);
        }
      }
    } catch {
      /* ignore */
    }
  }
  const mergedFrom = [...new Set([...(derivedFrom || []), ...prevDerived])].filter(Boolean).slice(0, 16);

  const frontmatter = buildFrontmatter({
    title: `${periodKey} 周期洞察`,
    source_type: "ai-derived",
    memory_layer: "periodic",
    derived_from: mergedFrom.length > 0 ? mergedFrom : undefined,
    generated_at: new Date().toISOString(),
  });

  const content = `${frontmatter}\n${cleanBody}`;

  return executeWrite({
    targetPath: digestPath,
    content,
    workspaceRoot,
    contract,
    operation: exists ? "update" : "create",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
  });
}

/**
 * Promote stream item to memory (physical move + promoted_from/to marking).
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {object} options.item - { path: string, content: string, title: string }
 * @param {object} options.target - { layer: string, slug?: string, section?: string }
 * @param {object} [options.contract] - v4 contract object
 * @returns {object} write evidence
 */
export function promoteStreamItem({ workspaceRoot, item, target, contract, actor, confirmed }) {
  ensureMemoryPlane(workspaceRoot);

  const evidence = {
    operation: "promote",
    source_path: item.path,
    target_path: null,
    wrote_files: false,
    saved_at: new Date().toISOString(),
  };

  // Write to target memory layer
  if (target.layer === "global") {
    const result = appendProfileEntry({
      workspaceRoot,
      entry: { section: target.section || "进行中的事", content: item.content },
      contract,
      actor,
      confirmed,
    });
    evidence.target_path = result.target_path;
  } else if (target.layer === "topics") {
    if (!target.slug) throw new Error("slug required for topics layer");
    const result = appendTopicEntry({
      workspaceRoot,
      slug: target.slug,
      entry: { content: item.content },
      contract,
      actor,
      confirmed,
    });
    evidence.target_path = result.target_path;
  } else {
    throw new Error(`Unknown target layer: ${target.layer}`);
  }

  // Mark source item with promoted_to via write gate
  if (item.path && fs.existsSync(item.path)) {
    let sourceBody = fs.readFileSync(item.path, "utf8");
    const absTarget = evidence.target_path || evidence.targetPath;
    const relativeTarget = path.isAbsolute(String(absTarget))
      ? path.relative(workspaceRoot, absTarget).replace(/\\/g, "/")
      : String(absTarget || "").replace(/\\/g, "/");

    if (sourceBody.startsWith("---")) {
      // Find the closing --- delimiter (search from position 3 to skip the opening ---)
      const fmEnd = sourceBody.indexOf("\n---", 3);
      if (fmEnd > 0) {
        // Insert promoted_to BEFORE the closing --- so it becomes a frontmatter field
        const before = sourceBody.slice(0, fmEnd + 1);  // up to and including the \n before ---
        const after = sourceBody.slice(fmEnd + 1);       // ---\n...rest
        if (!before.includes("promoted_to:")) {
          sourceBody = `${before}promoted_to: "${relativeTarget}"\n${after}`;
        }
      }
    } else {
      sourceBody = `---\npromoted_to: "${relativeTarget}"\n---\n\n${sourceBody}`;
    }

    executeWrite({
      targetPath: item.path,
      content: sourceBody,
      workspaceRoot,
      contract,
      operation: "update",
      ...memoryWriteGate({ actor, confirmed }),
      skipShadow: true,
    });
  }

  evidence.wrote_files = true;
  evidence.target_path = evidence.target_path || evidence.targetPath;
  return evidence;
}

// ── Memory quality: inventory · health · restore · ranked prompt ────────────
// Global memory is precious. These helpers treat the profile as a curated
// fact set (not an append log): structured inventory, near-dupe/empty-section
// health, reversible retire, and priority-ranked prompt injection.

/**
 * Structured inventory of profile facts.
 * @param {string} workspaceRoot
 * @param {{ contract?: object, locale?: string }} [opts]
 * @returns {{
 *   exists: boolean,
 *   profilePath: string,
 *   sections: Array<{ title: string, role: string|null, isHistory: boolean, facts: Array<{ text: string, key: string, date: string|null }> }>,
 *   activeCount: number,
 *   historyCount: number,
 * }}
 */
export function listProfileFacts(workspaceRoot, opts = {}) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  const locale = resolveAiLocale(opts.contract);
  const body = readProfileBody(workspaceRoot);
  if (!body) {
    return {
      exists: false,
      profilePath: globalProfileRelPath(workspaceRoot),
      sections: [],
      activeCount: 0,
      historyCount: 0,
    };
  }
  const historyTitle = resolveProfileSectionTitle(body, "history", locale);
  const historyTitles = new Set(PROFILE_SECTION_ALIASES.history);
  historyTitles.add(historyTitle);
  /** @type {Array<{ title: string, role: string|null, isHistory: boolean, facts: Array<{ text: string, key: string, date: string|null, fid: string|null, src: string|null, reason: string|null, sup: string|null, line: string }> }>} */
  const sections = [];
  let activeCount = 0;
  let historyCount = 0;
  for (const block of parseProfileSections(body)) {
    if (block.title == null) continue;
    const isHistory = historyTitles.has(block.title);
    const facts = [];
    for (const line of block.body.split("\n")) {
      if (!/^\s*[-*+]\s+\S/u.test(line)) continue;
      const meta = parseFactMeta(line);
      const text = meta.text;
      if (!text) continue;
      const dateMatch = text.match(/^[（(](\d{4}-\d{2}-\d{2})(?:\s*(?:归档|archived|updated)[^)）]*)?[)）]\s*/u);
      facts.push({
        text,
        key: normalizeProfileFactKey(text),
        date: dateMatch ? dateMatch[1] : null,
        fid: meta.fid,
        src: meta.src,
        reason: meta.reason,
        sup: meta.sup,
        line,
      });
      if (isHistory) historyCount += 1;
      else activeCount += 1;
    }
    sections.push({
      title: block.title,
      role: resolveSectionRole(block.title),
      isHistory,
      facts,
    });
  }
  return {
    exists: true,
    profilePath: globalProfileRelPath(workspaceRoot),
    sections,
    activeCount,
    historyCount,
  };
}

/**
 * @param {string} title
 * @returns {string|null}
 */
function resolveSectionRole(title) {
  for (const [role, aliases] of Object.entries(PROFILE_SECTION_ALIASES)) {
    if (aliases.includes(title)) return role;
  }
  return null;
}

/**
 * Near-dupe score in [0,1] for two normalized fact keys.
 * Equality = 1; long-side containment + shared token ratio.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function factSimilarity(a, b) {
  const ka = normalizeProfileFactKey(a);
  const kb = normalizeProfileFactKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const longer = ka.length >= kb.length ? ka : kb;
  const shorter = ka.length >= kb.length ? kb : ka;
  // CJK containment floor of 4 (深色模式 is a meaningful fact fragment).
  if (shorter.length >= 4 && longer.includes(shorter)) return 0.92;
  // CJK-aware-ish token split: alnum runs + individual CJK chars (bigrams too).
  const tokenize = (s) => {
    const tokens = new Set();
    for (const m of s.matchAll(/[a-z0-9]+|[一-鿿]/gu)) {
      tokens.add(m[0]);
    }
    const cjk = s.match(/[一-鿿]/gu) || [];
    for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk[i] + cjk[i + 1]);
    return tokens;
  };
  const ta = tokenize(ka);
  const tb = tokenize(kb);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const jaccard = inter / (ta.size + tb.size - inter);
  return Math.round(jaccard * 100) / 100;
}

/**
 * Deterministic health report for the global profile.
 * Surfaces near-dupes, empty sections, and oversized history so surfaces can
 * prompt a tidy-up — never mutates the file.
 *
 * @param {string} workspaceRoot
 * @param {{ contract?: object, nearDupeThreshold?: number, maxFacts?: number }} [opts]
 */
export function analyzeProfileHealth(workspaceRoot, opts = {}) {
  const inv = listProfileFacts(workspaceRoot, { contract: opts.contract });
  const threshold = Number.isFinite(opts.nearDupeThreshold) ? Number(opts.nearDupeThreshold) : 0.72;
  /** @type {Array<{ a: string, b: string, score: number, sectionA: string, sectionB: string }>} */
  const nearDupes = [];
  /** @type {Array<{ a: string, b: string, score: number, sectionA: string, sectionB: string }>} */
  const exactDupes = [];
  const active = [];
  for (const sec of inv.sections) {
    if (sec.isHistory) continue;
    for (const f of sec.facts) {
      active.push({ ...f, section: sec.title });
    }
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const score = factSimilarity(active[i].key, active[j].key);
      if (score >= 1) {
        exactDupes.push({
          a: active[i].text,
          b: active[j].text,
          score,
          sectionA: active[i].section,
          sectionB: active[j].section,
        });
      } else if (score >= threshold) {
        nearDupes.push({
          a: active[i].text,
          b: active[j].text,
          score,
          sectionA: active[i].section,
          sectionB: active[j].section,
        });
      }
    }
  }
  const emptySections = inv.sections
    .filter((s) => !s.isHistory && s.facts.length === 0)
    .map((s) => s.title);
  const maxFacts = Number.isFinite(opts.maxFacts) ? Number(opts.maxFacts) : 80;
  const issues = [];
  if (exactDupes.length > 0) issues.push("exact-duplicates");
  if (nearDupes.length > 0) issues.push("near-duplicates");
  if (inv.historyCount > 40) issues.push("large-history");
  if (inv.activeCount > maxFacts) issues.push("oversized-active");
  if (!inv.exists) issues.push("no-profile");
  return {
    exists: inv.exists,
    profilePath: inv.profilePath,
    activeCount: inv.activeCount,
    historyCount: inv.historyCount,
    sections: inv.sections.map((s) => ({
      title: s.title,
      role: s.role,
      isHistory: s.isHistory,
      count: s.facts.length,
    })),
    emptySections,
    exactDupes,
    nearDupes,
    issues,
    healthy: issues.length === 0,
  };
}

/**
 * Restore a fact from history back into an active section (reverse of retire).
 * Strips the `（YYYY-MM-DD 归档）` prefix; refuses when the target section
 * already holds an equivalent live fact.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot
 * @param {string} options.match - archived fact text (prefix optional)
 * @param {string} [options.section] - destination section (default: locale inProgress)
 * @param {string} [options.historySection]
 * @param {object} [options.contract]
 */
export function restoreProfileEntry({ workspaceRoot, match, section, historySection, contract, actor, confirmed, writebackModeOverride }) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  const target = String(match || "").trim();
  if (!target) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "restore requires match text",
      reason: "no-match-text",
    };
  }
  const locale = resolveAiLocale(contract);
  const body = readProfileBody(workspaceRoot);
  if (!body) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "profile.md not found",
      reason: "no-profile",
    };
  }
  const historyTitle = historySection || resolveProfileSectionTitle(body, "history", locale);
  const destSection = section || resolveProfileSectionTitle(body, "inProgress", locale);
  const blocks = parseProfileSections(body);
  const hist = blocks.find((b) => b.title === historyTitle);
  if (!hist) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "history section not found",
      reason: "no-history-section",
    };
  }
  const hits = findProfileFactLineIndexes(hist.body, target);
  if (hits.length === 0) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "no matching archived fact",
      reason: "no-matching-fact",
    };
  }
  const lines = body.split("\n");
  const removed = hits.map((i) => lines[hist.start + i]);
  for (let i = hits.length - 1; i >= 0; i--) {
    lines.splice(hist.start + hits[i], 1);
  }
  const lang = profileLocalePack(locale);
  const restoredFids = [];
  const restored = removed
    .map((l) => {
      const meta = parseFactMeta(l);
      const plain = meta.text
        .replace(/^[（(]\d{4}-\d{2}-\d{2}[^)）]*[)）]\s*/u, "")
        .trim();
      if (!plain) return null;
      return { plain, meta };
    })
    .filter(Boolean);
  if (restored.length === 0) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: globalProfileRelPath(workspaceRoot),
      target_path: profilePath,
      note: "archived fact stripped to empty",
      reason: "no-matching-fact",
    };
  }
  let newBody = lines.join("\n");
  // Refuse if dest already has an equivalent live fact.
  const destBlock = parseProfileSections(newBody).find((b) => b.title === destSection);
  if (destBlock) {
    for (const r of restored) {
      if (profileSectionHasFact(destBlock.body, r.plain)) {
        return {
          operation: "skip",
          wroteFiles: false,
          wrote_files: false,
          targetPath: globalProfileRelPath(workspaceRoot),
          target_path: profilePath,
          note: "fact already present in destination section",
          reason: "duplicate-fact",
        };
      }
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const restoredLines = restored.map((r) => {
    if (r.meta.fid) restoredFids.push(r.meta.fid);
    return withFactMetaComment(
      `- ${profileDateMarker(lang, "active", day)}${r.plain}`,
      { fid: r.meta.fid || mintFactId(r.plain), src: r.meta.src || null, reason: null, sup: null },
    );
  });
  const destRegex = new RegExp(`(## ${destSection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`, "u");
  if (destRegex.test(newBody)) {
    newBody = newBody.replace(destRegex, (m, head, inner) => {
      const trimmed = String(inner).replace(/\s+$/u, "");
      return `${head}\n${trimmed ? `${trimmed}\n\n` : ""}${restoredLines.join("\n")}\n`;
    });
  } else {
    newBody = `${newBody.replace(/\s*$/u, "")}\n\n## ${destSection}\n\n${restoredLines.join("\n")}\n`;
  }
  const evidence = executeWrite({
    targetPath: profilePath,
    content: newBody,
    workspaceRoot,
    contract,
    operation: "update",
    ...memoryWriteGate({ actor, confirmed }),
    skipShadow: true,
    role: "memory",
    writebackModeOverride,
  });
  if (evidence.wroteFiles !== false) {
    for (const fid of restoredFids.length ? restoredFids : [null]) {
      appendMemoryJournal(workspaceRoot, {
        op: "restore",
        fid,
        section: destSection,
        actor: actor || "ai",
      });
    }
  }
  return evidence;
}

/**
 * Rank profile sections for AI prompt injection.
 * Goals / preferences / people outrank in-progress ephemera; history is
 * never included. Caps facts per section so a large profile does not
 * crowd the activity window out of the budget.
 *
 * @param {string} workspaceRoot
 * @param {{ contract?: object, locale?: string, perSectionCap?: number, totalCap?: number }} [opts]
 * @returns {string} markdown block for prompts ("" when no profile)
 */
export function formatProfileForPrompt(workspaceRoot, opts = {}) {
  const inv = listProfileFacts(workspaceRoot, { contract: opts.contract });
  if (!inv.exists) return "";
  const locale = opts.locale || resolveAiLocale(opts.contract);
  const perSectionCap = Number.isFinite(opts.perSectionCap) ? Number(opts.perSectionCap) : 8;
  const totalCap = Number.isFinite(opts.totalCap) ? Number(opts.totalCap) : 28;
  const rolePriority = ["goals", "preferences", "people", "inProgress"];
  const roleLabel = {
    goals: locale === "en" ? "Current goals" : "当前目标",
    preferences: locale === "en" ? "Preferences" : "偏好",
    people: locale === "en" ? "Key people" : "关键的人与协作",
    inProgress: locale === "en" ? "In progress" : "进行中的事",
  };
  const active = inv.sections.filter((s) => !s.isHistory && s.facts.length > 0);
  active.sort((a, b) => {
    const ia = a.role ? rolePriority.indexOf(a.role) : 99;
    const ib = b.role ? rolePriority.indexOf(b.role) : 99;
    return ia - ib;
  });
  const lines = [];
  let used = 0;
  for (const sec of active) {
    if (used >= totalCap) break;
    const label = (sec.role && roleLabel[sec.role]) || sec.title;
    const take = Math.min(perSectionCap, totalCap - used, sec.facts.length);
    if (take <= 0) continue;
    lines.push(`### ${label}`);
    for (let i = 0; i < take; i++) {
      lines.push(`- ${sec.facts[i].text}`);
      used += 1;
    }
    if (sec.facts.length > take) {
      lines.push(
        locale === "en"
          ? `- …and ${sec.facts.length - take} more in this section`
          : `- …本段还有 ${sec.facts.length - take} 条`,
      );
    }
    lines.push("");
  }
  if (inv.historyCount > 0) {
    lines.push(
      locale === "en"
        ? `_${inv.historyCount} archived fact(s) omitted (history is not current truth)._`
        : `_另有 ${inv.historyCount} 条已归档事实（历史不是当前真相，未注入）。_`,
    );
  }
  return lines.join("\n").trim();
}

/**
 * Read-only staleness report: live facts whose date prefix is older than N
 * days (or undated). Never auto-writes — feeds a confirm-gated review card.
 *
 * @param {string} workspaceRoot
 * @param {{ olderThanDays?: number, contract?: object }} [opts]
 */
export function reviewStaleProfileEntries(workspaceRoot, opts = {}) {
  const days = Number.isFinite(opts.olderThanDays) ? Number(opts.olderThanDays) : 120;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const inv = listProfileFacts(workspaceRoot, { contract: opts.contract });
  /** @type {Array<{ section: string, role: string|null, text: string, date: string|null, fid: string|null, staleDays: number|null }>} */
  const stale = [];
  for (const sec of inv.sections) {
    if (sec.isHistory) continue;
    for (const f of sec.facts) {
      let staleDays = null;
      if (f.date) {
        const t = Date.parse(f.date);
        if (Number.isFinite(t) && t < cutoff) {
          staleDays = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
        }
      } else {
        staleDays = null; // undated — report as stale-without-age
      }
      if (staleDays !== null || !f.date) {
        stale.push({
          section: sec.title,
          role: sec.role,
          text: f.text,
          date: f.date,
          fid: f.fid,
          staleDays,
        });
      }
    }
  }
  return {
    exists: inv.exists,
    olderThanDays: days,
    count: stale.length,
    items: stale,
  };
}

/**
 * Find live facts that conflict / near-dupe a candidate (for confirm cards).
 * @param {string} workspaceRoot
 * @param {string} candidate
 * @param {{ threshold?: number, contract?: object, limit?: number }} [opts]
 * @returns {Array<{ text: string, fid: string|null, section: string, score: number }>}
 */
export function findConflictingProfileFacts(workspaceRoot, candidate, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) ? Number(opts.threshold) : 0.72;
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : 3;
  const inv = listProfileFacts(workspaceRoot, { contract: opts.contract });
  const key = normalizeProfileFactKey(candidate);
  if (!key) return [];
  const hits = [];
  for (const sec of inv.sections) {
    if (sec.isHistory) continue;
    for (const f of sec.facts) {
      if (normalizeProfileFactKey(f.text) === key) {
        hits.push({ text: f.text, fid: f.fid, section: sec.title, score: 1 });
        continue;
      }
      const score = factSimilarity(f.text, candidate);
      if (score >= threshold) {
        hits.push({ text: f.text, fid: f.fid, section: sec.title, score });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
export function searchProfile(workspaceRoot, query, opts = {}) {
  const q = normalizeProfileFactKey(query);
  if (!q || q.length < 1) return { query: String(query || ""), hits: [] };
  const includeHistory = opts.includeHistory !== false;
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : 20;
  const inv = listProfileFacts(workspaceRoot, { contract: opts.contract });
  const hits = [];
  for (const sec of inv.sections) {
    if (sec.isHistory && !includeHistory) continue;
    for (const f of sec.facts) {
      const key = normalizeProfileFactKey(f.text);
      const score = factSimilarity(f.text, query);
      if (key.includes(q) || q.includes(key) || score >= 0.5) {
        hits.push({
          section: sec.title,
          role: sec.role,
          isHistory: sec.isHistory,
          text: f.text,
          date: f.date,
          fid: f.fid,
          src: f.src,
          reason: f.reason,
          score: Math.round(score * 100) / 100,
        });
      }
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  hits.sort((a, b) => b.score - a.score);
  return { query: String(query || ""), hits };
}
