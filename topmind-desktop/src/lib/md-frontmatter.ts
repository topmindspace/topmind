/**
 * Client-side frontmatter split/join for the editor.
 * Body is edited in Tiptap; YAML block is preserved and managed by FrontmatterBar.
 */

// Closing fence may sit at EOF with no trailing newline.
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export function splitMarkdownFile(raw: string): {
  /** Full opening block including fences, or null */
  frontmatterBlock: string | null;
  body: string;
} {
  // Strip BOM so a frontmatter block at the very start is still recognized.
  const src = String(raw ?? "").replace(/^\uFEFF/u, "");
  const m = src.match(FM_RE);
  if (!m) return { frontmatterBlock: null, body: src };
  return {
    frontmatterBlock: m[0],
    body: src.slice(m[0].length),
  };
}

/** Reassemble file for disk. Ensures a blank line after frontmatter when body is non-empty. */
export function joinMarkdownFile(frontmatterBlock: string | null, body: string): string {
  const b = String(body ?? "");
  if (!frontmatterBlock) return b;
  const fm = frontmatterBlock.endsWith("\n") ? frontmatterBlock : `${frontmatterBlock}\n`;
  if (!b) return fm;
  // Strip extra leading blank lines from the body, then insert exactly one
  // blank line after the frontmatter fence.
  const bodyNorm = b.replace(/^\n+/u, "");
  return `${fm}\n${bodyNorm}`;
}

/** Body-only content for preview / word count display. */
export function stripFrontmatter(raw: string): string {
  return splitMarkdownFile(raw).body;
}
