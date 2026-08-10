/**
 * Desktop Skills Runtime — progressive disclosure for bundled topmind pack.
 *
 * Layout (engine root, same as pack:prepare):
 *   {engine}/skills/topmind-pack.json
 *   {engine}/skills/{id}/SKILL.md
 *   {engine}/skills/shared/*.md
 *
 * Levels (Agent Skills open standard):
 *   1 Discovery — name + description only (catalog)
 *   2 Activation — full SKILL.md body
 *   3 Resources — shared/ + references/ on demand
 *
 * No monorepo ../../skills static import (packaged asar-safe via engine root).
 */
import { promises as fs, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { getEngineRoot } from "./workspace-home.mjs";
import { defaultEngineCandidate } from "./engine-root.mjs";
import { getSkillsExtraRoot } from "./skills-extra.mjs";

const CORE_ACTION_IDS = [
  "topmind",
  "topmind-capture",
  "topmind-organize",
  "topmind-write",
  "topmind-memory",
  "topmind-maintain",
  "topmind-loop",
];
const CONNECTOR_IDS = ["topmind-weread", "topmind-x"];

/** @type {{ root: string|null, pack: object|null, catalog: object[]|null, bodies: Map<string,string> }} */
const cache = {
  root: null,
  pack: null,
  catalog: null,
  bodies: new Map(),
};

export function resolveSkillsRoot(engineRoot) {
  const root = path.resolve(engineRoot || getEngineRoot() || defaultEngineCandidate());
  const candidates = [
    path.join(root, "skills"),
    // portable engine may nest under topmind-engine already as root
    path.join(root, "resources", "topmind-engine", "skills"),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "topmind-pack.json")) || existsSync(path.join(c, "topmind", "SKILL.md"))) {
      return c;
    }
  }
  return path.join(root, "skills");
}

/**
 * Extra roots from settings (synced by system-service / AI path).
 * Env topmind_SKILLS_EXTRA is always merged in resolveExtraSkillsRoots.
 * @type {string[]}
 */
let configuredExtraRoots = [];

/**
 * Sync settings.ai.extraSkillsRoots into runtime (invalidates catalog cache).
 * @param {unknown} roots
 */
export function setConfiguredExtraSkillsRoots(roots) {
  const next = [];
  if (Array.isArray(roots)) {
    for (const r of roots) {
      if (typeof r !== "string" || !r.trim()) continue;
      const abs = path.resolve(r.trim());
      if (!next.includes(abs) && existsSync(abs)) next.push(abs);
    }
  }
  const same =
    next.length === configuredExtraRoots.length &&
    next.every((p, i) => p === configuredExtraRoots[i]);
  if (same) return configuredExtraRoots.slice();
  configuredExtraRoots = next;
  invalidateSkillsCache();
  return configuredExtraRoots.slice();
}

/**
 * Optional extra skills roots (user extensions).
 * Order: opts.extraRoots → settings (configured) → env topmind_SKILLS_EXTRA
 * Env: topmind_SKILLS_EXTRA=/path/a:/path/b (or ; on Windows)
 * @param {{ extraRoots?: string[] }} [opts]
 * @returns {string[]}
 */
export function resolveExtraSkillsRoots(opts = {}) {
  const sep = process.platform === "win32" ? ";" : ":";
  /** @type {string[]} */
  const out = [];
  const push = (p) => {
    if (!p || typeof p !== "string") return;
    const abs = path.resolve(p.trim());
    if (!out.includes(abs) && existsSync(abs)) out.push(abs);
  };
  if (Array.isArray(opts.extraRoots)) {
    for (const r of opts.extraRoots) push(r);
  }
  for (const r of configuredExtraRoots) push(r);
  const env = process.env.topmind_SKILLS_EXTRA?.trim();
  if (env) {
    for (const part of env.split(sep)) push(part);
  }
  return out;
}

