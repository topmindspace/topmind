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
  profileSectionHasFact,
  validateAiOutput,
} from "./ai-content-sanitize.mjs";

export const MEMORY_DIR_NAME = "memory";

/**
 * Resolve memory directory path in workspace (semantic plane).
 * @param {string} workspaceRoot
 * @returns {string} absolute path to workspace/memory/
 */
export function resolveMemoryDir(workspaceRoot) {
  return path.join(workspaceRoot, MEMORY_DIR_NAME);
}

/**
 * Resolve memory layer paths.
 * @param {string} workspaceRoot
 * @param {string} layer - "global" | "periodic" | "topics"
 * @param {string} [identifier] - period stem (e.g., "2026-W30") or topic slug
 * @returns {string} absolute path to memory layer (dir for periodic/topics; file for global)
 */
export function resolveMemoryLayerPath(workspaceRoot, layer, identifier) {
  const memDir = resolveMemoryDir(workspaceRoot);
  switch (layer) {
    case "global":
      return path.join(memDir, "profile.md");
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
    return path.join(memDir, "periodic", year, `${period}.md`);
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
  let { section, content } = normalizeMemoryEntry(entry, "进行中的事");

  // Sanitize AI-sourced lines; never append placeholders / thinking dumps.
  // Entry may be short (a single fact) — central gate with minimal length floor.
  const checked = validateAiOutput(content, "memory", { minLength: 1 });
  if (!checked.ok) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: "memory/profile.md",
      target_path: profilePath,
      note: "skipped empty or polluted profile entry",
      reason: checked.reason || "placeholder-or-polluted",
    };
  }
  content = checked.text;

  // Read existing profile
  let body = "";
  if (fs.existsSync(profilePath)) {
    body = fs.readFileSync(profilePath, "utf8");
  } else {
    // Create default profile structure
    body = `---
title: 我的情况
source_type: user-original
memory_layer: global
---

# 我的情况

## 偏好

## 当前目标

## 关键的人与协作

## 进行中的事
`;
  }

  // Append to section (with in-section dedupe — no blind re-append of same fact)
  const sectionRegex = new RegExp(`(## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n)([\\s\\S]*?)(?=\\n## |$)`, "u");
  const match = body.match(sectionRegex);

  if (match) {
    const sectionContent = match[2].trim();
    if (profileSectionHasFact(sectionContent, content)) {
      return {
        operation: "skip",
        wroteFiles: false,
        wrote_files: false,
        targetPath: "memory/profile.md",
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
  let { content } = normalizeMemoryEntry(entry, "notes");

  // Sanitize AI-sourced lines; never append placeholders / thinking dumps.
  const checked = validateAiOutput(content, "memory", { minLength: 1 });
  if (!checked.ok) {
    return {
      operation: "skip",
      wroteFiles: false,
      wrote_files: false,
      targetPath: `memory/topics/${slug}.md`,
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

  const digestPath = resolvePeriodMemoryPath(workspaceRoot, period);
  const periodKey = String(period || "period").trim() || "period";

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
      targetPath: `memory/periodic/${periodKey}.md`,
      target_path: digestPath,
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
