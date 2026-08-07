/**
 * Light Markdown → HTML export for 写出来 delivery shelf.
 * Intentionally minimal (no second MD engine): headings, lists, code, links, paragraphs.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** Strip YAML frontmatter for export body. */
export function stripFrontmatterForExport(raw: string): {
  body: string;
  title: string | null;
  publishedAt: string | null;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!m) return { body: raw, title: null, publishedAt: null };
  const fm = m[1] || "";
  const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/mu);
  const pubMatch = fm.match(/^published_at:\s*["']?(.+?)["']?\s*$/mu);
  return {
    body: raw.slice(m[0].length),
    title: titleMatch?.[1]?.trim() || null,
    publishedAt: pubMatch?.[1]?.trim() || null,
  };
}

/**
 * Convert a Markdown body to a standalone HTML document string.
 */
export function markdownBodyToHtmlDocument(
  body: string,
  opts: { title?: string | null; sourcePath?: string | null } = {},
): string {
  const title = (opts.title && opts.title.trim()) || "topmind export";
  const htmlBody = markdownToHtmlFragment(body);
  const sourceNote = opts.sourcePath
    ? `<p class="meta">Source: <code>${escapeHtml(opts.sourcePath)}</code></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    line-height: 1.7;
    max-width: 42rem;
    margin: 2rem auto;
    padding: 0 1.25rem 3rem;
    color: #2b2b27;
    background: #f7f6f4;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #ecece8; background: #1e1e1c; }
    pre, code { background: #2a2a27; }
    a { color: #7f9fd4; }
  }
  h1,h2,h3 { line-height: 1.3; margin-top: 1.4em; }
  pre {
    overflow: auto;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    background: #f0ede5;
    font-size: 0.9em;
  }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  :not(pre) > code { padding: 0.1em 0.35em; border-radius: 4px; background: #f0ede5; }
  blockquote {
    margin: 1em 0;
    padding-left: 1em;
    border-left: 3px solid rgba(49, 84, 142, 0.5);
    color: #57524a;
  }
  @media (prefers-color-scheme: dark) {
    blockquote { border-left-color: rgba(127, 159, 212, 0.5); color: #d0cabd; }
    pre { background: #2a2a27; }
    :not(pre) > code { background: #2a2a27; }
  }
  a { color: #31548e; }
  .meta { font-size: 0.85rem; color: #7c766b; }
  @media (prefers-color-scheme: dark) { .meta { color: #a49c8c; } }
  ul, ol { padding-left: 1.4em; }
  img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${sourceNote}
${htmlBody}
</body>
</html>
`;
}

/** Convert markdown body to HTML fragment (no document chrome). */
export function markdownToHtmlFragment(md: string): string {
  const lines = md.replace(/\r\n/gu, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf: string[] = [];
  /** "ul" | "ol" | "task" */
  let listType: "ul" | "ol" | "task" | null = null;
  let para: string[] = [];
  let bqBuf: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const text = para.join("\n").trim();
    if (text) out.push(`<p>${inlineFormat(text)}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!listType) return;
    out.push(listType === "task" ? "</ul>" : `</${listType}>`);
    listType = null;
  };
  const flushBq = () => {
    if (bqBuf.length === 0) return;
    const inner = bqBuf.map((l) => inlineFormat(l)).join("<br />");
    out.push(`<blockquote><p>${inner}</p></blockquote>`);
    bqBuf = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/u);
    if (fence) {
      flushPara();
      flushList();
      flushBq();
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || "";
        codeBuf = [];
      } else {
        out.push(
          `<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ""}>${escapeHtml(codeBuf.join("\n"))}</code></pre>`,
        );
        inCode = false;
        codeLang = "";
        codeBuf = [];
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    if (/^\s*$/u.test(line)) {
      flushPara();
      flushList();
      flushBq();
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      flushPara();
      flushList();
      flushBq();
      out.push("<hr />");
      i += 1;
      continue;
    }

    // Headings h1–h4 (stream append uses #### 续 · …)
    const h = line.match(/^(#{1,4})\s+(.+)$/u);
    if (h) {
      flushPara();
      flushList();
      flushBq();
      const level = h[1].length;
      const title = h[2].trim();
      const isAppend = level >= 4 && /^续\s*[·•.]/u.test(title);
      const cls = isAppend ? ' class="stream-append-heading"' : "";
      out.push(`<h${level}${cls}>${inlineFormat(title)}</h${level}>`);
      i += 1;
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/u);
    if (bq) {
      flushPara();
      flushList();
      bqBuf.push(bq[1]);
      i += 1;
      continue;
    }
    if (bqBuf.length) flushBq();

    // Task list: - [ ] / - [x]
    const task = line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/u);
    if (task) {
      flushPara();
      if (listType !== "task") {
        flushList();
        listType = "task";
        out.push('<ul class="task-list">');
      }
      const checked = /x/i.test(task[1]);
      out.push(
        `<li class="task-list-item" data-checked="${checked ? "true" : "false"}">` +
          `<input type="checkbox" disabled${checked ? " checked" : ""} /> ` +
          `<span>${inlineFormat(task[2])}</span></li>`,
      );
      i += 1;
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.+)$/u);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inlineFormat(ul[1])}</li>`);
      i += 1;
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/u);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inlineFormat(ol[1])}</li>`);
      i += 1;
      continue;
    }

    flushList();
    para.push(line);
    i += 1;
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  flushPara();
  flushList();
  flushBq();
  return out.join("\n");
}

/** Named entities commonly used to obfuscate schemes (decode before scheme check). */
const PREVIEW_NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  sol: "/",
  tab: "\t",
  newline: "\n",
  nbsp: " ",
};

/**
 * Decode HTML entities (named + decimal/hex numeric) until stable.
 * Used so &#106;avascript: / javascript&colon; cannot bypass scheme checks.
 */
export function decodeHtmlEntitiesForUrl(raw: string): string {
  let s = String(raw || "");
  for (let pass = 0; pass < 8; pass++) {
    const prev = s;
    s = s
      .replace(/&#x([0-9a-fA-F]{1,6});/gu, (_m, hex) => {
        const cp = Number.parseInt(hex, 16);
        return Number.isFinite(cp) && cp > 0 && cp < 0x110000
          ? String.fromCodePoint(cp)
          : "";
      })
      .replace(/&#([0-9]{1,7});/gu, (_m, dec) => {
        const cp = Number.parseInt(dec, 10);
        return Number.isFinite(cp) && cp > 0 && cp < 0x110000
          ? String.fromCodePoint(cp)
          : "";
      })
      .replace(/&([a-zA-Z][a-zA-Z0-9]{0,31});/gu, (m, name) => {
        const key = String(name).toLowerCase();
        return Object.prototype.hasOwnProperty.call(PREVIEW_NAMED_ENTITIES, key)
          ? PREVIEW_NAMED_ENTITIES[key]!
          : m;
      });
    if (s === prev) break;
  }
  return s;
}

const DANGEROUS_SCHEMES =
  /^(?:javascript|data|vbscript|file|blob|about|chrome|chrome-extension)\s*:/iu;

/**
 * Allow only safe URL schemes for preview href/src.
 * Decodes HTML entities first so &#106;avascript: / javascript&colon; cannot slip through.
 * Allows: http(s), mailto, #fragment, relative / workspace paths.
 */
export function sanitizePreviewUrl(raw: string): string | null {
  if (raw == null || raw === "") return null;
  // Decode entities (incl. after escapeHtml turned & → &amp;)
  let u = decodeHtmlEntitiesForUrl(String(raw).trim());
  // Collapse whitespace / BOM that can sit between scheme letters and colon
  u = u.replace(/[\u0000-\u001f\u007f\u00a0\ufeff]/gu, "");
  u = u.trim();
  if (!u) return null;
  // Attribute breakers after decode
  if (/["'<>\\\s]/.test(u)) return null;
  // Reject any remaining entity-like residue (obfuscation attempt)
  if (/&[#a-zA-Z]/.test(u)) return null;

  const lower = u.toLowerCase();
  if (DANGEROUS_SCHEMES.test(lower)) return null;
  // Also catch scheme with whitespace variants already stripped: "javascript :"
  if (DANGEROUS_SCHEMES.test(lower.replace(/\s+/gu, ""))) return null;

  // Absolute http(s) or mailto only for absolute schemes
  if (/^https?:\/\//iu.test(u) || /^mailto:/iu.test(u)) {
    // Re-escape for attribute embedding (quotes already rejected)
    return u;
  }
  // In-page fragment
  if (u.startsWith("#")) return u;
  // Relative / workspace paths — no scheme colon
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(u)) return u;
  return null;
}

function inlineFormat(text: string): string {
  let s = escapeHtml(text);
  // images ![alt](url) — only safe schemes
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, (_m, alt, url) => {
    const safe = sanitizePreviewUrl(url);
    if (!safe) return escapeHtml(String(alt || ""));
    return `<img src="${safe}" alt="${alt}" loading="lazy" />`;
  });
  // links [text](url) — only safe schemes; unsafe → plain text
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_m, label, url) => {
    const safe = sanitizePreviewUrl(url);
    if (!safe) return label;
    return `<a href="${safe}" rel="noopener noreferrer">${label}</a>`;
  });
  // autolink bare https URLs only (already scheme-safe)
  s = s.replace(
    /(?<!["'=])(https?:\/\/[^\s<]+)/gu,
    '<a href="$1" rel="noopener noreferrer">$1</a>',
  );
  // bold **x** or __x__
  s = s.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/gu, "<strong>$1</strong>");
  // italic *x* or _x_
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, "<em>$1</em>");
  s = s.replace(/(?<!_)_([^_]+)_(?!_)/gu, "<em>$1</em>");
  // strikethrough ~~x~~
  s = s.replace(/~~([^~]+)~~/gu, "<del>$1</del>");
  // inline code
  s = s.replace(/`([^`]+)`/gu, "<code>$1</code>");
  return s;
}

/** Suggest export basename from a workspace-relative path. */
export function exportBasenameFromPath(relativePath: string, ext: "html" | "md"): string {
  const base = relativePath.split("/").pop() || "export.md";
  const stem = base.replace(/\.md$/iu, "") || "export";
  return `${stem}.${ext}`;
}
