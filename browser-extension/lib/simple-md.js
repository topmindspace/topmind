/**
 * HTML → Markdown for workspace-local clip (no Desktop).
 * Prefer Desktop Bridge when available — this is the degradation path.
 * Improved structure: headings, lists, code, links, images, tables (simple).
 */

/**
 * @param {string} html
 * @param {number | { maxLen?: number, baseUrl?: string }} [maxLenOrOpts]
 */
export function htmlToMarkdownLite(html, maxLenOrOpts = 200_000) {
  const opts =
    typeof maxLenOrOpts === "object" && maxLenOrOpts
      ? maxLenOrOpts
      : { maxLen: maxLenOrOpts };
  const maxLen = opts.maxLen ?? 200_000;
  const baseUrl = opts.baseUrl || "";
  let s = String(html || "");
  if (!s.trim()) return "";

  // Strip non-content
  s = s
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(
      /<(?:div|section|ul)\b[^>]*(?:class|id)=["'][^"']*(?:cookie|consent|share|social|related|recommend|sidebar|comment|advert|promo|banner|popup|modal|OpenInApp|reward|qrcode)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|ul)>/giu,
      "",
    );

  // Pre/code → fenced
  const codeBlocks = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu, (_, content) => {
    const text = decodeEntities(content.replace(/<[^>]+>/gu, "")).replace(/^\n+|\n+$/gu, "");
    const i = codeBlocks.length;
    codeBlocks.push(text);
    return `\n\n\`\`\`\n\x00CODE${i}\x00\n\`\`\`\n\n`;
  });

  s = s.replace(/<\/?(h1)[^>]*>/giu, "\n# ");
  s = s.replace(/<\/?(h2)[^>]*>/giu, "\n## ");
  s = s.replace(/<\/?(h3)[^>]*>/giu, "\n### ");
  s = s.replace(/<\/?(h4)[^>]*>/giu, "\n#### ");
  s = s.replace(/<\/?(h5)[^>]*>/giu, "\n##### ");
  s = s.replace(/<\/?(h6)[^>]*>/giu, "\n###### ");
  s = s.replace(/<br\s*\/?>/giu, "\n");
  s = s.replace(/<hr\s*\/?>/giu, "\n\n---\n\n");
  s = s.replace(/<\/p>/giu, "\n\n");
  s = s.replace(/<li[^>]*>/giu, "\n- ");
  s = s.replace(/<\/(div|tr|li)>/giu, "\n");
  s = s.replace(/<blockquote\b[^>]*>/giu, "\n> ");
  s = s.replace(/<\/blockquote>/giu, "\n");
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/giu, "**$2**");
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/giu, "*$2*");
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, "`$1`");
  s = s.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu, "[$2]($1)");
  s = s.replace(/<img\b[^>]*>/giu, (tag) => {
    let src = pickImgSrcLite(tag);
    if (!src) return "";
    if (baseUrl) src = absolutizeLite(src, baseUrl) || src;
    const altM = tag.match(/\balt=["']([^"']*)["']/iu);
    return `\n![${altM ? altM[1] : ""}](${src})\n`;
  });
  s = s.replace(/<[^>]+>/gu, "");
  s = decodeEntities(s);
  s = s.replace(/\x00CODE(\d+)\x00/gu, (_, i) => codeBlocks[Number(i)] || "");
  s = s
    .replace(/\r\n/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`;
  return s;
}

function absolutizeLite(href, baseUrl) {
  let h = String(href || "").trim();
  if (!h || h.startsWith("data:")) return null;
  if (/^https?:\/\//iu.test(h)) return h;
  if (h.startsWith("//")) {
    try {
      return `${new URL(baseUrl).protocol}${h}`;
    } catch {
      return `https:${h}`;
    }
  }
  try {
    return new URL(h, baseUrl).href;
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/giu, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Lazy-load + srcset aware image URL picker (mirrors Desktop pickImgSrc). */
function pickImgSrcLite(tag) {
  const t = String(tag || "");
  for (const attr of [
    "data-actualsrc",
    "data-original",
    "data-lazy-src",
    "data-src",
    "data-url",
    "src",
  ]) {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, "iu");
    const m = t.match(re);
    if (!m) continue;
    const v = m[1].trim();
    if (!v || v.startsWith("data:") || /spacer|pixel|1x1|transparent\.gif/iu.test(v)) continue;
    return v;
  }
  const ss = t.match(/\bsrcset=["']([^"']+)["']/iu);
  if (ss) {
    let best = "";
    let score = -1;
    for (const part of ss[1].split(",")) {
      const bits = part.trim().split(/\s+/u);
      if (!bits[0]) continue;
      let sc = 1;
      if ((bits[1] || "").endsWith("w")) sc = parseInt(bits[1], 10) || 0;
      if (sc >= score) {
        score = sc;
        best = bits[0];
      }
    }
    if (best) return best;
  }
  return "";
}

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