function listSkillDirsFromRoot(skillsRoot) {
  if (!existsSync(skillsRoot)) return [];
  try {
    return readdirSync(skillsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "shared" && e.name !== "tests" && e.name !== "evals" && e.name !== "install-targets")
      .map((e) => e.name)
      .filter((id) => existsSync(path.join(skillsRoot, id, "SKILL.md")))
      .sort();
  } catch {
    return [];
  }
}

function resetCacheIfRootChanged(skillsRoot) {
  if (cache.root !== skillsRoot) {
    cache.root = skillsRoot;
    cache.pack = null;
    cache.catalog = null;
    cache.bodies = new Map();
  }
}

/**
 * Parse YAML-ish frontmatter (enough for SKILL.md: name, description fold, flags).
 * @param {string} raw
 */
export function parseSkillMarkdown(raw) {
  const text = String(raw || "").replace(/\r\n/gu, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u);
  if (!m) {
    return { frontmatter: {}, body: text, description: "", name: "" };
  }
  const fmRaw = m[1];
  const body = m[2] || "";
  const frontmatter = {};
  const lines = fmRaw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/u);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    let val = kv[2];
    if (val === ">-" || val === "|" || val === ">") {
      const parts = [];
      i += 1;
      while (i < lines.length && (/^[ \t]/.test(lines[i]) || lines[i] === "")) {
        if (lines[i].trim()) parts.push(lines[i].trim());
        i += 1;
      }
      frontmatter[key] = parts.join(" ");
      continue;
    }
    if (val === "" || val === null) {
      // list or empty
      const list = [];
      i += 1;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        list.push(lines[i].replace(/^\s+-\s+/, "").trim());
        i += 1;
      }
      if (list.length) frontmatter[key] = list;
      else frontmatter[key] = val;
      continue;
    }
    // strip quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val === "true") frontmatter[key] = true;
    else if (val === "false") frontmatter[key] = false;
    else frontmatter[key] = val;
    i += 1;
  }
  return {
    frontmatter,
    body,
    description: String(frontmatter.description || "").trim(),
    name: String(frontmatter.name || "").trim(),
  };
}

