/**
 * Lightweight HTML → Markdown converter (zero dependencies).
 *
 * Designed for the URL capture use case: takes raw HTML, extracts the main
 * content, and converts it to clean Markdown suitable for storage in .md files.
 *
 * Not a full browser-grade converter — handles the common semantic elements
 * (headings, bold, italic, links, images, lists, code, blockquotes, tables)
 * and degrades gracefully on anything else (strips tags, keeps text).
 *
 * Processing order matters:
 *  1. Extract metadata (og: tags, meta description, author)
 *  2. Isolate main content (article/main/[role=main] → body fallback)
 *  3. Remove non-content blocks (script, style, nav, etc.)
 *  4. Protect <pre> blocks (so their content isn't mangled by inline rules)
 *  5. Convert block-level elements (headings, lists, blockquotes, paragraphs)
 *  6. Convert inline elements (bold, italic, links, code)
 *  7. Restore <pre> blocks as fenced code
 *  8. Decode HTML entities + collapse whitespace
 */

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  hellip: "…", mdash: "—", ndash: "–", ldquo: "\u201C", rdquo: "\u201D",
  lsquo: "\u2018", rsquo: "\u2019", middot: "·", bull: "•",
  copy: "\u00A9", reg: "\u00AE", trade: "\u2122", deg: "°",
  times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", sub2: "₂", sub3: "₃",
};

/** Decode a numeric codepoint, keeping the original text when invalid. */
function safeFromCodePoint(code, orig) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return orig;
  // Reject surrogate halves — String.fromCodePoint would throw on them.
  if (code >= 0xd800 && code <= 0xdfff) return orig;
  try {
    return String.fromCodePoint(code);
  } catch {
    return orig;
  }
}

/**
 * Decode HTML entities in a single pass so that already-escaped input like
 * `&amp;#65;` is decoded exactly once (to the literal text `&#65;`, not `A`).
 */
