/**
 * Pure Obsidian-embed / markdown-image resolution.
 * No filesystem access — callers pass an already-known path list.
 *
 * Pathed `![[attachments/a.png]]` resolves from the workspace root.
 * Pathless `![[Pasted image.png]]` resolves by basename (image extensions
 * only, case-insensitive, shortest workspace-relative path on a tie).
 * Desktop `![alt](relative)` stays note-relative.
 * Wikilink origin is kept in the image title (`tmw:`) so save can restore it.
 */

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const WIKI_TITLE_PREFIX = "tmw:";

export function isWorkspaceImageName(name) {
  const base = String(name || "").replace(/\\/gu, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXT.has(base.slice(dot + 1).toLowerCase());
}

export function normalizePosixPath(rel) {
  const parts = [];
  for (const seg of String(rel || "").replace(/\\/gu, "/").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function decodePathSegment(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    // A bare `%` (decoded `%25`, or `100%-方案`) sits next to still-encoded
    // bytes. Escape only that `%`, then decode the valid %HH sequences.
    const repaired = seg.replace(/%(?![0-9A-Fa-f]{2})/gu, "%25");
    if (repaired === seg) return seg;
    try {
      return decodeURIComponent(repaired);
    } catch {
      return seg;
    }
  }
}

export function safeDecodePath(rel) {
  return String(rel || "")
    .replace(/\\/gu, "/")
    .split("/")
    .map(decodePathSegment)
    .join("/");
}

/**
 * Encode only characters that break an HTML src or a URL path (`%`, `&`,
 * space, quotes, brackets). Other Unicode (Chinese) stays readable.
 * A whole-segment encodeURIComponent would hide `方案` inside `100%-方案`.
 */
export function encodeAssetPath(rel) {
  return String(rel || "")
    .split("/")
    .map((seg) => seg.replace(/[%&"<>#?\\()[\]\s]/gu, (ch) => encodeURIComponent(ch)))
    .join("/");
}

export function localAssetUrl(workspaceRel) {
  return `topmind-asset://local/${encodeAssetPath(workspaceRel)}`;
}

function noteDirOf(noteRelativePath) {
  const p = String(noteRelativePath || "").replace(/\\/gu, "/");
  if (!p.includes("/")) return "";
  return p.split("/").slice(0, -1).join("/");
}

function hasScheme(url) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(String(url || "").trim());
}

function isRemoteOrSpecial(url) {
  const u = String(url || "").trim();
  return !u || /^(https?:|data:|topmind-asset:|blob:)/iu.test(u) || u.startsWith("//");
}

/**
 * Note-relative media path → workspace-relative path.
 * Mirrors resolveNoteMediaPath (images/ and ./ both join the note directory).
 */
export function resolveNoteRelativeMedia(noteRelativePath, mediaRel) {
  let cleaned = safeDecodePath(String(mediaRel || "").trim().replace(/^<|>$/gu, ""));
  cleaned = cleaned.replace(/^\.\//u, "").trim();
  if (!cleaned || cleaned.startsWith("/") || cleaned.split("/").includes("..")) return "";
  if (hasScheme(cleaned)) return "";
  const dir = noteDirOf(noteRelativePath);
  const joined = dir ? `${dir}/${cleaned}` : cleaned;
  return normalizePosixPath(joined);
}

export function parseEmbedSuffix(suffix) {
  const s = String(suffix || "").trim();
  if (!s) return {};
  const box = s.match(/^(\d+)\s*[xX×]\s*(\d+)$/u);
  if (box) return { width: Number(box[1]), height: Number(box[2]) };
  if (/^\d+$/u.test(s)) return { width: Number(s) };
  return { caption: s };
}

function parseWikilinkInner(inner) {
  const trimmed = String(inner || "").trim();
  if (!trimmed || trimmed.includes("#") || trimmed.includes("\n") || trimmed.includes("\0")) return null;
  const pipe = trimmed.indexOf("|");
  const target = (pipe >= 0 ? trimmed.slice(0, pipe) : trimmed).trim().replace(/\\/gu, "/");
  const suffix = pipe >= 0 ? trimmed.slice(pipe + 1).trim() : "";
  if (!target || target.startsWith("/") || hasScheme(target)) return null;
  if (target.split("/").includes("..")) return null;
  if (!isWorkspaceImageName(target)) return null;
  return { target, suffix, inner: trimmed };
}

/**
 * One pass over a known path list.
 * `knownPaths === undefined` → no list (pathed embeds stay optimistic, pathless do not resolve).
 * An array (even empty) is strict: a pathed embed must be in the list.
 */
export function buildImageIndex(knownPaths) {
  const hasList = Array.isArray(knownPaths);
  /** @type {Map<string, string>} */
  const byLower = new Map();
  /** @type {Map<string, string>} */
  const byBase = new Map();
  if (!hasList) return { hasList: false, byLower, byBase };
  for (const raw of knownPaths) {
    const p = normalizePosixPath(String(raw || ""));
    if (!p || p.split("/").includes("..") || !isWorkspaceImageName(p)) continue;
    const lower = p.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, p);
    const base = lower.split("/").pop() || lower;
    const prev = byBase.get(base);
    if (!prev || p.length < prev.length || (p.length === prev.length && p < prev)) {
      byBase.set(base, p);
    }
  }
  return { hasList: true, byLower, byBase };
}

export function resolveEmbedTarget(target, index) {
  const decoded = safeDecodePath(String(target || "").trim());
  if (!decoded || decoded.startsWith("/") || hasScheme(decoded)) return null;
  if (decoded.split("/").includes("..")) return null;
  const pathed = decoded.includes("/");
  if (pathed) {
    const norm = normalizePosixPath(decoded);
    if (!norm || !isWorkspaceImageName(norm)) return null;
    if (!index || !index.hasList) return norm;
    return index.byLower.get(norm.toLowerCase()) || null;
  }
  if (!index || !index.hasList) return null;
  return index.byBase.get(decoded.toLowerCase()) || null;
}

function sanitizeMdAlt(alt) {
  return String(alt || "").replace(/[\[\]]/gu, "").replace(/\n/gu, " ").trim();
}

function formatMdTarget(rel) {
  if (/[\s()]/u.test(rel)) return `<${rel}>`;
  return rel;
}

function mapOutsideFences(markdown, fn) {
  const lines = String(markdown ?? "").split("\n");
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let buf = [];
  let inFence = false;
  let fenceChar = "";
  const flush = (code) => {
    if (!buf.length) return;
    const text = buf.join("\n");
    out.push(code ? text : fn(text));
    buf = [];
  };
  for (const line of lines) {
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (!inFence && open) {
      flush(false);
      inFence = true;
      fenceChar = open[1][0];
      buf.push(line);
      continue;
    }
    if (inFence && new RegExp(`^ {0,3}${fenceChar}{3,}`, "u").test(line)) {
      buf.push(line);
      flush(true);
      inFence = false;
      fenceChar = "";
      continue;
    }
    buf.push(line);
  }
  flush(inFence);
  return out.join("\n");
}

function mapOutsideInlineCode(text, fn) {
  const re = /(`+)([^`]*)\1/gu;
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    out += fn(text.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }
  out += fn(text.slice(last));
  return out;
}

const MD_IMG_RE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/gu;

function rewriteLoose(text, noteRelativePath, index) {
  let next = text.replace(/!\[\[([^\]\n]+)\]\]/gu, (full, inner) => {
    const parsed = parseWikilinkInner(inner);
    if (!parsed) return full;
    const resolved = resolveEmbedTarget(parsed.target, index);
    if (!resolved) return full;
    const size = parseEmbedSuffix(parsed.suffix);
    const alt = sanitizeMdAlt(size.caption || resolved.split("/").pop() || parsed.target);
    const src = localAssetUrl(resolved);
    const title = `${WIKI_TITLE_PREFIX}${encodeURIComponent(parsed.inner)}`;
    return `![${alt}](${src} "${title}")`;
  });
  next = next.replace(MD_IMG_RE, (full, alt, angle, bare, dq, sq) => {
    const raw = angle != null && angle !== "" ? angle : bare;
    if (raw == null) return full;
    const url = String(raw).trim();
    const title = dq || sq || "";
    if (/^https?:\/\//iu.test(url)) {
      const proxied = `topmind-asset://remote/${encodeURIComponent(url)}`;
      return title && !title.startsWith(WIKI_TITLE_PREFIX)
        ? `![${alt}](${proxied} "${title.replace(/"/gu, "")}")`
        : `![${alt}](${proxied})`;
    }
    if (isRemoteOrSpecial(url) || hasScheme(url)) return full;
    const abs = resolveNoteRelativeMedia(noteRelativePath, url);
    if (!abs || !isWorkspaceImageName(abs)) return full;
    const src = localAssetUrl(abs);
    if (title && !title.startsWith(WIKI_TITLE_PREFIX)) {
      return `![${alt}](${src} "${title.replace(/"/gu, "")}")`;
    }
    return `![${alt}](${src})`;
  });
  next = next.replace(/<img\b[^>]*>/giu, (tag) =>
    tag.replace(/\bsrc\s*=\s*(["'])([^"']*)\1/iu, (full, q, url) => {
      const u = String(url || "").trim();
      if (/^(data:|topmind-asset:|blob:)/iu.test(u) || u.startsWith("//")) return full;
      if (/^https?:\/\//iu.test(u)) {
        return `src=${q}topmind-asset://remote/${encodeURIComponent(u)}${q}`;
      }
      if (hasScheme(u)) return full;
      const abs = resolveNoteRelativeMedia(noteRelativePath, u);
      if (!abs) return full;
      return `src=${q}${localAssetUrl(abs)}${q}`;
    }),
  );
  return next;
}

/**
 * Disk markdown → editor/preview markdown.
 * Resolved image wikilinks become `![alt](topmind-asset://local/… "tmw:…")`.
 * Unresolved embeds are left as written (filename / caption stay visible, no src).
 */
export function rewriteWorkspaceImageMarkdown(markdown, noteRelativePath, knownPaths) {
  const index = buildImageIndex(knownPaths);
  return mapOutsideFences(String(markdown ?? ""), (chunk) =>
    mapOutsideInlineCode(chunk, (loose) => rewriteLoose(loose, noteRelativePath, index)),
  );
}

export function wikilinkFromTitle(title) {
  const t = String(title || "");
  if (!t.startsWith(WIKI_TITLE_PREFIX)) return null;
  let inner = t.slice(WIKI_TITLE_PREFIX.length);
  try {
    inner = decodeURIComponent(inner);
  } catch {
    return null;
  }
  if (!inner || /[\[\]\n]/u.test(inner)) return null;
  return `![[${inner}]]`;
}

export function embedDisplayFromTitle(title) {
  const link = wikilinkFromTitle(title);
  if (!link) return null;
  const inner = link.slice(3, -2);
  const pipe = inner.indexOf("|");
  const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const suffix = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
  const size = parseEmbedSuffix(suffix);
  const name = target.split("/").pop() || target;
  return {
    alt: size.caption || name,
    width: size.width || 0,
    height: size.height || 0,
  };
}

export function filenameFromAssetUrl(url) {
  const raw = String(url || "").trim();
  const m = raw.match(/^(?:topmind-asset:\/\/local\/)?([^?#]*)/iu);
  const decoded = safeDecodePath(m ? m[1] : raw);
  return decoded.split("/").pop() || decoded;
}

const MD_ASSET_RE = /!\[([^\]]*)\]\(\s*(?:<(topmind-asset:\/\/local\/[^>\n]+)>|(topmind-asset:\/\/local\/[^)\s]+))(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/giu;

function assetPathOf(url) {
  const m = String(url || "").match(/^topmind-asset:\/\/local\/(.+)$/iu);
  if (!m) return "";
  return normalizePosixPath(safeDecodePath(m[1] || ""));
}

function toNoteRelative(abs, dir) {
  if (!abs) return "";
  if (dir && abs.startsWith(`${dir}/`)) return abs.slice(dir.length + 1);
  return abs;
}

/**
 * Editor markdown → disk markdown.
 * `tmw:` titles restore the original wikilink (size / caption kept).
 * Other local asset URLs become note-relative paths. Spaced paths use `<…>`.
 */
export function restoreWorkspaceImageMarkdown(markdown, noteRelativePath) {
  const dir = noteDirOf(noteRelativePath);
  return String(markdown ?? "").replace(MD_ASSET_RE, (full, alt, angleUrl, bareUrl, dq, sq) => {
    const title = dq || sq || "";
    const wiki = wikilinkFromTitle(title);
    if (wiki) return wiki;
    const abs = assetPathOf(angleUrl || bareUrl || "");
    const rel = toNoteRelative(abs, dir);
    if (!rel) return full;
    const target = formatMdTarget(rel);
    if (title) return `![${alt}](${target} "${title.replace(/"/gu, "")}")`;
    return `![${alt}](${target})`;
  });
}

function collectInProse(markdown, visit) {
  mapOutsideFences(String(markdown ?? ""), (chunk) => {
    mapOutsideInlineCode(chunk, (loose) => {
      visit(loose);
      return loose;
    });
    return chunk;
  });
}

/** Image wikilinks outside fenced / inline code. Non-images are omitted. */
export function collectImageEmbeds(markdown) {
  /** @type {Array<{ target: string, suffix: string, inner: string }>} */
  const found = [];
  collectInProse(markdown, (loose) => {
    const re = /!\[\[([^\]\n]+)\]\]/gu;
    let m;
    while ((m = re.exec(loose))) {
      const parsed = parseWikilinkInner(m[1]);
      if (parsed) found.push(parsed);
    }
  });
  return found;
}

/**
 * Local markdown image targets (note-relative, percent-decoded, `./` stripped).
 * Remote / asset / non-image targets are omitted.
 */
export function collectLocalMarkdownImageTargets(markdown) {
  /** @type {string[]} */
  const refs = [];
  const seen = new Set();
  collectInProse(markdown, (loose) => {
    const re = new RegExp(MD_IMG_RE.source, MD_IMG_RE.flags);
    let m;
    while ((m = re.exec(loose))) {
      const raw = m[2] != null && m[2] !== "" ? m[2] : m[3];
      if (!raw) continue;
      const url = String(raw).trim();
      if (isRemoteOrSpecial(url) || hasScheme(url)) continue;
      let cleaned = safeDecodePath(url).replace(/^\.\//u, "").trim();
      if (!cleaned || cleaned.startsWith("/") || cleaned.split("/").includes("..")) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      refs.push(cleaned);
    }
  });
  return refs;
}
