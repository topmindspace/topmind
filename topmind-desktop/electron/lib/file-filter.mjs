/**
 * Workspace browser file visibility filter.
 * Modes:
 * - default: notes + common docs (md/html/txt/office/pdf/…)
 * - markdown: .md / .markdown only
 * - all: every non-hidden file
 *
 * Vault descent rules match Kernel `lib/vault-walk.mjs` (tests lock the lists).
 * Electron must not static-import that module.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const FILE_FILTER_MODES = new Set(["default", "markdown", "all"]);

/** Default visible extensions for knowledge workbench. */
export const DEFAULT_BROWSER_EXTS = new Set([
  "md",
  "markdown",
  "html",
  "htm",
  "txt",
  "text",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "pptx",
  "ppt",
  "pdf",
  "csv",
  "rtf",
  "json",
  "yaml",
  "yml",
  "xml",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

export const MARKDOWN_BROWSER_EXTS = new Set(["md", "markdown"]);

/**
 * macOS / editor packages. Keep in lockstep with lib/vault-walk.mjs.
 * Recursing these is what blows the fs.watch descriptor limit.
 */
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

/** Directory basenames that are never note trees. Dot names are a separate rule. */
export const HEAVY_DIR_NAMES = Object.freeze([
  "node_modules",
  "dist",
  "__pycache__",
  "__MACOSX",
  "venv",
]);

/** Skip internal / system dirs when walking workspace trees. */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".obsidian",
  ".trash",
  ".DS_Store",
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
 * Hidden, heavy, or package directories. `images/` stays visible.
 * @param {string} name
 * @returns {boolean}
 */
export function shouldSkipVaultDirName(name) {
  const n = String(name || "");
  if (!n || n.startsWith(".")) return true;
  return isHeavyDirName(n);
}

/**
 * Obsidian excluded-files regexes (`userIgnoreFilters`). Invalid lines drop.
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
      /* same as Obsidian: a bad line does not fail the vault */
    }
  }
  return out;
}

/**
 * @param {string} relPosix
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
 * `.obsidian/app.json` userIgnoreFilters. Missing file → [].
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

export function normalizeFileFilterMode(value, fallback = "default") {
  if (typeof value === "string" && FILE_FILTER_MODES.has(value)) return value;
  return fallback;
}

export function fileExtension(name) {
  const base = String(name || "").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * @param {string} name file basename
 * @param {"default"|"markdown"|"all"} mode
 */
export function shouldShowFile(name, mode = "default") {
  const m = normalizeFileFilterMode(mode);
  if (m === "all") return true;
  const ext = fileExtension(name);
  if (!ext) return m === "all";
  if (m === "markdown") return MARKDOWN_BROWSER_EXTS.has(ext);
  return DEFAULT_BROWSER_EXTS.has(ext);
}

export function shouldSkipDirName(name) {
  // images/ stays browsable — it is not a heavy dir. Packages and dependency
  // trees are hidden so the sidebar cannot expand into an .app bundle.
  return shouldSkipVaultDirName(name);
}