function decodeEntities(str) {
  return String(str).replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/gu, (m, body) => {
    if (body[0] === "#") {
      if (body[1] === "x" || body[1] === "X") return safeFromCodePoint(parseInt(body.slice(2), 16), m);
      return safeFromCodePoint(parseInt(body.slice(1), 10), m);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Extract metadata from <meta> tags in the HTML head. */
export function extractMeta(html) {
  const meta = {};
  // og:title, og:description, og:image, og:site_name
  const ogPattern = /<meta\s+(?:property|name)=["']og:([a-z_]+)["']\s+content=["']([^"']*)["']/giu;
  let m;
  while ((m = ogPattern.exec(html))) {
    const key = m[1].replace(/_/gu, "");
    meta[`og_${key}`] = decodeEntities(m[2].trim());
  }
  // Standard meta tags: description, author
  const stdPattern = /<meta\s+name=["'](description|author|keywords)["']\s+content=["']([^"']*)["']/giu;
  while ((m = stdPattern.exec(html))) {
    meta[m[1]] = decodeEntities(m[2].trim());
  }
  // <title>
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/iu);
  if (titleMatch) meta.title = decodeEntities(titleMatch[1].trim());
  // <link rel="canonical">
  const canonMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/iu);
  if (canonMatch) meta.canonical = canonMatch[1].trim();
  return meta;
}

/** Isolate the main content area from a full HTML document. */
function isolateMainContent(html) {
  // Prefer <article>, <main>, [role=main]
  const mainMatch = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/iu);
  if (mainMatch) return mainMatch[1];
  // Common content containers
  const idMatch = html.match(
    /<div\b[^>]*(?:id|class)=["'][^"']*(?:article|post-content|entry-content|post-body|article-body|content-body|main-content|markdown-body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu,
  );
  if (idMatch && idMatch[1].length > 200) return idMatch[1];
  // Fallback: <body>
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu);
  return bodyMatch ? bodyMatch[1] : html;
}

/** Remove non-content blocks that would pollute the Markdown output. */
function stripNonContent(html) {
  return html
    // Script/style/svg/noscript/template blocks
    .replace(/<(script|style|svg|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    // Nav/footer/header/aside/form blocks
    .replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    // Common chrome / ads / social / cookie / engagement shells (EN + CN)
    .replace(
      /<(?:div|section|ul|aside|span)\b[^>]*(?:class|id)=["'][^"']*(?:cookie|consent|newsletter|subscribe|share-bar|share-box|social|related|recommend|sidebar|comment|advert|adsbygoogle|promo|banner|popup|modal|toolbar|breadcrumb|pagination|tag-list|meta-bar|qrcode|qr_code|reward|donate|copyright|footer-links|hot-list|guess-like|more-posts|rich_media_area_extra|profile_inner|weui|js_sponsor|js_tags|reward_area|qr_code_pc|aside-box|Post-Side|ContentItem-actions|ColumnPageHeader|TopstoryItem|OpenInApp|open-app|download-app|app-download|login-guide|follow-bar|like-box|vote-box)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|ul|aside|span)>/giu,
      "",
    )
    // Button-only chrome
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/giu, "")
    // HTML comments
    .replace(/<!--[\s\S]*?-->/gu, "")
    // Hidden elements
    .replace(/<[^>]+\b(?:hidden|aria-hidden=["']true["']|style="[^"]*display:\s*none[^"]*")\b[^>]*>[\s\S]*?<\/[^>]+>/giu, "")
    // iframe, video, audio, canvas (media we can't convert as embed)
    .replace(/<(iframe|video|audio|canvas|object|embed)\b[^>]*>[\s\S]*?<\/\1>/giu, "")
    .replace(/<(iframe|video|audio|canvas|object|embed)\b[^>]*\/>/giu, "");
}

/** Protect <pre> blocks by replacing them with placeholders. Returns the
 *  cleaned HTML and an array of extracted code blocks (optional lang). */
function protectPreBlocks(html) {
  const blocks = [];
  const protected_ = html.replace(
    /<pre\b([^>]*)>([\s\S]*?)<\/pre>/giu,
    (match, attrs, content) => {
      let lang = "";
      const cls = String(attrs || "").match(/class=["']([^"']*)["']/iu);
      if (cls) {
        const m = cls[1].match(/(?:language|lang|highlight)-([a-z0-9_+-]+)/iu)
          || cls[1].match(/\b(js|ts|tsx|jsx|py|python|bash|sh|json|yaml|yml|go|rust|java|c|cpp|html|css|sql|md|markdown)\b/iu);
        if (m) lang = m[1] === "py" ? "python" : m[1];
      }
      const codeMatch = content.match(/<code\b([^>]*)>/iu);
      if (!lang && codeMatch) {
        const ccls = codeMatch[1].match(/class=["']([^"']*)["']/iu);
        if (ccls) {
          const m = ccls[1].match(/(?:language|lang)-([a-z0-9_+-]+)/iu);
          if (m) lang = m[1];
        }
      }
      const text = content.replace(/<[^>]+>/gu, "");
      const idx = blocks.length;
      blocks.push({ text: decodeEntities(text).replace(/^\n+|\n+$/gu, ""), lang });
      return `\x00PRE${idx}\x00`;
    },
  );
  return { html: protected_, blocks };
}

/** Split list inner HTML into <li> items using depth counting, so that a
 *  nested <li>…</li> pair does not truncate its enclosing item. */
function splitListItems(content) {
  const items = [];
  const re = /<li\b[^>]*>|<\/li>/giu;
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(content))) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        if (start >= 0) items.push(content.slice(start, m.index));
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index + m[0].length;
      depth += 1;
    }
  }
  if (depth > 0 && start >= 0) items.push(content.slice(start));
  return items;
}

/** Extract top-level (depth-1) nested <ul>/<ol> blocks from an <li> body.
 *  Returns the blocks plus the remaining markup with them removed. */
function extractNestedLists(liHtml) {
  const nested = [];
  const rest = [];
  const re = /<(ul|ol)\b[^>]*>|<\/(?:ul|ol)>/giu;
  let depth = 0;
  let cursor = 0;
  let start = 0;
  let m;
  while ((m = re.exec(liHtml))) {
    if (m[1]) {
      if (depth === 0) start = m.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        nested.push(liHtml.slice(start, m.index + m[0].length));
        rest.push(liHtml.slice(cursor, start));
        cursor = m.index + m[0].length;
      }
    }
  }
  rest.push(liHtml.slice(cursor));
  return { nested, rest: rest.join("\n") };
}

/** Render one complete <ul>/<ol>…</ol> block (including its tags) to Markdown. */
function renderListTag(full) {
  const openM = full.match(/^<(ul|ol)\b([^>]*)>/iu);
  if (!openM) return full;
  const ordered = openM[1].toLowerCase() === "ol";
  const startM = openM[2].match(/\bstart=["'](\d+)["']/iu);
  const start = startM ? parseInt(startM[1], 10) : 1;
  const inner = full
    .slice(openM[0].length)
    .replace(/<\/(?:ul|ol)>\s*$/u, "");
  const items = splitListItems(inner);
  const lines = [];
  let n = start;
  for (const li of items) {
    const { nested, rest } = extractNestedLists(li);
    const text = convertInline(rest).trim();
    lines.push(ordered ? `${n}. ${text}` : `- ${text}`);
    for (const block of nested) {
      const sub = renderListTag(block);
      for (const line of sub.split("\n")) {
        if (line.trim()) lines.push(`    ${line}`);
      }
    }
    if (ordered) n += 1;
  }
  return lines.join("\n");
}

/** Convert every <ul>/<ol> block (outermost first, depth-matched) to Markdown. */
function convertLists(html) {
  let out = html;
  for (;;) {
    const openM = out.match(/<(ul|ol)\b[^>]*>/iu);
    if (!openM) return out;
    const startIdx = openM.index;
    const scanRe = /<(ul|ol)\b[^>]*>|<\/(?:ul|ol)>/giu;
    scanRe.lastIndex = startIdx + openM[0].length;
    let depth = 1;
    let endIdx = -1;
    let sm;
    while ((sm = scanRe.exec(out))) {
      if (sm[1]) {
        depth += 1;
      } else {
        depth -= 1;
        if (depth === 0) {
          endIdx = sm.index + sm[0].length;
          break;
        }
      }
    }
    if (endIdx < 0) {
      // Unmatched open tag: strip it so the loop always makes progress.
      out = out.slice(0, startIdx) + out.slice(startIdx + openM[0].length);
      continue;
    }
    const rendered = renderListTag(out.slice(startIdx, endIdx));
    out = `${out.slice(0, startIdx)}${rendered}\n${out.slice(endIdx)}`;
  }
}

/** Convert block-level HTML elements to Markdown. */
function convertBlocks(html) {
  let out = html;

  // Headings: h1→#, h2→##, etc.
  for (let i = 6; i >= 1; i--) {
    const re = new RegExp(`<h${i}\\b[^>]*>([\\s\\S]*?)</h${i}>`, "giu");
    out = out.replace(re, (_, content) => {
      const text = stripInlineTags(content).trim();
      return text ? `\n\n${"#".repeat(i)} ${text}\n` : "";
    });
  }

  // Horizontal rule
  out = out.replace(/<hr\s*\/?>/giu, "\n\n---\n");

  // Figure + figcaption
  out = out.replace(/<figure\b[^>]*>([\s\S]*?)<\/figure>/giu, (_, content) => {
    const cap = content.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/iu);
    const body = content.replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/giu, "");
    const inner = convertInline(body).trim();
    const caption = cap ? convertInline(cap[1]).trim() : "";
    if (!inner && !caption) return "";
    if (caption) return `\n\n${inner}\n*${caption}*\n`;
    return `\n\n${inner}\n`;
  });

  // Blockquotes
  out = out.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/giu, (_, content) => {
    const text = convertInline(content).trim();
    return `\n${text.split("\n").map((l) => `> ${l}`).join("\n")}\n`;
  });

  // Lists (nested-aware): ul/ol rendered via depth-counting scanner so that
  // inner lists are converted recursively with 4-space indented sub-lists and
  // <ol start="N"> keeps its starting number.
  out = convertLists(out);

  // Tables (simple conversion)
  out = out.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/giu, (_, content) => {
    const rows = content.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/giu) || [];
    if (rows.length === 0) return "";
    const parsed = rows.map((tr) => {
      const cells = tr.match(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/giu) || [];
      return cells.map((c) => {
        // Escape pipes, turn <br>/newlines into spaces so the row stays one table line.
        return convertInline(
          c
            .replace(/<t[hd]\b[^>]*>|<\/t[hd]>/gu, "")
            .replace(/<br\s*\/?>/giu, " "),
        )
          .trim()
          .replace(/\|/gu, "\\|")
          .replace(/\r?\n/gu, " ");
      });
    });
    const header = parsed[0];
    const separator = header.map(() => "---");
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...parsed.slice(1).map((r) => `| ${r.join(" | ")} |`),
    ];
    return `\n${lines.join("\n")}\n`;
  });

  // Paragraphs and divs → newlines
  out = out.replace(/<p\b[^>]*>/giu, "\n\n");
  out = out.replace(/<\/p>/giu, "\n");
  out = out.replace(/<div\b[^>]*>/giu, "\n");
  out = out.replace(/<\/div>/giu, "\n");

  // <br> → newline
  out = out.replace(/<br\s*\/?>/giu, "\n");

  return out;
}

