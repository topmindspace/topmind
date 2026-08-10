/**
 * Client-side frontmatter split/join for the editor.
 * Body is edited in Tiptap; YAML block is preserved and managed by FrontmatterBar.
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u;

export function splitMarkdownFile(raw: string): {
  /** Full opening block including fences, or null */
  frontmatterBlock: string | null;
  body: string;
} {
  const src = String(raw ?? "");
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
  // Avoid triple blank lines
  const bodyNorm = b.replace(/^\n+/u, "");
  return `${fm}${bodyNorm.startsWith("\n") ? bodyNorm : bodyNorm}`;
}

/** Body-only content for preview / word count display. */
export function stripFrontmatter(raw: string): string {
  return splitMarkdownFile(raw).body;
}