function loadPackSync(skillsRoot) {
  const packPath = path.join(skillsRoot, "topmind-pack.json");
  if (!existsSync(packPath)) return null;
  try {
    return JSON.parse(readFileSync(packPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build discovery catalog (level 1). Merges bundled engine skills + optional extras.
 * @param {{ engineRoot?: string, enabledIds?: string[]|null }} [opts]
 */
export function listSkillCatalog(opts = {}) {
  const skillsRoot = resolveSkillsRoot(opts.engineRoot);
  const extras = resolveExtraSkillsRoots({ extraRoots: opts.extraRoots });
  const extraKey = extras.join("|");
  const cacheKey = `${skillsRoot}::${extraKey}`;
  resetCacheIfRootChanged(cacheKey);
  if (cache.catalog && cache.root === cacheKey) {
    return filterEnabled(cache.catalog, opts.enabledIds);
  }

  const pack = loadPackSync(skillsRoot);
  cache.pack = pack;
  /** @type {Map<string, object>} */
  const byId = new Map();

  const ingest = (rootDir, source) => {
    for (const id of listSkillDirsFromRoot(rootDir)) {
      const skillPath = path.join(rootDir, id, "SKILL.md");
      try {
        const raw = readFileSync(skillPath, "utf8");
        const parsed = parseSkillMarkdown(raw);
        const name = parsed.name || id;
        byId.set(name || id, {
          id: name || id,
          directory: id,
          name: name || id,
          description: parsed.description || "",
          actionCategory: parsed.frontmatter.action_category || "action",
          entrypoint: parsed.frontmatter.entrypoint === true,
          triggers: Array.isArray(parsed.frontmatter.triggers) ? parsed.frontmatter.triggers : [],
          path: skillPath,
          source,
          skillsRoot: rootDir,
        });
      } catch {
        /* skip */
      }
    }
  };

  ingest(skillsRoot, "bundled");
  for (const extra of extras) {
    ingest(extra, "external");
  }

  const catalog = Array.from(byId.values());

  // Prefer pack order when available
  if (pack?.entry_files && Array.isArray(pack.entry_files)) {
    const order = pack.entry_files.map((f) => String(f).split("/")[0]);
    catalog.sort((a, b) => {
      const ia = order.indexOf(a.directory);
      const ib = order.indexOf(b.directory);
      if (ia === -1 && ib === -1) return a.id.localeCompare(b.id);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }

  cache.catalog = catalog;
  return filterEnabled(catalog, opts.enabledIds);
}

function filterEnabled(catalog, enabledIds) {
  if (!enabledIds || !Array.isArray(enabledIds) || enabledIds.length === 0) {
    return catalog.slice();
  }
  const set = new Set(enabledIds);
  return catalog.filter((s) => set.has(s.id) || set.has(s.directory));
}

/**
 * Load full skill body (level 2 activation).
 * @param {string} skillId
 * @param {{ engineRoot?: string, maxChars?: number }} [opts]
 */
export function loadSkillBody(skillId, opts = {}) {
  const skillsRoot = resolveSkillsRoot(opts.engineRoot);
  const id = String(skillId || "").trim().replace(/^\/+/, "");
  if (!id) throw new Error("skillId required");

  const cacheKey = id;
  if (cache.bodies.has(cacheKey)) {
    const cached = cache.bodies.get(cacheKey);
    return clipBody(
      typeof cached === "string"
        ? { id, raw: cached, body: cached, description: "", frontmatter: {} }
        : cached,
      opts.maxChars,
    );
  }

  const catalog = listSkillCatalog({ engineRoot: opts.engineRoot, enabledIds: null });
  const hit = catalog.find((s) => s.id === id || s.directory === id || s.name === id);
  const candidates = [];
  if (hit?.path && existsSync(hit.path)) candidates.push(hit.path);
  if (hit?.skillsRoot) candidates.push(path.join(hit.skillsRoot, hit.directory, "SKILL.md"));
  candidates.push(path.join(skillsRoot, id, "SKILL.md"));
  if (hit) candidates.push(path.join(skillsRoot, hit.directory, "SKILL.md"));

  let raw = null;
  let usedPath = null;
  for (const p of candidates) {
    if (p && existsSync(p)) {
      raw = readFileSync(p, "utf8");
      usedPath = p;
      break;
    }
  }
  if (!raw) throw new Error(`Skill not found: ${id}`);

  const parsed = parseSkillMarkdown(raw);
  const result = {
    id: parsed.name || id,
    path: usedPath,
    description: parsed.description,
    actionCategory: parsed.frontmatter.action_category,
    entrypoint: parsed.frontmatter.entrypoint === true,
    body: parsed.body,
    raw,
    frontmatter: parsed.frontmatter,
  };
  cache.bodies.set(cacheKey, result);
  return clipBody(result, opts.maxChars);
}

function clipBody(result, maxChars) {
  const max = Math.min(Math.max(Number(maxChars) || 14000, 2000), 40000);
  if (typeof result === "string") {
    if (result.length <= max) return { raw: result, body: result, truncated: false };
    return { raw: result.slice(0, max), body: result.slice(0, max), truncated: true };
  }
  const out = { ...result };
  if (out.raw && out.raw.length > max) {
    out.raw = `${out.raw.slice(0, max)}\n\n…(truncated ${out.raw.length - max} chars; use load_skill_resource for shared refs)`;
    out.body = out.raw;
    out.truncated = true;
  } else {
    out.truncated = false;
  }
  return out;
}

/**
 * Load shared or skill reference resource (level 3).
 * @param {string} rel — e.g. shared/project-model-brief.md or topmind/references/foo.md
 */
export function loadSkillResource(rel, opts = {}) {
  const skillsRoot = resolveSkillsRoot(opts.engineRoot);
  const cleaned = String(rel || "")
    .replace(/\\/gu, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./gu, "");
  if (!cleaned || cleaned.includes("..")) throw new Error("Invalid resource path");
  const roots = [skillsRoot, ...resolveExtraSkillsRoots({ extraRoots: opts.extraRoots })];
  let abs = null;
  for (const root of roots) {
    const candidate = path.join(root, cleaned);
    if (candidate.startsWith(root) && existsSync(candidate)) {
      abs = candidate;
      break;
    }
  }
  if (!abs) throw new Error(`Resource not found: ${cleaned}`);
  const raw = readFileSync(abs, "utf8");
  const max = Math.min(Math.max(Number(opts.maxChars) || 12000, 1000), 40000);
  return {
    path: cleaned,
    content: raw.length > max ? `${raw.slice(0, max)}\n\n…(truncated)` : raw,
    truncated: raw.length > max,
  };
}

/**
 * Pack status for Settings / About.
 */
export function getSkillsStatus(opts = {}) {
  const skillsRoot = resolveSkillsRoot(opts.engineRoot);
  const pack = loadPackSync(skillsRoot);
  const catalog = listSkillCatalog({
    engineRoot: opts.engineRoot,
    enabledIds: null,
    extraRoots: opts.extraRoots,
  });
  const hasShared = existsSync(path.join(skillsRoot, "shared", "project-model-brief.md"))
    || existsSync(path.join(skillsRoot, "shared", "capability-degradation.md"));
  const extraRoots = resolveExtraSkillsRoots({ extraRoots: opts.extraRoots });
  return {
    skillsRoot,
    extraRoots,
    managedExtraRoot: getSkillsExtraRoot(),
    packVersion: pack?.version || null,
    packName: pack?.name || "topmind",
    dailyEntry: pack?.daily_entry || "topmind",
    skillCount: catalog.length,
    hasShared,
    catalog: catalog.map((s) => ({
      id: s.id,
      description: s.description.slice(0, 200),
      actionCategory: s.actionCategory,
      entrypoint: s.entrypoint,
      source: s.source || "bundled",
    })),
    coreIds: CORE_ACTION_IDS,
    connectorIds: CONNECTOR_IDS,
  };
}

const ACTION_LABEL = {
  router: "路由",
  capture: "收进来",
  organize: "整理",
  write: "写作",
  memory: "记忆",
  maintain: "体检",
  loop: "巡检",
  connector: "连接器",
};

/**
 * Compact catalog for discovery — short Chinese label + trigger-focused slice.
 * Full SKILL.md still via load_skill (activation).
 */
export function formatCatalogForPrompt(catalog) {
  if (!catalog?.length) {
    return "（未发现 skills — 仅用工作区工具）";
  }
  return catalog
    .map((s) => {
      const label = ACTION_LABEL[s.actionCategory] || s.actionCategory || "";
      const entry = s.entrypoint ? " · 入口" : "";
      // Prefer the "Use when" half of Agent Skills descriptions for routing
      const raw = String(s.description || "").replace(/\s+/gu, " ").trim();
      const when = raw.match(/Use when[^.]*\./iu)?.[0]
        || raw.match(/当用户[^。]*。/u)?.[0]
        || raw;
      const desc = when.slice(0, 160);
      return `- \`${s.id}\`${label ? ` [${label}]` : ""}${entry} — ${desc}`;
    })
    .join("\n");
}

/**
 * Map slash command → skill id
 */
export const SLASH_TO_SKILL = Object.freeze({
  "/capture": "topmind-capture",
  "/organize": "topmind-organize",
  "/write": "topmind-write",
  "/memory": "topmind-memory",
  "/maintain": "topmind-maintain",
  "/loop": "topmind-loop",
  "/weread": "topmind-weread",
  "/x": "topmind-x",
  "/topmind": "topmind",
  "/router": "topmind",
});

export function invalidateSkillsCache() {
  cache.root = null;
  cache.pack = null;
  cache.catalog = null;
  cache.bodies = new Map();
}

export async function listSkillCatalogAsync(opts = {}) {
  return listSkillCatalog(opts);
}