/** Strip all HTML tags (for content that shouldn't have any formatting). */
function stripInlineTags(html) {
  return html.replace(/<[^>]+>/gu, "");
}

/** Convert inline HTML elements to Markdown. */
function convertInline(html) {
  let out = html;

  // Inline code (do first so its content isn't mangled)
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/giu, (_match, content) => {
    const text = decodeEntities(stripInlineTags(content)).trim();
    if (!text) return "";
    // Use double backticks if the text contains a backtick
    if (text.includes("`")) return "`` " + text + " ``";
    return "`" + text + "`";
  });

  // Bold
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/giu, (_, _tag, content) => {
    const text = content.trim();
    return text ? `**${text}**` : "";
  });

  // Italic
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/giu, (_, _tag, content) => {
    const text = content.trim();
    return text ? `*${text}*` : "";
  });

  // Strikethrough
  out = out.replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/giu, (_, _tag, content) => {
    const text = content.trim();
    return text ? `~~${text}~~` : "";
  });

  // Links
  out = out.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu, (_, href, content) => {
    const text = convertInline(content).trim();
    const url = href.trim();
    if (!url || url.startsWith("javascript:")) return text;
    return text ? `[${text}](${url})` : "";
  });

  // <picture> — pick best source srcset or nested img
  out = out.replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/giu, (block) => {
    let src = "";
    for (const sm of block.matchAll(/<source\b[^>]*>/giu)) {
      const ss = sm[0].match(/\bsrcset=["']([^"']+)["']/iu);
      if (ss) {
        const cand = pickFromSrcset(ss[1]);
        if (cand) src = cand;
      }
    }
    const img = block.match(/<img\b[^>]*>/iu);
    if (img) {
      src = pickImgSrc(img[0]) || src;
    }
    if (!src) return "";
    const altM = img ? img[0].match(/\balt=["']([^"']*)["']/iu) : null;
    const alt = altM ? altM[1] : "";
    return `\n![${alt}](${src.trim()})\n`;
  });

  // Images — prefer real src over lazy placeholders; resolve later via baseUrl
  out = out.replace(/<img\b[^>]*>/giu, (tag) => {
    const src = pickImgSrc(tag);
    if (!src) return "";
    const altM = tag.match(/\balt=["']([^"']*)["']/iu);
    const alt = altM ? altM[1] : "";
    return `\n![${alt}](${src.trim()})\n`;
  });

  // <span> — just keep content
  out = out.replace(/<\/?span\b[^>]*>/giu, "");

  // Remove any remaining tags
  out = out.replace(/<[^>]+>/gu, "");

  return out;
}

