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
  return v === "all" || v === "profile" || v === "periodic" || v === "topic" || v === "history";
}

/**
 * @param {Array<{kind: string}>|null|undefined} items
 * @param {string} layer
 * @returns {Array<{kind: string}>}
 */
export function filterMemoryFeedByLayer(items, layer) {
  const list = Array.isArray(items) ? items : [];
  if (layer === "all") return list.filter((i) => i.history !== true);
  if (layer === "history") return list.filter((i) => i.history === true);
  if (layer === "profile") return list.filter((i) => i.kind === "profile" && i.history !== true);
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

const HISTORY_HEADINGS = new Set(["历史记录", "History", "Archived"]);

function listMarkerIndent(line) {
  const m = String(line || "").match(/^(\s*)(?:[-*+]|\d+\.)\s+\S/u);
  if (!m) return -1;
  return m[1].replace(/\t/gu, "  ").length;
}

function isTopLevelListItem(line) {
  const indent = listMarkerIndent(line);
  return indent >= 0 && indent <= 3;
}

function splitFirstLevelListItems(content) {
  const lines = String(content || "").replace(/\r\n/gu, "\n").split("\n");
  const out = [];
  let buf = [];
  let baseIndent = null;
  const flush = () => {
    const chunk = buf.join("\n").replace(/^\n+|\n+$/gu, "");
    buf = [];
    if (chunk.trim()) out.push(chunk);
  };
  for (const line of lines) {
    const indent = listMarkerIndent(line);
    if (indent >= 0 && (baseIndent === null || indent <= baseIndent)) {
      if (baseIndent === null || indent < baseIndent) baseIndent = indent;
      if (indent === baseIndent) {
        flush();
        buf.push(line);
        continue;
      }
    }
    if (buf.length > 0) {
      buf.push(line);
    } else if (line.trim()) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function previewOf(text, max = 180) {
  const t = String(text || "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/^\s*(?:>\s*)+/gmu, "")
    .replace(/\s*\\+$/gmu, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gmu, "")
    .replace(/^\s*\d+\.\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

/** Title chrome: nested list / blockquote / heading marks (e.g. `- > ### Text`). */
function stripTitleChrome(line) {
  let out = String(line || "").trim();
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(/^#{1,6}\s+/u, "")
      .replace(/^\s*(?:>\s*)+/u, "")
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/u, "")
      .replace(/^\s*\d+\.\s+/u, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

function isHeadingOnlyChunk(chunk) {
  const lines = String(chunk || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^#{1,6}\s/u.test(l));
}

/** A heading-only chunk labels the content that follows — it must not become
 * its own row (title and body would both show the raw `###` line). */
function mergeHeadingOnlyChunks(chunks) {
  const merged = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && isHeadingOnlyChunk(merged[merged.length - 1])) {
      merged.push(`${merged.pop()}\n${chunk}`);
    } else {
      merged.push(chunk);
    }
  }
  return merged;
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

function itemsFromBlock(heading, content, filePath, kind, idPrefix) {
  const body = String(content || "").trim();
  if (!body) return [];

  const history = HISTORY_HEADINGS.has(heading);
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
        ...(history ? { history: true } : {}),
      },
    ];
  }

  return mergeHeadingOnlyChunks(splitFirstLevelListItems(body)).map((chunk, idx) => {
    const first = chunk.split("\n").find((l) => l.trim()) || chunk;
    const title = stripTitleChrome(first) || heading || previewOf(chunk, 48);
    return {
      id: `${idPrefix}:${idx}`,
      kind,
      path: filePath,
      title,
      preview: previewOf(chunk),
      body: chunk,
      heading: heading || undefined,
      ...(history ? { history: true } : {}),
    };
  });
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
