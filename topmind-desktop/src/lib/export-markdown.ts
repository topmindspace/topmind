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
    color: #262626;
    background: #f7f7f7;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e5e5; background: #171717; }
    pre, code { background: #262626; }
    a { color: #7dd3fc; }
  }
  h1,h2,h3 { line-height: 1.3; margin-top: 1.4em; }
  pre {
    overflow: auto;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    background: #ebebeb;
    font-size: 0.9em;
  }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  :not(pre) > code { padding: 0.1em 0.35em; border-radius: 4px; background: #ebebeb; }
  blockquote {
    margin: 1em 0;
    padding-left: 1em;
    border-left: 3px solid rgba(2, 132, 199, 0.5);
    color: #525252;
  }
  @media (prefers-color-scheme: dark) {
    blockquote { border-left-color: rgba(56, 189, 248, 0.5); color: #c9c9c9; }
    pre { background: #212121; }
    :not(pre) > code { background: #212121; }
  }
  a { color: #0284c7; }
  .meta { font-size: 0.85rem; color: #6f6f6f; }
  @media (prefers-color-scheme: dark) { .meta { color: #8c8c8c; } }
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
  /** Nested list stack — first-level + indented children. */
  const listStack: Array<{ indent: number; kind: "ul" | "ol" | "task"; openLi: boolean }> = [];
  let para: string[] = [];
  let bqBuf: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    // Join multi-line paragraphs with <br> to preserve line breaks.
    // Each line is individually formatted (links, bold, etc.) and trailing
    // backslash (markdown hard break) is stripped.
    const formatted = para.map((l) => {
      const cleaned = l.replace(/\\$/u, "").trimEnd();
      return inlineFormat(cleaned);
    });
    const text = formatted.join("<br />");
    if (text) out.push(`<p>${text}</p>`);
    para = [];
  };
  const closeOpenLi = () => {
    const cur = listStack[listStack.length - 1];
    if (cur?.openLi) {
      const lastIdx = out.length - 1;
      const last = lastIdx >= 0 ? out[lastIdx] : "";
      if (last.startsWith("<li") && !last.includes("</li>")) {
        out[lastIdx] = `${last}</li>`;
      } else {
        out.push("</li>");
      }
      cur.openLi = false;
    }
  };
  const flushList = () => {
    while (listStack.length) {
      closeOpenLi();
      const closed = listStack.pop();
      if (!closed) break;
      out.push(closed.kind === "ol" ? "</ol>" : "</ul>");
    }
  };
  const parseListLine = (raw: string) => {
    const task = raw.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/u);
    if (task) {
      return {
        indent: task[1].replace(/\t/gu, "  ").length,
        kind: "task" as const,
        text: task[4],
        checked: /x/i.test(task[3]),
      };
    }
    const ul = raw.match(/^(\s*)([-*+])\s+(.*)$/u);
    if (ul) {
      return {
        indent: ul[1].replace(/\t/gu, "  ").length,
        kind: "ul" as const,
        text: ul[3],
        checked: false,
      };
    }
    const ol = raw.match(/^(\s*)(\d+)\.\s+(.*)$/u);
    if (ol) {
      return {
        indent: ol[1].replace(/\t/gu, "  ").length,
        kind: "ol" as const,
        text: ol[3],
        checked: false,
      };
    }
    return null;
  };
  const pushListItem = (item: { indent: number; kind: "ul" | "ol" | "task"; text: string; checked: boolean }) => {
    while (listStack.length && listStack[listStack.length - 1].indent > item.indent) {
      closeOpenLi();
      const closed = listStack.pop();
      if (closed) out.push(closed.kind === "ol" ? "</ol>" : "</ul>");
    }
    const top = listStack[listStack.length - 1];
    if (!top || top.indent < item.indent) {
      const tag = item.kind === "ol" ? "ol" : "ul";
      const cls = item.kind === "task" ? ' class="task-list"' : "";
      out.push(`<${tag}${cls}>`);
      listStack.push({ indent: item.indent, kind: item.kind, openLi: false });
    } else if (top.indent === item.indent) {
      closeOpenLi();
      if (top.kind !== item.kind) {
        out.push(top.kind === "ol" ? "</ol>" : "</ul>");
        listStack.pop();
        const tag = item.kind === "ol" ? "ol" : "ul";
        const cls = item.kind === "task" ? ' class="task-list"' : "";
        out.push(`<${tag}${cls}>`);
        listStack.push({ indent: item.indent, kind: item.kind, openLi: false });
      }
    }
    const cur = listStack[listStack.length - 1];
    if (item.kind === "task") {
      out.push(
        `<li class="task-list-item" data-checked="${item.checked ? "true" : "false"}">` +
          `<input type="checkbox" disabled${item.checked ? " checked" : ""} /> ` +
          `<span>${inlineFormat(item.text)}</span>`,
      );
    } else {
      out.push(`<li>${inlineFormat(item.text)}`);
    }
    if (cur) cur.openLi = true;
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
      // Look ahead: if the next non-blank line is a list item, keep the list
      // open (user intentionally spaced items). Just flush para/bq.
      if (listStack.length) {
        let j = i + 1;
        while (j < lines.length && /^\s*$/u.test(lines[j])) j++;
        if (j < lines.length && parseListLine(lines[j])) {
          flushPara();
          flushBq();
          i += 1;
          continue;
        }
      }
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

    const listItem = parseListLine(line);
    if (listItem) {
      flushPara();
      flushBq();
      pushListItem(listItem);
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
