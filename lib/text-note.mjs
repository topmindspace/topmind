/**
 * Text-note write/read surface (engine single source of truth).
 *
 * Surfaces must NOT re-implement this inventory:
 * - Desktop `workspace-path-ops` gates save_path / edit_file
 * - Obsidian `workspace-agent-tools` gates save_file
 * - Desktop `file-preview` routes editor vs preview
 *
 * Binary assets stay on `saveBinary` / media channels — never here.
 */

export const TEXT_NOTE_EXTS = Object.freeze([
  ".md", ".markdown", ".txt", ".text", ".log",
  ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".csv", ".tsv",
  ".html", ".htm", ".xml", ".svg",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".css", ".scss", ".less",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".graphql", ".gql",
]);

/** Extension without dot (lowercase) — for Set-based preview routing. */
export const TEXT_NOTE_EXT_SET = Object.freeze(
  new Set(TEXT_NOTE_EXTS.map((e) => e.replace(/^\./u, ""))),
);

/**
 * True when a workspace-relative path is a writable/editable text note.
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isTextNotePath(relativePath) {
  const rel = String(relativePath || "").replace(/\\/gu, "/").toLowerCase();
  return TEXT_NOTE_EXTS.some((ext) => rel.endsWith(ext));
}

/**
 * True when the Markdown editor (TipTap) should own this note.
 * `.md`/`.markdown` are first-class; other text notes open as plain text
 * in the same editor surface (no second editor).
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isMarkdownNotePath(relativePath) {
  const rel = String(relativePath || "").replace(/\\/gu, "/").toLowerCase();
  return rel.endsWith(".md") || rel.endsWith(".markdown");
}

/**
 * True when FileEditorView should open this path (editable text).
 * Preview-only remains for unknown/binary-ish extensions.
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isEditableNotePath(relativePath) {
  return isTextNotePath(relativePath);
}
