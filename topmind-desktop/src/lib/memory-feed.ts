/**
 * Memory browse — read projection of the memory plane (profile / periodic / topics).
 * No parallel store: items name the live workspace-relative path.
 */
export type MemoryFeedKind = "profile" | "periodic" | "topic";
export type MemoryFeedLayer = "all" | MemoryFeedKind | "history";

export function isMemoryFeedLayer(v: unknown): v is MemoryFeedLayer {
  return v === "all" || v === "profile" || v === "periodic" || v === "topic" || v === "history";
}

export interface MemoryFeedItem {
  id: string;
  kind: MemoryFeedKind;
  /** Workspace-relative path of the source file (open-in-editor target). */
  path: string;
  title: string;
  preview: string;
  body: string;
  /** Optional ## heading inside the file (focus after open). */
  heading?: string;
  /** Profile facts retired to ## 历史记录 (not deleted). */
  history?: boolean;
}

export function filterMemoryFeedByLayer(
  items: MemoryFeedItem[] | null | undefined,
  layer: MemoryFeedLayer,
): MemoryFeedItem[] {
  const list = Array.isArray(items) ? items : [];
  if (layer === "all") return list.filter((i) => i.history !== true);
  if (layer === "history") return list.filter((i) => i.history === true);
  if (layer === "profile") return list.filter((i) => i.kind === "profile" && i.history !== true);
  return list.filter((i) => i.kind === layer);
}

export interface MemoryFeedFile {
  path: string;
  markdown: string;
}

export interface MemoryFeedSource {
  profile: MemoryFeedFile | null;
  periodic: MemoryFeedFile[];
  topics: MemoryFeedFile[];
}

function stripFrontmatter(md: string): string {
  const m = String(md || "").match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/u);
  return m ? String(md).slice(m[0].length) : String(md || "");
}

function fmTitle(md: string): string | null {
  const m = String(md || "").match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!m) return null;
  const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/mu);
  return t?.[1]?.trim() || null;
}

function titleFromPath(p: string): string {
  const base = String(p || "").split("/").pop() || p;
  return base.replace(/\.md$/iu, "");
}

const HISTORY_HEADINGS = new Set(["历史记录", "History", "Archived"]);

function listMarkerIndent(line: string): number {
  const m = String(line || "").match(/^(\s*)(?:[-*+]|\d+\.)\s+\S/u);
  if (!m) return -1;
  return m[1].replace(/\t/gu, "  ").length;
}

function isTopLevelListItem(line: string): boolean {
  const indent = listMarkerIndent(line);
  return indent >= 0 && indent <= 3;
}

function splitFirstLevelListItems(content: string): string[] {
  const lines = String(content || "").replace(/\r\n/gu, "\n").split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  let baseIndent: number | null = null;
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

function previewOf(text: string, max = 180): string {
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

function firstSubstantialIsList(content: string): boolean {
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

function stripListChrome(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/u, "")
    .replace(/^\s*\d+\.\s+/u, "")
    .trim();
}

function itemsFromBlock(
  heading: string,
  content: string,
  path: string,
  kind: MemoryFeedKind,
  idPrefix: string,
): MemoryFeedItem[] {
  const body = String(content || "").trim();
  if (!body) return [];

  const history = HISTORY_HEADINGS.has(heading);
  if (!firstSubstantialIsList(body)) {
    return [
      {
        id: idPrefix,
        kind,
        path,
        title: heading || previewOf(body, 48) || titleFromPath(path),
        preview: previewOf(body),
        body,
        heading: heading || undefined,
        ...(history ? { history: true } : {}),
      },
    ];
  }

  const chunks = splitFirstLevelListItems(body);
  return chunks.map((chunk, idx) => {
    const first = chunk.split("\n").find((l) => l.trim()) || chunk;
    const title = stripListChrome(first) || heading || previewOf(chunk, 48);
    return {
      id: `${idPrefix}:${idx}`,
      kind,
      path,
      title,
      preview: previewOf(chunk),
      body: chunk,
      heading: heading || undefined,
      ...(history ? { history: true } : {}),
    };
  });
}

function profileSections(markdown: string): Array<{ heading: string; content: string }> {
  const body = stripFrontmatter(markdown);
  const parts = body.split(/^## (.+)$/mu);
  const sections: Array<{ heading: string; content: string }> = [];
  const preamble = (parts[0] || "")
    .replace(/^#[^\n]*\n?/u, "")
    .trim();
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
 */
export function assembleMemoryFeed(source: MemoryFeedSource | null | undefined): MemoryFeedItem[] {
  if (!source) return [];
  const out: MemoryFeedItem[] = [];

  if (source.profile && source.profile.path) {
    const path = source.profile.path;
    const sections = profileSections(source.profile.markdown || "");
    let i = 0;
    for (const s of sections) {
      const items = itemsFromBlock(
        s.heading,
        s.content,
        path,
        "profile",
        `profile:${path}:${i}`,
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
