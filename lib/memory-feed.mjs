/**
 * Memory browse — read projection of the memory plane
 * (profile / periodic / topics). Not a ninth engine and not a parallel store:
 * items name the live workspace-relative path. Hosts (Desktop renderer copy
 * + Obsidian re-export) must stay behavior-identical; tests/memory-feed*.mjs
 * lock that.
 */

export const MEMORY_FEED_KINDS = ["profile", "periodic", "topic"];

/**
 * @param {unknown} v
 * @returns {v is "all"|"profile"|"periodic"|"topic"}
 */
export function isMemoryFeedLayer(v) {
  return v === "all" || v === "profile" || v === "periodic" || v === "topic";
}

/**
 * @param {Array<{kind: string}>|null|undefined} items
 * @param {string} layer
 * @returns {Array<{kind: string}>}
 */
export function filterMemoryFeedByLayer(items, layer) {
  const list = Array.isArray(items) ? items : [];
  if (layer === "all") return list;
  return list.filter((i) => i.kind === layer);
}

function stripFrontmatter(md) {
  const m = String(md || "").match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  return m ? String(md).slice(m[0].length) : String(md || "");
}

function fmTitle(md) {
  const m = String(md || "").match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!m) return null;
  const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/mu);
  return t?.[1]?.trim() || null;
}

function titleFromPath(p) {
  const base = String(p || "").split("/").pop() || p;
  return base.replace(/\.md$/iu, "");
}

function isTopLevelListItem(line) {
  return /^\s{0,3}[-*+]\s+\S/u.test(line) || /^\s{0,3}\d+\.\s+\S/u.test(line);
}

function previewOf(text, max = 180) {
  const t = String(text || "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gmu, "")
    .replace(/^\s*\d+\.\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

function firstSubstantialIsList(content) {
  for (const line of String(content || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^<!--/u.test(t)) continue;
    if (/^#{1,6}\s/u.test(t)) continue;
    if (t === "---") continue;
    return isTopLevelListItem(line);
  }
  return false;
}

function stripListChrome(line) {
  return line
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/u, "")
    .replace(/^\s*\d+\.\s+/u, "")
    .trim();
}

function itemsFromBlock(heading, content, filePath, kind, idPrefix) {
  const body = String(content || "").trim();
  if (!body) return [];

  if (!firstSubstantialIsList(body)) {
    return [
      {
        id: idPrefix,
        kind,
        path: filePath,
        title: heading || previewOf(body, 48) || titleFromPath(filePath),
        preview: previewOf(body),
        body,
        heading: heading || undefined,
      },
    ];
  }

  const lines = body.split("\n");
  const out = [];
  let buf = [];
  const flush = () => {
    if (buf.length === 0) return;
    const chunk = buf.join("\n").trim();
    buf = [];
    if (!chunk) return;
    const first = chunk.split("\n").find((l) => l.trim()) || chunk;
    const title = stripListChrome(first) || heading || previewOf(chunk, 48);
    out.push({
      id: `${idPrefix}:${out.length}`,
      kind,
      path: filePath,
      title,
      preview: previewOf(chunk),
      body: chunk,
      heading: heading || undefined,
    });
  };
  for (const line of lines) {
    if (isTopLevelListItem(line)) {
      flush();
      buf.push(line);
    } else if (buf.length > 0) {
      buf.push(line);
    } else if (line.trim()) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function profileSections(markdown) {
  const body = stripFrontmatter(markdown);
  const parts = body.split(/^## (.+)$/mu);
  const sections = [];
  const preamble = (parts[0] || "").replace(/^#[^\n]*\n?/u, "").trim();
  if (preamble) sections.push({ heading: "", content: preamble });
  for (let i = 1; i < parts.length; i += 2) {
    const heading = (parts[i] || "").trim();
    const content = (parts[i + 1] || "").trim();
    if (!heading && !content) continue;
    sections.push({ heading, content });
  }
  return sections;
}

/**
 * Assemble a feed from live markdown files. Empty plane → empty array
 * (the view shows a placeholder; this function never throws).
 *
 * @param {{
 *   profile: {path: string, markdown: string}|null,
 *   periodic: Array<{path: string, markdown: string}>,
 *   topics: Array<{path: string, markdown: string}>,
 * }|null|undefined} source
 * @returns {Array<{
 *   id: string, kind: string, path: string, title: string,
 *   preview: string, body: string, heading?: string
 * }>}
 */
export function assembleMemoryFeed(source) {
  if (!source) return [];
  const out = [];

  if (source.profile && source.profile.path) {
    const filePath = source.profile.path;
    const sections = profileSections(source.profile.markdown || "");
    let i = 0;
    for (const s of sections) {
      const items = itemsFromBlock(
        s.heading,
        s.content,
        filePath,
        "profile",
        `profile:${filePath}:${i}`,
      );
      i += 1;
      out.push(...items);
    }
  }

  for (const f of source.periodic || []) {
    if (!f?.path) continue;
    const body = stripFrontmatter(f.markdown || "").trim();
    if (!body) continue;
    out.push({
      id: `periodic:${f.path}`,
      kind: "periodic",
      path: f.path,
      title: fmTitle(f.markdown) || titleFromPath(f.path),
      preview: previewOf(body),
      body,
    });
  }

  for (const f of source.topics || []) {
    if (!f?.path) continue;
    const body = stripFrontmatter(f.markdown || "").trim();
    if (!body) continue;
    out.push({
      id: `topic:${f.path}`,
      kind: "topic",
      path: f.path,
      title: fmTitle(f.markdown) || titleFromPath(f.path),
      preview: previewOf(body),
      body,
    });
  }

  return out;
}
