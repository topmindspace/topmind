import { promises as fs, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import yaml from "js-yaml";
import { exists } from "./fs-utils.mjs";
import { defaultEngineCandidate } from "./engine-root.mjs";

/** Mutable engine root — set by main after resolvetopmindRoot (dev monorepo or packaged). */
let ENGINE_ROOT = defaultEngineCandidate();

export function setEngineRoot(root) {
  if (root) ENGINE_ROOT = path.resolve(root);
  return ENGINE_ROOT;
}

export function getEngineRoot() {
  return ENGINE_ROOT;
}

/** Load template JSON from engine templates/. Returns null when missing (caller uses defaults). */
export function loadTemplateJson(templateId, engineRoot = ENGINE_ROOT) {
  const root = engineRoot || ENGINE_ROOT;
  const templatePath = path.join(root, "templates", `${templateId}.json`);
  try {
    const raw = readFileSync(templatePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    if (templateId === "stream" || templateId === "balanced") return null;
    return loadTemplateJson("stream", root);
  }
}

const STATE_DIR = "state";
const WORKSPACES_DIR = "workspaces";

function sanitizeName(workspaceRoot) {
  const baseName = path.basename(path.resolve(workspaceRoot));
  return baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
}

function workspaceStateSlug(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  const safeName = sanitizeName(resolved);
  const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return `${safeName}-${hash}`;
}

/**
 * Desktop runtime state home (settings / logs / per-workspace AI state).
 * Default: ~/topmind/topmind-desktop
 * Override: topmind_DESKTOP_HOME (or legacy topmind_WORKSPACE_HOME)
 * Not the monorepo root — never put user notes here.
 */
export function resolveDesktopStateHome(options = {}) {
  const env = options.env ?? process.env;
  for (const key of ["topmind_DESKTOP_HOME", "topmind_WORKSPACE_HOME"]) {
    const envPath = env?.[key]?.trim();
    if (envPath) return path.resolve(envPath);
  }
  const homeDir = options.homeDir || os.homedir();
  return path.join(homeDir, "topmind", "topmind-desktop");
}

/**
 * Default *path* for a brand-new install's content workspace (not auto-created until open).
 * Default: ~/topmind/topmind-workspace
 * Override: topmind_USER_WORKSPACE
 * Distinct from the engine monorepo checkout and from Desktop runtime state.
 */
export function resolveUserWorkspaceRoot(options = {}) {
  const env = options.env ?? process.env;
  const envPath = env?.topmind_USER_WORKSPACE?.trim();
  if (envPath) return path.resolve(envPath);
  const homeDir = options.homeDir || os.homedir();
  return path.join(homeDir, "topmind", "topmind-workspace");
}

export function resolveWorkspaceStatePaths(desktopStateHome, userWorkspaceRoot) {
  const resolvedDesktopStateHome = path.resolve(desktopStateHome);
  const resolvedUserWorkspace = path.resolve(userWorkspaceRoot);
  const stateRootDirPath = path.join(resolvedDesktopStateHome, STATE_DIR);
  const slug = workspaceStateSlug(resolvedUserWorkspace);
  const workspaceStateDirPath = path.join(stateRootDirPath, WORKSPACES_DIR, slug);

  return {
    desktopStateHome: resolvedDesktopStateHome,
    userWorkspaceRoot: resolvedUserWorkspace,
    stateRootDirPath,
    settingsFilePath: path.join(stateRootDirPath, "app-settings.json"),
    workspaceStateDirPath,
    aiWorkspaceStateFilePath: path.join(workspaceStateDirPath, "ai-workspace.json"),
    aiSessionMessagesDirPath: path.join(workspaceStateDirPath, "session-messages"),
  };
}

export async function loadWorkspaceConfig(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  // v4: topmind.yaml is the primary source
  const yamlPath = path.join(root, "topmind.yaml");
  if (await exists(yamlPath)) {
    try {
      const raw = await fs.readFile(yamlPath, "utf8");
      return yaml.load(raw) || {};
    } catch {
      // Fall through to legacy
    }
  }
  // Legacy fallback: .topmind-config.json (v3)
  const configPath = path.join(root, ".topmind-config.json");
  try {
    const data = await fs.readFile(configPath, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/** Synchronous workspace config loader — for use in sync path-model functions. */
export function loadWorkspaceConfigSync(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  // v4: topmind.yaml is the primary source
  const yamlPath = path.join(root, "topmind.yaml");
  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, "utf8");
      return yaml.load(raw) || {};
    } catch {
      // Fall through to legacy
    }
  }
  // Legacy fallback: .topmind-config.json (v3)
  const configPath = path.join(root, ".topmind-config.json");
  try {
    const data = readFileSync(configPath, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function autoRepairWorkspace(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  const config = await loadWorkspaceConfig(resolved);
  
  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((e) => e.isDirectory() && /^\d{2}[ -].+/.test(e.name))
    .map((e) => e.name);

  let targetSeparator = config.categorySeparator;
  let shouldWriteConfig = false;

  if (!targetSeparator) {
    const hasHyphen = discovered.some((name) => name.charAt(2) === "-");
    const hasSpace = discovered.some((name) => name.charAt(2) === " ");
    if (hasHyphen || !hasSpace) {
      targetSeparator = "-";
    } else {
      targetSeparator = " ";
    }
    config.categorySeparator = targetSeparator;
    shouldWriteConfig = true;
  }

  let renamedAny = false;
  for (const name of discovered) {
    const currentSep = name.charAt(2);
    if (currentSep !== targetSeparator) {
      const num = name.slice(0, 2);
      const rest = name.slice(3);
      const nextName = `${num}${targetSeparator}${rest}`;
      const src = path.join(resolved, name);
      const dest = path.join(resolved, nextName);
      if (src !== dest && !(await exists(dest))) {
        await fs.rename(src, dest).catch(() => {});
        renamedAny = true;
      }
    }
  }

  if (targetSeparator === "-") {
    const oldDirs = [
      ["00 Inbox", "00-Inbox"], ["88 Outputs", "88-Outputs"], ["99 Archive", "99-Archive"],
      ["00 收件箱", "00-收件箱"], ["88 输出", "88-输出"], ["99 归档", "99-归档"],
    ];
    for (const [oldName, newName] of oldDirs) {
      const src = path.join(resolved, oldName);
      const dest = path.join(resolved, newName);
      if ((await exists(src)) && !(await exists(dest))) {
        await fs.rename(src, dest).catch(() => {});
        renamedAny = true;
      }
    }
  } else {
    const oldDirs = [
      ["00-Inbox", "00 Inbox"], ["88-Outputs", "88 Outputs"], ["99-Archive", "99 Archive"],
      ["00-收件箱", "00 收件箱"], ["88-输出", "88 输出"], ["99-归档", "99 归档"],
    ];
    for (const [oldName, newName] of oldDirs) {
      const src = path.join(resolved, oldName);
      const dest = path.join(resolved, newName);
      if ((await exists(src)) && !(await exists(dest))) {
        await fs.rename(src, dest).catch(() => {});
        renamedAny = true;
      }
    }
  }

  if (shouldWriteConfig || renamedAny) {
    const yamlPath = path.join(resolved, "topmind.yaml");
    const yamlContent = yaml.dump(config, { lineWidth: -1, noRefs: true });
    await fs.writeFile(yamlPath, yamlContent, "utf8").catch(() => {});
  }
}

/**
 * Ensure workspace has required role dirs (buffer/delivery/system) and v4 contract.
 * Does NOT recreate optional template categories the user deleted.
 * On first init (empty workspace), seeds full template categories once.
 */
export async function ensureWorkspaceStructure(workspaceRoot, templateId = "stream") {
  const resolved = path.resolve(workspaceRoot);
  await autoRepairWorkspace(resolved).catch(() => {});

  const config = await loadWorkspaceConfig(resolved);
  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((e) => e.isDirectory() && /^\d{2}[ -].+/.test(e.name))
    .map((e) => e.name);

  const effectiveTemplateId = config.template || config.workspace?.template || templateId;
  const isFirstInit = discovered.length === 0;

  if (isFirstInit) {
    // Brand-new workspace: seed full template once so users get a useful default layout
    let targetSeparator = config.categorySeparator || config.workspace?.category_separator;
    if (!targetSeparator) targetSeparator = "-";
    const template = loadTemplateJson(effectiveTemplateId);
    let dirs;
    if (template && template.categories) {
      const sep = targetSeparator;
      dirs = Object.entries(template.categories).map(
        ([slot, def]) => `${slot}${sep}${def.name}`,
      );
    } else {
      const suffix = targetSeparator;
      dirs = [
        `00${suffix}收件箱`, `10${suffix}动态`, `20${suffix}专题`,
        `88${suffix}输出`, `99${suffix}归档`,
      ];
    }
    await Promise.all(dirs.map((dir) => fs.mkdir(path.join(resolved, dir), { recursive: true })));
    // Seed v4 contract on brand-new workspace
    const yamlPath = path.join(resolved, "topmind.yaml");
    if (!(await exists(yamlPath))) {
      const tmpl = template || loadTemplateJson(effectiveTemplateId);
      const seed = {
        contract_version: 4,
        workspace: {
          name: "我的 topmind",
          locale: "zh-CN",
          template: effectiveTemplateId,
          category_separator: targetSeparator,
        },
        categories: { extensions: {}, overrides: {} },
        stream: config.stream || tmpl?.stream || { packing: "weekly", append_heading: "day" },
        memory: { dir: "memory", layers: { global: { file: "profile.md", update: "on-suggest" }, periodic: { dir: "periodic", cadence: "weekly", style: "brief" }, topics: { dir: "topics", auto_create: false } } },
        protection: { defaults: { by_role: { buffer: "open", "loose-stream": "open", "deep-work": "open", memory: "open", delivery: "open", system: "locked" } } },
        lifecycle: { inbox: { review_after_days: 7 }, catch_all: { retention_days: 30 }, stream: { digest_after_periods: 4 }, topic: { stale_after_days: 90, suggest_archive: true }, output: { lock_after_days: 30 } },
        writeback: { mode: "auto", shadow: true, backup_to: "99-归档/backups", receipts: "99-归档/receipts" },
        ingest: { default_target: "stream", url: { renderer: "auto" } },
        agent: { skills_entry: "topmind", confirm_by_default: false },
        presentation: { views: { default: "stream", enabled: ["stream", "category", "timeline", "tags", "kanban"] } },
      };
      await fs.writeFile(yamlPath, yaml.dump(seed, { lineWidth: -1, noRefs: true }), "utf8").catch(() => {});
    }
  }

  // Unified model: only ensure required roles (won't revive deleted optional categories)
  try {
    const { ensureRequiredStructure } = await import("./workspace-model-api.mjs");
    await ensureRequiredStructure(resolved, {
      engineRoot: ENGINE_ROOT,
      templateId: effectiveTemplateId,
    });
  } catch {
    // Fallback if engine lib missing: ensure 00/88/99 only
    const sep = config.categorySeparator || config.workspace?.category_separator || "-";
    const sepChar = sep === " " ? " " : "-";
    for (const dir of [`00${sepChar}收件箱`, `88${sepChar}输出`, `99${sepChar}归档`]) {
      await fs.mkdir(path.join(resolved, dir), { recursive: true });
    }
    // Seed v4 contract if missing
    const yamlPath = path.join(resolved, "topmind.yaml");
    if (!(await exists(yamlPath))) {
      const seed = {
        contract_version: 4,
        workspace: {
          name: "我的 topmind",
          locale: "zh-CN",
          template: effectiveTemplateId,
          category_separator: sepChar,
        },
        categories: { extensions: {}, overrides: {} },
        stream: { packing: "weekly", append_heading: "day" },
        memory: { dir: "memory", layers: { global: { file: "profile.md", update: "on-suggest" }, periodic: { dir: "periodic", cadence: "weekly", style: "brief" }, topics: { dir: "topics", auto_create: false } } },
        protection: { defaults: { by_role: { buffer: "open", "loose-stream": "open", "deep-work": "open", memory: "open", delivery: "open", system: "locked" } } },
        lifecycle: { inbox: { review_after_days: 7 }, catch_all: { retention_days: 30 }, stream: { digest_after_periods: 4 }, topic: { stale_after_days: 90, suggest_archive: true }, output: { lock_after_days: 30 } },
        writeback: { mode: "auto", shadow: true, backup_to: "99-归档/backups", receipts: "99-归档/receipts" },
        ingest: { default_target: "stream", url: { renderer: "auto" } },
        agent: { skills_entry: "topmind", confirm_by_default: false },
        presentation: { views: { default: "stream", enabled: ["stream", "category", "timeline", "tags", "kanban"] } },
      };
      await fs.writeFile(yamlPath, yaml.dump(seed, { lineWidth: -1, noRefs: true }), "utf8").catch(() => {});
    }
  }

  return resolved;
}

export async function isUserWorkspaceInitialized(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  // Any buffer-like 00* category, or any {NN-Name}/ shape counts as initialized
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    if (entries.some((e) => e.isDirectory() && /^\d{2}[ -].+/.test(e.name))) return true;
  } catch { /* fall through */ }
  return (await exists(path.join(resolved, "00-收件箱"))) || (await exists(path.join(resolved, "00 收件箱")))
  || (await exists(path.join(resolved, "00-Inbox"))) || (await exists(path.join(resolved, "00 Inbox")));
}
