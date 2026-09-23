/**
 * Workspace history + launch candidates + path health probes + lifecycle hygiene.
 *
 * Contract:
 *  - Landing when there is no openable candidate (never invent a workspace).
 *  - Recents are capped, **canonically deduped**, sorted by lastOpenedAt.
 *  - Forbidden roots (Desktop runtime / engine app package) never stay in recents.
 *  - Paths that are missing / not a directory are pruned from recents.
 *  - Empty dirs (no category shape yet) stay in recents — user may open and initialize.
 *  - Stored absolute paths are NEVER rewritten via detectUserWorkspaceRoot.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { t as ei18n } from "./lib/electron-i18n.mjs";
import { resolveDesktopStateHome } from "./lib/workspace-home.mjs";
import {
  MAX_RECENT_WORKSPACES,
  canonicalizeWorkspacePathKey,
  dedupeRecentWorkspaceEntries,
  looksLikeDesktopRuntimePath,
  sameWorkspacePath,
} from "./lib/workspace-path-id.mjs";

export { MAX_RECENT_WORKSPACES, sameWorkspacePath, dedupeRecentWorkspaceEntries, canonicalizeWorkspacePathKey };

/** @typedef {'ok'|'missing'|'not-directory'|'unreadable'|'forbidden'} WorkspacePathStatus */
/** @typedef {'healthy'|'empty'|'missing'|'not-directory'|'unreadable'|'forbidden'} WorkspaceKind */

/**
 * @typedef {object} WorkspaceProbe
 * @property {boolean} ok
 * @property {WorkspacePathStatus} status
 * @property {string} path
 * @property {string} message
 * @property {boolean} [hasCategoryShape]
 * @property {boolean} [hasContract]
 * @property {WorkspaceKind} [kind]
 * @property {boolean} [suitable] — may be activated as content workspace
 */

export async function probeWorkspacePath(rootPath) {
  const resolved = path.resolve(String(rootPath || "").trim() || ".");
  if (!String(rootPath || "").trim()) {
    return {
      ok: false,
      status: "missing",
      kind: "missing",
      suitable: false,
      path: resolved,
      message: ei18n("workspace.emptyPath"),
    };
  }
  let st;
  try {
    st = await fs.stat(resolved);
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? e.code : "";
    return {
      ok: false,
      status: "missing",
      kind: "missing",
      suitable: false,
      path: resolved,
      message: code === "ENOENT" ? ei18n("workspace.notExist") : ei18n("workspace.accessFail", { code: code || "error" }),
    };
  }
  if (!st.isDirectory()) {
    return {
      ok: false,
      status: "not-directory",
      kind: "not-directory",
      suitable: false,
      path: resolved,
      message: ei18n("workspace.notDirectory"),
    };
  }

  // Prefer realpath for stable identity (symlink collapse)
  let real = resolved;
  try {
    real = await fs.realpath(resolved);
  } catch {
    /* keep resolved */
  }

  let hasCategoryShape = false;
  let hasContract = false;
  let names = [];
  try {
    names = await fs.readdir(real);
    hasCategoryShape = names.some((e) => /^\d{2}[ -].+/u.test(e));
    hasContract = names.includes("topmind.yaml") || names.includes(".topmind-config.json");
  } catch {
    return {
      ok: false,
      status: "unreadable",
      kind: "unreadable",
      suitable: false,
      path: real,
      message: ei18n("workspace.readFail"),
    };
  }

  return {
    ok: true,
    status: "ok",
    kind: hasCategoryShape || hasContract ? "healthy" : "empty",
    suitable: true,
    path: real,
    message: hasCategoryShape || hasContract ? ei18n("workspace.usable") : ei18n("workspace.emptyFolder"),
    hasCategoryShape,
    hasContract,
  };
}

/**
 * True when path is Desktop runtime state or the Desktop/engine app package —
 * never a user content workspace.
 * @param {string} rootPath
 * @param {{ desktopStateHome?: string, engineRoot?: string|null }} [options]
 */
