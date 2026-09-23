/**
 * Non-markdown file preview helpers — used by FilePreviewView.
 * Pure transforms so truncation / text-vs-binary routing can be unit-tested.
 *
 * Text-note inventory truth is engine `lib/text-note.mjs`. `PREVIEW_TEXT_EXTS`
 * here is the renderer routing set (no dot, lowercase) and must stay a
 * superset of `TEXT_NOTE_EXT_SET` — locked by tests/ai-write-lenient.
 */

export const PREVIEW_TEXT_EXTS = new Set([
  "md", "txt", "text", "markdown", "mdx", "json", "jsonl", "jsonc", "yaml", "yml", "csv", "tsv",
  "log", "ini", "toml", "xml", "svg", "html", "htm", "css", "scss", "less",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "fish", "ps1", "bat", "sql",
  "graphql", "gql", "env",
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

/** Workspace notes the Markdown editor owns. Split pane must use the same test. */
export function isMarkdownNotePath(p: string): boolean {
  return extOf(p) === "md" || extOf(p) === "markdown";
}

/**
 * Editable text surface (FileEditorView). Markdown + other text notes.
 * Matches engine `isEditableNotePath` / `isTextNotePath`.
 */
export function isEditableNotePath(p: string): boolean {
  const ext = extOf(p);
  if (!ext) return false;
  return ext === "md" || ext === "markdown" || PREVIEW_TEXT_EXTS.has(ext);
}

export function isHtmlPreviewExt(ext: string): boolean {
  return ext === "html" || ext === "htm";
}

export function isPreviewableText(ext: string): boolean {
  return ext === "" || PREVIEW_TEXT_EXTS.has(ext);
}

export function previewTruncationLimit(isHtml: boolean): number {
  return isHtml ? HTML_PREVIEW_MAX_BYTES : TEXT_PREVIEW_MAX_CHARS;
}

export function truncatePreviewContent(
  body: string,
  isHtml: boolean,
): { body: string; truncated: boolean } {
  const src = String(body ?? "");
  // HTML uses only the HTML cap — do not fall through to the tighter text cap.
  const limit = previewTruncationLimit(isHtml);
  if (src.length > limit) {
    return { body: src.slice(0, limit), truncated: true };
  }
  return { body: src, truncated: false };
}
