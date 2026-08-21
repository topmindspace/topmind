/**
 * Non-markdown file preview helpers — used by FilePreviewView.
 * Pure transforms so truncation / text-vs-binary routing can be unit-tested.
 */

export const PREVIEW_TEXT_EXTS = new Set([
  "txt", "text", "markdown", "mdx", "json", "jsonc", "yaml", "yml", "csv", "tsv",
  "log", "ini", "toml", "xml", "svg", "html", "htm", "css", "scss", "less",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "sql", "env",
  "conf", "cfg", "properties", "gitignore", "editorconfig", "dockerfile", "makefile",
]);

/** Soft cap so huge HTML dumps don't inflate renderer memory. */
export const HTML_PREVIEW_MAX_BYTES = 1_500_000;
export const TEXT_PREVIEW_MAX_CHARS = 400_000;

export function extOf(p: string): string {
  const base = p.split("/").pop() ?? p;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isHtmlPreviewExt(ext: string): boolean {
  return ext === "html" || ext === "htm";
}

export function isPreviewableText(ext: string): boolean {
  return ext === "" || PREVIEW_TEXT_EXTS.has(ext);
}

export function truncatePreviewContent(
  body: string,
  isHtml: boolean,
): { body: string; truncated: boolean } {
  const src = String(body ?? "");
  if (isHtml && src.length > HTML_PREVIEW_MAX_BYTES) {
    return { body: src.slice(0, HTML_PREVIEW_MAX_BYTES), truncated: true };
  }
  if (src.length > TEXT_PREVIEW_MAX_CHARS) {
    return { body: src.slice(0, TEXT_PREVIEW_MAX_CHARS), truncated: true };
  }
  return { body: src, truncated: false };
}
