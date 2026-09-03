// ── topmind Memory Engine (Kernel 4/8) ────────────────────────────────────
// Authoritative engine for memory plane (memory/ directory), 3-layer memory
// (global / periodic / topics), stream-to-memory promotion, and conflict detection.
//
// Design principle: memory-engine only handles deterministic physical operations
// on the memory plane. Intelligent decisions (suggest candidates, detect conflicts,
// generate digest content) belong to Surface layer (Desktop/UTR/Skills).

import fs from "node:fs";
import path from "node:path";
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
    title: "My situation",
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
  const memDir = resolveMemoryDir(workspaceRoot);
  const year = extractPeriodYear(period);
  if (year) {
    const yearPath = path.join(memDir, "periodic", year, `${period}.md`);
    // Period-path stickiness: a pre-year-grouping workspace may already hold
    // this reflection as a flat file — digest writes must keep landing there
    // instead of forking a year-dir twin (same rationale as stream notes).
    if (!fs.existsSync(yearPath)) {
      const flatPath = path.join(memDir, "periodic", `${period}.md`);
      if (fs.existsSync(flatPath)) return flatPath;
    }
    return yearPath;
  }
  return path.join(memDir, "periodic", `${period}.md`);
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
    const section = String(entry.section || defaultSection).trim() || defaultSection;
    return { section, content };
  }
  throw new Error("appendProfileEntry entry must be string or { section, content }");
}

export function appendProfileEntry({ workspaceRoot, entry, contract }) {
  const profilePath = resolveMemoryLayerPath(workspaceRoot, "global");
  ensureMemoryPlane(workspaceRoot);
  const locale = resolveAiLocale(contract);

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

  // Append to section (with in-section dedupe — no blind re-append of same fact).
  // `[ \t]*` tolerates trailing whitespace after the heading so a stray space
  // does not fork a duplicate section at file end.
  const sectionRegex = new RegExp(`(## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*\\n)([\\s\\S]*?)(?=\\n## |$)`, "u");
  const match = body.match(sectionRegex);

  if (match) {
    const sectionContent = match[2].trim();
    if (profileSectionHasFact(sectionContent, content)) {
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
    const newSectionContent = sectionContent
      ? `${sectionContent}\n\n${content}`
      : content;
    body = body.replace(sectionRegex, `$1\n${newSectionContent}\n`);
  } else {
    body += `\n## ${section}\n\n${content}\n`;
  }

  return executeWrite({
    targetPath: profilePath,
    content: body,
    workspaceRoot,
    contract,
    operation: "update",
    actor: "user",
    confirmed: true,
    skipShadow: true,
    role: "memory",
  });
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
 * or ≥6-char substring containment — same semantics as profileSectionHasFact).
 * Section heading lines never match: retiring `## 关键的人与协作` by its own
 * heading text must not splice the structure apart.
 * @param {string} sectionBody
 * @param {string} match
 * @returns {number[]}
 */
function findProfileFactLineIndexes(sectionBody, match) {
  const key = normalizeProfileFactKey(match);
  if (!key || key.length < 2) return [];
  const lines = String(sectionBody || "").split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6}\s/u.test(lines[i])) continue;
    const existing = normalizeProfileFactKey(lines[i]);
    if (!existing) continue;
    if (existing === key) { hits.push(i); continue; }
    if (existing.length >= 2 && key.length >= 2 && (existing.includes(key) || key.includes(existing))) {
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
 * Read the profile for AI prompt context with the history section collapsed
 * to a one-line summary. Retired facts must not re-enter prompts formatted
 * identically to current facts — and must not crowd active sections out of
 * the char budget as the archive grows.
 * @param {string} workspaceRoot
 * @param {{ historySection?: string }} [options]
 * @returns {string}
 */
export function readProfileActiveBody(workspaceRoot, { historySection, locale = "zh" } = {}) {
  const body = readProfileBody(workspaceRoot);
  if (!body) return "";
  const historyTitle = historySection || resolveProfileSectionTitle(body, "history", locale);
  const blocks = parseProfileSections(body);
  const hist = blocks.find((b) => b.title === historyTitle);
  if (!hist) return body;
  // hist.start is a line index — rebuild the prefix by lines, not char offset.
  const lines = body.split("\n");
  const retiredCount = hist.body.split("\n").filter((l) => /^\s*[-*+]\s+\S/u.test(l)).length;
  const profileRel = globalProfileRelPath(workspaceRoot);
  const summaryLine = historyTitle === "History" || locale === "en"
    ? `- ${retiredCount} archived fact(s) (see ${profileRel})`
    : `- ${retiredCount} 条已归档条目（略，见 ${profileRel}）`;
  const summary = `## ${historyTitle}\n\n${summaryLine}\n`;
  return `${lines.slice(0, hist.start).join("\n")}\n${summary}`;
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
export function retireProfileEntry({ workspaceRoot, match, section, historySection, contract }) {
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
  const retireDate = new Date().toISOString().slice(0, 10);
  const retiredLines = removed
    .map((l) => `- （${retireDate} 归档）${l.replace(/^[-*+]\s+/u, "").replace(/^（\d{4}-\d{2}-\d{2}）\s*/u, "").trim()}`)
    .filter((l) => l.trim().length > `- （${retireDate} 归档）`.length);
  const histRegex = new RegExp(`^(## ${historyTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*)$`, "mu");
  if (histRegex.test(newBody)) {
    newBody = newBody.replace(histRegex, `$1\n${retiredLines.join("\n")}`);
  } else {
    newBody = `${newBody.replace(/\s*$/u, "")}\n\n## ${historyTitle}\n\n${retiredLines.join("\n")}\n`;
  }

  return executeWrite({
    targetPath: profilePath,
    content: newBody,
    workspaceRoot,
    contract,
    operation: "update",
    actor: "user",
    confirmed: true,
    skipShadow: true,
    role: "memory",
  });
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
export function updateProfileEntry({ workspaceRoot, match, content, section, historySection, contract }) {
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
  lines[globalIdx] = `- （${day}）${checked.text}`;
  return executeWrite({
    targetPath: profilePath,
    content: lines.join("\n"),
    workspaceRoot,
    contract,
    operation: "update",
    actor: "user",
    confirmed: true,
    skipShadow: true,
    role: "memory",
  });
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
export function appendTopicEntry({ workspaceRoot, slug, entry, contract }) {
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
    actor: "user",
    confirmed: true,
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
export function writePeriodDigest({ workspaceRoot, period, body, contract, derivedFrom = [] }) {
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
    actor: "user",
    confirmed: true,
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
export function promoteStreamItem({ workspaceRoot, item, target, contract }) {
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
    });
    evidence.target_path = result.target_path;
  } else if (target.layer === "topics") {
    if (!target.slug) throw new Error("slug required for topics layer");
    const result = appendTopicEntry({
      workspaceRoot,
      slug: target.slug,
      entry: { content: item.content },
      contract,
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
      actor: "user",
      confirmed: true,
      skipShadow: true,
    });
  }

  evidence.wrote_files = true;
  evidence.target_path = evidence.target_path || evidence.targetPath;
  return evidence;
}