export async function isForbiddenWorkspaceRoot(rootPath, options = {}) {
  const resolved = path.resolve(String(rootPath || "").trim() || ".");
  let real = resolved;
  try {
    real = await fs.realpath(resolved);
  } catch {
    /* keep */
  }

  const desktopHome = path.resolve(options.desktopStateHome || resolveDesktopStateHome());
  if (sameWorkspacePath(real, desktopHome)) return true;
  // Nested under Desktop state home
  const relToDesktop = path.relative(desktopHome, real);
  if (relToDesktop && !relToDesktop.startsWith("..") && !path.isAbsolute(relToDesktop)) return true;

  if (looksLikeDesktopRuntimePath(real)) {
    // Confirm package shape when basename matches
    try {
      const pkgPath = path.join(real, "package.json");
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw);
      if (pkg?.name === "topmind-desktop") return true;
    } catch {
      // basename alone is enough to reject topmind-desktop
      if (path.basename(real) === "topmind-desktop") return true;
    }
  }

  // Engine monorepo / packaged engine root (skills+templates+lib)
  if (options.engineRoot) {
    const eng = path.resolve(options.engineRoot);
    if (sameWorkspacePath(real, eng)) return true;
  }
  try {
    const names = await fs.readdir(real);
    const set = new Set(names);
    if (set.has("skills") && set.has("templates") && set.has("topmind-desktop")) return true;
    if (set.has("templates") && set.has("lib") && set.has("utr") && !names.some((n) => /^\d{2}[ -]/u.test(n))) {
      // portable engine pack without user categories
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Full classification for onboarding / switcher / activate.
 * @param {string} rootPath
 * @param {{ desktopStateHome?: string, engineRoot?: string|null }} [options]
 * @returns {Promise<WorkspaceProbe>}
 */
export async function classifyWorkspaceRoot(rootPath, options = {}) {
  const probe = await probeWorkspacePath(rootPath);
  if (!probe.ok) return probe;
  if (await isForbiddenWorkspaceRoot(probe.path, options)) {
    return {
      ok: false,
      status: "forbidden",
      kind: "forbidden",
      suitable: false,
      path: probe.path,
      message: ei18n("workspace.forbiddenRuntime"),
      hasCategoryShape: probe.hasCategoryShape,
      hasContract: probe.hasContract,
    };
  }
  return {
    ...probe,
    suitable: true,
  };
}

export async function resolveDefaultUserWorkspaceRootForSettings(defaultUserWorkspaceRootCandidate, _engineRoot) {
  return path.resolve(String(defaultUserWorkspaceRootCandidate || "").trim() || ".");
}

async function normalizeStoredRootPath(rootPath, options = {}) {
  const pruneMissing = options.pruneMissing !== false;
  const resolved = path.resolve(String(rootPath || "").trim());
  if (!String(rootPath || "").trim()) return { ok: false, path: resolved, status: "missing" };
  if (!pruneMissing) return { ok: true, path: resolved, status: "ok" };
  const classified = await classifyWorkspaceRoot(resolved, {
    engineRoot: options.engineRoot,
    desktopStateHome: options.desktopStateHome,
  });
  if (!classified.ok || classified.suitable === false) {
    return {
      ok: false,
      path: classified.path || resolved,
      status: classified.status || "forbidden",
      message: classified.message,
    };
  }
  return { ok: true, path: classified.path, status: classified.status };
}

/**
 * Normalize recents (dedupe / sort / cap / prune forbidden+missing).
 */
export async function normalizeStoredWorkspaceHistory(settings, engineRoot, options = {}) {
  const pruneMissing = options.pruneMissing !== false;
  const desktopStateHome = options.desktopStateHome || resolveDesktopStateHome();
  const nextSettings = {
    ...settings,
    workspaceRoot: settings?.workspaceRoot ? path.resolve(settings.workspaceRoot) : settings?.workspaceRoot,
    workspaces: {
      ...(settings?.workspaces || {}),
      recent: [],
    },
  };

  const removed = [];
  const classOpts = { engineRoot, desktopStateHome };

  if (settings?.workspaceRoot && String(settings.workspaceRoot).trim()) {
    const active = await normalizeStoredRootPath(settings.workspaceRoot, {
      pruneMissing,
      ...classOpts,
    });
    if (!active.ok) {
      removed.push({
        rootPath: path.resolve(settings.workspaceRoot),
        status: active.status,
        message: active.message,
        wasActive: true,
      });
      nextSettings.workspaceRoot = "";
    } else {
      nextSettings.workspaceRoot = active.path;
    }
  }

  const recentEntries = Array.isArray(settings?.workspaces?.recent) ? settings.workspaces.recent : [];
  /** @type {Array<{ rootPath: string, lastOpenedAt: string }>} */
  const kept = [];

  for (const entry of recentEntries) {
    if (!entry?.rootPath) continue;
    const norm = await normalizeStoredRootPath(entry.rootPath, { pruneMissing, ...classOpts });
    if (!norm.ok) {
      removed.push({ rootPath: path.resolve(entry.rootPath), status: norm.status, message: norm.message });
      continue;
    }
    kept.push({
      rootPath: norm.path,
      lastOpenedAt:
        typeof entry.lastOpenedAt === "string" && entry.lastOpenedAt.trim()
          ? entry.lastOpenedAt
          : new Date().toISOString(),
    });
  }

  nextSettings.workspaces.recent = dedupeRecentWorkspaceEntries(kept, MAX_RECENT_WORKSPACES);

  const changed =
    nextSettings.workspaceRoot !== settings?.workspaceRoot ||
    JSON.stringify(nextSettings.workspaces.recent) !==
      JSON.stringify(settings?.workspaces?.recent || []);

  return { settings: nextSettings, changed, removed };
}

export function touchRecentWorkspace(settings, rootPath, lastOpenedAt = new Date().toISOString()) {
  const resolved = path.resolve(rootPath);
  const prev = Array.isArray(settings?.workspaces?.recent) ? settings.workspaces.recent : [];
  const nextRecent = dedupeRecentWorkspaceEntries(
    [{ rootPath: resolved, lastOpenedAt }, ...prev],
    MAX_RECENT_WORKSPACES,
  );
  return {
    ...settings,
    workspaceRoot: resolved,
    workspaces: {
      ...(settings?.workspaces || {}),
      recent: nextRecent,
    },
  };
}

export function removeRecentWorkspace(settings, rootPath) {
  const prev = Array.isArray(settings?.workspaces?.recent) ? settings.workspaces.recent : [];
  const nextRecent = prev.filter((e) => e?.rootPath && !sameWorkspacePath(e.rootPath, rootPath));
  const clearActive =
    settings?.workspaceRoot && sameWorkspacePath(settings.workspaceRoot, rootPath);
  return {
    ...settings,
    workspaceRoot: clearActive ? "" : settings?.workspaceRoot || "",
    workspaces: {
      ...(settings?.workspaces || {}),
      recent: dedupeRecentWorkspaceEntries(nextRecent, MAX_RECENT_WORKSPACES),
    },
  };
}

export function listLaunchCandidates({
  launchWorkspaceRoot = null,
  settings = null,
  defaultUserWorkspaceRoot = null,
} = {}) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p) return;
    const r = path.resolve(p);
    const key = canonicalizeWorkspacePathKey(r);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  push(launchWorkspaceRoot);

  const recentEntries = dedupeRecentWorkspaceEntries(
    Array.isArray(settings?.workspaces?.recent) ? settings.workspaces.recent : [],
  );

  const active = settings?.workspaceRoot && String(settings.workspaceRoot).trim()
    ? path.resolve(settings.workspaceRoot)
    : null;
  const bareDefault =
    defaultUserWorkspaceRoot && String(defaultUserWorkspaceRoot).trim()
      ? path.resolve(defaultUserWorkspaceRoot)
      : null;

  const activeIsBareDefault =
    active && bareDefault && sameWorkspacePath(active, bareDefault);
  const bareDefaultInRecents = bareDefault
    ? recentEntries.some((e) => e?.rootPath && sameWorkspacePath(e.rootPath, bareDefault))
    : false;

  if (active && !(activeIsBareDefault && !bareDefaultInRecents)) {
    push(active);
  }

  for (const entry of recentEntries) {
    push(entry?.rootPath);
  }

  return out;
}

export function pickLaunchWorkspaceCandidate(opts = {}) {
  const list = listLaunchCandidates(opts);
  return list[0] || null;
}