/** Restore protected <pre> blocks as fenced code. */
function restorePreBlocks(html, blocks) {
  return html.replace(/\x00PRE(\d+)\x00/gu, (_, idx) => {
    const b = blocks[Number(idx)];
    if (!b) return "\n```\n\n```\n";
    if (typeof b === "string") return `\n\`\`\`\n${b}\n\`\`\`\n`;
    const lang = b.lang || "";
    return `\n\`\`\`${lang}\n${b.text || ""}\n\`\`\`\n`;
  });
}

/** Final cleanup: decode entities, collapse whitespace, trim. */
function cleanup(text, maxLen = 30_000) {
  let out = decodeEntities(text);
  // Collapse runs of spaces/tabs, but keep leading indentation (nested list
  // sub-items rely on their 4-space indent to stay Markdown sub-lists).
  out = out.replace(/(?<=\S)[ \t]+/gu, " ");
  // Limit consecutive newlines to 2
  out = out.replace(/\n{3,}/gu, "\n\n");
  // Trim trailing whitespace per line (leading indent must survive)
  out = out.split("\n").map((l) => l.replace(/[ \t]+$/u, "")).join("\n");
  out = out.replace(/^\s+|\s+$/u, "");
  // Truncation marker shared with the clip/fetch pipelines (`isTruncationMarker`).
  // Total output stays within maxLen so downstream re-truncation (applyMaxLen /
  // clip-payload) never slices into an already-appended marker.
  if (out.length > maxLen) {
    const mark = "\n\n...(内容已截断)";
    out = `${out.slice(0, Math.max(0, maxLen - mark.length))}${mark}`;
  }
  return out;
}

