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

/**
 * Project clean v4 nested contract keys onto flat convenience aliases (in-memory only).
 * Kernel `loadContract()` no longer injects these aliases (validateContract whitelist);
 * Desktop loaders must project so path-model / connectors keep working on pure v4 YAML.
 * Does not mutate the input object.
 * @param {object|null|undefined} raw
 * @returns {object}
 */
export function projectConfigAliases(raw) {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  if (config.workspace?.template && !config.template) {
    config.template = config.workspace.template;
  }
  if (config.workspace?.category_separator && !config.categorySeparator) {
    config.categorySeparator = config.workspace.category_separator;
  }
  if (config.workspace?.locale && !config.locale) {
    config.locale = config.workspace.locale;
  }
  if (config.categories?.extensions && !config.categoryExtensions) {
    config.categoryExtensions = config.categories.extensions;
  }
  if (config.categories?.overrides && !config.categoryOverrides) {
    config.categoryOverrides = config.categories.overrides;
  }
  return config;
}

/**
 * Load workspace behavior contract via Kernel (async open paths).
 * Projects clean v4 → flat aliases in-memory only (UI/path-model convenience).
 * App-local prefs stay in app-settings.json — never forked here.
 */
export async function loadWorkspaceConfig(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  try {
    const { kernelLoadContract } = await import("./kernel-api.mjs");
    const contract = await kernelLoadContract(root);
    return projectConfigAliases(contract || {});
  } catch {
    // Fallback when engine root unavailable (tests / broken install)
    return loadWorkspaceConfigLocal(root);
  }
}

/**
 * Local yaml/json read + project aliases. Used by sync path-model and as
 * engine-unavailable fallback. Prefer Kernel loadWorkspaceConfig / ensure on open.
 */
function loadWorkspaceConfigLocal(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const yamlPath = path.join(root, "topmind.yaml");
  if (existsSync(yamlPath)) {
    try {
      const raw = readFileSync(yamlPath, "utf8");
      return projectConfigAliases(yaml.load(raw) || {});
    } catch {
      // Fall through to legacy
    }
  }
  const configPath = path.join(root, ".topmind-config.json");
  try {
    const data = readFileSync(configPath, "utf8");
    return projectConfigAliases(JSON.parse(data));
  } catch {
    return projectConfigAliases({});
  }
}

/** Synchronous workspace config loader — for use in sync path-model functions. */
export function loadWorkspaceConfigSync(workspaceRoot) {
  return loadWorkspaceConfigLocal(workspaceRoot);
}

/**
 * FS-only separator alignment for category dirs. Contract write goes through Kernel
 * ensureContract (via ensureRequiredStructure) — no second YAML seed blob.
 */
export async function autoRepairWorkspace(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  const config = await loadWorkspaceConfig(resolved);

  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((e) => e.isDirectory() && /^\d{2}[ -].+/.test(e.name))
    .map((e) => e.name);

  let targetSeparator = config.categorySeparator || config.workspace?.category_separator;
  let shouldWriteSeparator = false;

  if (!targetSeparator) {
    const hasHyphen = discovered.some((name) => name.charAt(2) === "-");
    const hasSpace = discovered.some((name) => name.charAt(2) === " ");
    if (hasHyphen || !hasSpace) {
      targetSeparator = "-";
    } else {
      targetSeparator = " ";
    }
    shouldWriteSeparator = true;
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

  // Persist separator via Kernel writeContract (not a surface-private dump)
  if (shouldWriteSeparator || renamedAny) {
    try {
      const { loadKernelApi } = await import("./kernel-api.mjs");
      const kernel = await loadKernelApi();
      const ensured = kernel.ensureContract(resolved, {
        categorySeparator: targetSeparator,
        templateId: config.template || config.workspace?.template,
        locale: config.locale || config.workspace?.locale,
      });
      // If already ok, still force separator into contract when inferred
      if (ensured.onDiskValid && ensured.contract && shouldWriteSeparator) {
        const next = {
          ...ensured.contract,
          workspace: {
            ...(ensured.contract.workspace || {}),
            category_separator: targetSeparator,
          },
        };
        kernel.writeContract(resolved, next);
      }
    } catch {
      // Engine unavailable — leave dirs renamed; next open will ensure contract
    }
  }
}

/**
 * Ensure workspace has required role dirs (buffer/delivery/system) and v4 contract.
 * Does NOT recreate optional template categories the user deleted.
 * On first init (empty workspace), seeds full template categories once.
 * Contract lifecycle is Kernel-only (ensureContract via ensureRequiredStructure).
 */
export async function ensureWorkspaceStructure(workspaceRoot, templateId = "stream") {
  const resolved = path.resolve(workspaceRoot);
  await fs.mkdir(resolved, { recursive: true });
  await autoRepairWorkspace(resolved).catch(() => {});

  const config = await loadWorkspaceConfig(resolved);
  const entries = await fs.readdir(resolved, { withFileTypes: true }).catch(() => []);
  const discovered = entries
    .filter((e) => e.isDirectory() && /^\d{2}[ -].+/.test(e.name))
    .map((e) => e.name);

  const effectiveTemplateId = config.template || config.workspace?.template || templateId;
  const isFirstInit = discovered.length === 0;

  if (isFirstInit) {
    // Brand-new workspace: seed full template category dirs once (UX layout only)
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
  }

  // Unified Kernel path: ensureContract + required roles (no surface seed YAML).
  // Always return contract health — callers must not invent "healthy" when unrepairable.
  let contractStatus = "unknown";
  let contractOnDiskValid = false;
  let contractErrors = [];
  let contractActions = [];
  let recovery = null;

  try {
    const { ensureRequiredStructure } = await import("./workspace-model-api.mjs");
    const result = await ensureRequiredStructure(resolved, {
      engineRoot: ENGINE_ROOT,
      templateId: effectiveTemplateId,
    });
    contractStatus = result.contractStatus || "ok";
    contractOnDiskValid = result.contractOnDiskValid !== false;
    contractErrors = Array.isArray(result.contractErrors) ? result.contractErrors : [];
    contractActions = Array.isArray(result.contractActions) ? result.contractActions : [];
    if (!contractOnDiskValid) {
      recovery = "system.reseedWorkspaceContract";
    }
  } catch {
    // Last resort when engine lib missing: required role dirs only + Kernel ensure if possible
    const sep = config.categorySeparator || config.workspace?.category_separator || "-";
    const sepChar = sep === " " ? " " : "-";
    for (const dir of [`00${sepChar}收件箱`, `88${sepChar}输出`, `99${sepChar}归档`]) {
      await fs.mkdir(path.join(resolved, dir), { recursive: true });
    }
    try {
      const { loadKernelApi } = await import("./kernel-api.mjs");
      const kernel = await loadKernelApi();
      const ensured = kernel.ensureContract(resolved, {
        templateId: effectiveTemplateId,
        categorySeparator: sepChar,
      });
      contractStatus = ensured.status;
      contractOnDiskValid = ensured.onDiskValid === true;
      contractErrors = Array.isArray(ensured.errors) ? ensured.errors : [];
      contractActions = Array.isArray(ensured.actions) ? ensured.actions : [];
      if (!contractOnDiskValid) recovery = "system.reseedWorkspaceContract";
    } catch (err) {
      contractStatus = "unknown";
      contractOnDiskValid = false;
      contractErrors = [err instanceof Error ? err.message : String(err)];
      recovery = "system.reseedWorkspaceContract";
    }
  }

  return {
    root: resolved,
    contractStatus,
    contractOnDiskValid,
    contractErrors,
    contractActions,
    recovery,
  };
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
