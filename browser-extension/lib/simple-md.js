/**
 * Capture note helpers for workspace-local clip.
 * HTML → Markdown is `./html-to-markdown.mjs` (same algorithm as Desktop).
 */

/**
 * Build topmind capture note with frontmatter (PROJECT-MODEL aligned).
 * @param {{
 *   title?: string,
 *   body: string,
 *   source?: string,
 *   mode?: string,
 *   author?: string,
 *   site_name?: string,
 *   published?: string,
 *   properties?: Record<string, string>,
 *   template_id?: string,
 *   word_count?: number,
 * }} p
 */
export function buildCaptureMarkdown(p) {
  const title = sanitizeYaml(String(p.title || "capture").slice(0, 160));
  const now = new Date().toISOString();
  const lines = [
    "---",
    `title: "${title}"`,
    `source_type: "external-capture"`,
    `captured_at: "${now}"`,
    `status: "todo"`,
  ];
  const props = { ...(p.properties || {}) };
  if (p.source && !props.source) props.source = p.source;
  if (p.mode && !props.fetch_method) props.fetch_method = p.mode;
  if (p.author && !props.author) props.author = p.author;
  if (p.site_name && !props.site_name) props.site_name = p.site_name;
  if (p.published && !props.published) props.published = p.published;
  if (p.template_id) props.clip_template = p.template_id;
  if (typeof p.word_count === "number") props.word_count = String(p.word_count);

  const skip = new Set(["title", "source_type", "captured_at", "status"]);
  for (const [k, v] of Object.entries(props)) {
    if (skip.has(k) || v == null || String(v).trim() === "") continue;
    lines.push(`${k}: "${sanitizeYaml(String(v))}"`);
  }
  if (!props.clip_channel) lines.push(`clip_channel: "extension-workspace"`);
  lines.push("---", "", p.body || "", "");
  return lines.join("\n");
}

function sanitizeYaml(s) {
  return String(s || "")
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, " ")
    .trim();
}

/**
 * Safe filename from title.
 * @param {string} title
 */
export function captureFilename(title) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  let base = String(title || "capture")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 60);
  if (!base) base = `capture-${stamp}`;
  return `${base}.md`;
}
