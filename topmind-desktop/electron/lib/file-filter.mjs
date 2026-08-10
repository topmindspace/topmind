/**
 * Workspace browser file visibility filter.
 * Modes:
 * - default: notes + common docs (md/html/txt/office/pdf/…)
 * - markdown: .md / .markdown only
 * - all: every non-hidden file
 */

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

/** Skip internal / system dirs when walking workspace trees. */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".obsidian",
  ".trash",
  ".DS_Store",
  "images", // media assets under topics — optional; keep for now as folder
]);

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
  const n = String(name || "");
  if (!n || n.startsWith(".")) return true;
  // Don't skip images/ as folder — users may want to browse; only skip true junk
  return n === "node_modules" || n === ".git" || n === ".obsidian" || n === ".trash";
}