/**
 * Pick best image URL from an <img> tag (lazy-load attrs + srcset).
 * @param {string} tag
 * @returns {string}
 */
export function pickImgSrc(tag) {
  const t = String(tag || "");
  const prefer = [
    "data-actualsrc",
    "data-original",
    "data-lazy-src",
    "data-src",
    "data-url",
    "data-original-src",
    "src",
  ];
  for (const attr of prefer) {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, "iu");
    const m = t.match(re);
    if (!m) continue;
    const v = m[1].trim();
    if (!v || v.startsWith("data:") || v === "about:blank") continue;
    if (/spacer|pixel|blank\.|1x1|transparent\.gif/iu.test(v)) continue;
    return v;
  }
  const ss = t.match(/\bsrcset=["']([^"']+)["']/iu);
  if (ss) {
    const best = pickFromSrcset(ss[1]);
    if (best) return best;
  }
  const dss = t.match(/\bdata-srcset=["']([^"']+)["']/iu);
  if (dss) {
    const best = pickFromSrcset(dss[1]);
    if (best) return best;
  }
  return "";
}

/**
 * @param {string} srcset
 * @returns {string}
 */
function pickFromSrcset(srcset) {
  let bestUrl = "";
  let bestScore = -1;
  for (const part of String(srcset).split(",")) {
    const bits = part.trim().split(/\s+/u);
    if (!bits[0]) continue;
    let score = 0;
    const desc = bits[1] || "";
    if (desc.endsWith("w")) score = parseInt(desc, 10) || 0;
    else if (desc.endsWith("x")) score = (parseFloat(desc) || 1) * 1000;
    else score = 1;
    if (score >= bestScore) {
      bestScore = score;
      bestUrl = bits[0];
    }
  }
  return bestUrl;
}

/**
 * Resolve relative / protocol-relative image URLs in markdown against page URL.
 * @param {string} markdown
 * @param {string} [baseUrl]
 */
export function resolveMarkdownMediaUrls(markdown, baseUrl) {
  if (!baseUrl || !markdown) return markdown;
  return String(markdown).replace(
    /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/giu,
    (full, alt, rawUrl) => {
      const abs = absolutizeUrl(rawUrl, baseUrl);
      if (!abs || abs === rawUrl) return full;
      return `![${alt}](${abs})`;
    },
  );
}

/**
 * @param {string} href
 * @param {string} baseUrl
 * @returns {string | null}
 */
function absolutizeUrl(href, baseUrl) {
  let h = String(href || "").trim().replace(/^<|>$/gu, "");
  if (!h || h.startsWith("data:") || h.startsWith("blob:")) return null;
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

/**
 * Convert HTML to Markdown.
 * @param {string} html - Raw HTML string
 * @param {object} [opts]
 * @param {number} [opts.maxLen=30000] - Maximum output length in characters
 * @param {boolean} [opts.alreadyIsolated] - skip main-content isolation
 * @param {string} [opts.baseUrl] - page URL for resolving relative image paths
 * @param {string} [opts.url] - alias of baseUrl
 * @returns {string} Markdown text
 */
export function htmlToMarkdown(html, opts = {}) {
  const maxLen = opts.maxLen ?? 30_000;
  const baseUrl = opts.baseUrl || opts.url || "";
  // alreadyIsolated: Readability already returned article HTML fragment
  const content = opts.alreadyIsolated ? String(html || "") : isolateMainContent(html);
  const cleaned = stripNonContent(content);
  const { html: protected_, blocks } = protectPreBlocks(cleaned);
  const withBlocks = convertBlocks(protected_);
  const withInline = convertInline(withBlocks);
  const restored = restorePreBlocks(withInline, blocks);
  let md = cleanup(restored, maxLen);
  if (baseUrl) md = resolveMarkdownMediaUrls(md, baseUrl);
  return md;
}
