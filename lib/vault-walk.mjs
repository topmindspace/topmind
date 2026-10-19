// Vault walk fence shared by Kernel, UTR, and the Obsidian plugin.
// Desktop keeps a behavior-locked copy in electron/lib/file-filter.mjs
// (electron must not static-import this file — asar crash). tests/vault-walk.test.mjs
// and topmind-desktop/tests/vault-watch.test.mjs fail if the two drift.
//
// A topmind workspace is an Obsidian vault. Walks and watches stay inside the
// vault: they do not follow a symlink whose target is outside the workspace,
// and they do not recurse into dependency trees or macOS/editor package bundles.
// `.obsidian/app.json` `userIgnoreFilters` are Obsidian excluded-file regexes
// matched against the workspace-relative posix path.

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** macOS / editor packages. Recursing these exhausts fs.watch descriptors. */
export const OPAQUE_PACKAGE_EXTENSIONS = Object.freeze([
  ".app",
  ".framework",
  ".bundle",
  ".plugin",
  ".kext",
  ".photoslibrary",
  ".aplibrary",
  ".logicx",
  ".band",
  ".imovielibrary",
  ".tvlibrary",
]);

/** Directory basenames that are never note trees, at any depth. */
export const HEAVY_DIR_NAMES = Object.freeze([
  "node_modules",
  "dist",
  "__pycache__",
  "__MACOSX",
  "venv",
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isOpaquePackageName(name) {
  const base = String(name || "");
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return false;
  return OPAQUE_PACKAGE_EXTENSIONS.includes(lower.slice(dot));
}

/**
 * Dependency / build / package directories. Does not treat dot names as heavy
 * (callers that already skip "." decide that themselves).
 * @param {string} name
 * @returns {boolean}
 */
export function isHeavyDirName(name) {
  const n = String(name || "");
  if (!n) return false;
  if (HEAVY_DIR_NAMES.includes(n)) return true;
  return isOpaquePackageName(n);
}

/**
 * Names a notes browser should not descend into: hidden, heavy, or a package.
 * @param {string} name
 * @returns {boolean}
 */
export function shouldSkipVaultDirName(name) {
  const n = String(name || "");
  if (!n || n.startsWith(".")) return true;
  return isHeavyDirName(n);
}

/**
 * Whether a readdir dirent is a real directory we may walk.
 * Symlinks are never followed here; the target is visited only if it is also
 * a real path inside the vault.
 * @param {{ name?: string, isDirectory?: () => boolean, isSymbolicLink?: () => boolean }} dirent
 * @returns {boolean}
 */
export function shouldDescendDirent(dirent) {
  if (!dirent || typeof dirent.name !== "string") return false;
  if (typeof dirent.isSymbolicLink === "function" && dirent.isSymbolicLink()) return false;
  if (typeof dirent.isDirectory !== "function" || !dirent.isDirectory()) return false;
  return !shouldSkipVaultDirName(dirent.name);
}

/**
 * Obsidian excluded-files list: each entry is a JavaScript regular expression
 * tested against the vault-relative path (forward slashes, no leading slash).
 * Invalid patterns are dropped.
 * @param {unknown} patterns
 * @returns {RegExp[]}
 */
export function compileUserIgnoreFilters(patterns) {
  if (!Array.isArray(patterns)) return [];
  /** @type {RegExp[]} */
  const out = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    const source = pattern.trim();
    if (!source) continue;
    try {
      out.push(new RegExp(source));
    } catch {
      /* Obsidian skips a broken line rather than failing the vault open */
    }
  }
  return out;
}

/**
 * @param {string} relPosix workspace-relative path using `/`
 * @param {RegExp[]} filters
 * @returns {boolean}
 */
export function pathMatchesUserIgnore(relPosix, filters) {
  if (!filters || filters.length === 0) return false;
  const rel = String(relPosix || "").replace(/\\/g, "/").replace(/^\/+/u, "");
  if (!rel || rel.startsWith("../") || rel === "..") return false;
  return filters.some((re) => {
    try {
      return re.test(rel);
    } catch {
      return false;
    }
  });
}

/**
 * Read `.obsidian/app.json` userIgnoreFilters. Missing file → no extra skips.
 * @param {string} workspaceRoot
 * @returns {RegExp[]}
 */
export function loadVaultIgnoreSync(workspaceRoot) {
  if (!workspaceRoot) return [];
  try {
    const raw = readFileSync(path.join(workspaceRoot, ".obsidian", "app.json"), "utf8");
    const parsed = JSON.parse(raw);
    return compileUserIgnoreFilters(parsed?.userIgnoreFilters);
  } catch {
    return [];
  }
}

/**
 * True when `absPath` is a symlink and its real target is not inside the workspace.
 * A dangling link is treated as escaping so a walk cannot follow it later.
 * @param {string} workspaceRoot
 * @param {string} absPath
 * @returns {boolean}
 */
export function isEscapingSymlinkSync(workspaceRoot, absPath) {
  let st;
  try {
    st = lstatSync(absPath);
  } catch {
    return false;
  }
  if (!st.isSymbolicLink()) return false;
  let realTarget;
  try {
    realTarget = realpathSync(absPath);
  } catch {
    return true;
  }
  let realRoot;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }
  const rel = path.relative(realRoot, realTarget);
  if (rel === "") return false;
  if (!rel || path.isAbsolute(rel)) return true;
  const posix = rel.replace(/\\/g, "/");
  return posix === ".." || posix.startsWith("../");
}

/**
 * True when an existing path resolves outside the workspace.
 * Unlike {@link isEscapingSymlinkSync}, this follows intermediate links, so
 * `vault/escape/note.md` is outside when `escape` points at `/Applications`.
 * A missing path is not outside — callers keep their own not-found result.
 * @param {string} workspaceRoot
 * @param {string} absPath
 * @returns {boolean}
 */
export function resolvesOutsideVaultSync(workspaceRoot, absPath) {
  if (!workspaceRoot || !absPath) return false;
  let realTarget;
  try {
    realTarget = realpathSync(absPath);
  } catch {
    return false;
  }
  let realRoot;
  try {
    realRoot = realpathSync(workspaceRoot);
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }
  const rel = path.relative(realRoot, realTarget);
  if (rel === "") return false;
  if (!rel || path.isAbsolute(rel)) return true;
  const posix = rel.replace(/\\/g, "/");
  return posix === ".." || posix.startsWith("../");
}
