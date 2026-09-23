/**
 * Markdown → 公众号约束 HTML 子集（预览 / 粘贴）。
 *
 * 约束与 `skills/topmind-wechat/references/wechat-constraints.md` 同源：
 * 只输出内联 style；不用 h1/pre/figure；容器 note/tip/warn/pull/stat。
 * 完整语义以 `skills/topmind-wechat/scripts/md2wechat.py` 为准，这里只做预览级子集。
 * 不要改 `lib/export-markdown.ts` 的交付导出语义——两边约束不同。
 */

export type WechatThemeId = "minimal-ink" | "tech-blue" | "newsprint" | "graphite";

export interface WechatTheme {
  id: WechatThemeId;
  /** 纸面底色（预览容器） */
  paper: string;
  ink: string;
  secondary: string;
  accent: string;
  muted: string;
  tip: string;
  warn: string;
  danger: string;
  pull: string;
  stat: string;
  fontFamily: string;
}

export const WECHAT_THEMES: Record<WechatThemeId, WechatTheme> = {
  "minimal-ink": {
    id: "minimal-ink",
    paper: "#F7F4EF",
    ink: "#1C1B19",
    secondary: "#6B6560",
    accent: "#A6524A",
    muted: "#8A847C",
    tip: "#3D6B4F",
    warn: "#A67C3A",
    danger: "#A6524A",
    pull: "#A6524A",
    stat: "#1C1B19",
    fontFamily: '-apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  "tech-blue": {
    id: "tech-blue",
    paper: "#F4F7FB",
    ink: "#0F172A",
    secondary: "#475569",
    accent: "#0369A1",
    muted: "#64748B",
    tip: "#0F766E",
    warn: "#B45309",
    danger: "#B91C1C",
    pull: "#0369A1",
    stat: "#0F172A",
    fontFamily: '-apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  newsprint: {
    id: "newsprint",
    paper: "#FBF8F1",
    ink: "#1A1A1A",
    secondary: "#5C564C",
    accent: "#8B4513",
    muted: "#7A7266",
    tip: "#2F5D3A",
    warn: "#9A6B1F",
    danger: "#8B2E2E",
    pull: "#8B4513",
    stat: "#1A1A1A",
    fontFamily: 'Georgia, "Songti SC", "Noto Serif SC", serif',
  },
  graphite: {
    id: "graphite",
    paper: "#F2F2F2",
    ink: "#111111",
    secondary: "#555555",
    accent: "#333333",
    muted: "#777777",
    tip: "#2F6B4F",
    warn: "#8A6D1F",
    danger: "#8B2E2E",
    pull: "#111111",
    stat: "#111111",
    fontFamily: '-apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
  },
};

export const WECHAT_THEME_IDS = Object.keys(WECHAT_THEMES) as WechatThemeId[];

export function resolveWechatTheme(id?: string | null): WechatTheme {
  if (id && id in WECHAT_THEMES) return WECHAT_THEMES[id as WechatThemeId];
  return WECHAT_THEMES["minimal-ink"];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 剥 YAML frontmatter（与 export-markdown 同口径，但本模块不共享其 HTML 语义）。 */
export function stripWechatFrontmatter(raw: string): { frontmatter: string; body: string } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        return {
          frontmatter: lines.slice(0, i + 1).join("\n"),
          body: lines.slice(i + 1).join("\n").replace(/^\n+/, ""),
        };
      }
    }
  }
  return { frontmatter: "", body: raw };
}

/** 从 frontmatter 抽简单 key: value。 */
export function parseWechatFrontmatter(raw: string): Record<string, string> {
  const { frontmatter } = stripWechatFrontmatter(raw);
  const out: Record<string, string> = {};
  if (!frontmatter) return out;
  for (const line of frontmatter.split("\n")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

/** 行内：加粗 / 斜体 / 行内码 / 高亮 / 徽章 / 链接降级为灰色 URL 文本。 */
function inlineFormat(text: string, theme: WechatTheme): string {
  let s = escapeHtml(text);

  // 行内码
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:${theme.paper};color:${theme.ink};padding:1px 4px;border-radius:3px;">${code}</code>`;
  });

  // ==高亮==
  s = s.replace(/==([^=]+)==/g, (_m, t: string) => {
    return `<span style="background:rgba(166,82,74,0.12);color:${theme.ink};padding:0 3px;border-radius:2px;">${t}</span>`;
  });

  // [!徽章]
  s = s.replace(/\[!([^\]]+)\]/g, (_m, t: string) => {
    return `<span style="display:inline-block;font-size:12px;line-height:1.4;padding:0 6px;border:1px solid ${theme.accent};color:${theme.accent};border-radius:999px;margin-right:4px;">${t}</span>`;
  });

  // 图片 → 占位提示（不输出 figure）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, src: string) => {
    return `<section style="margin:16px 0;text-align:center;"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;border-radius:8px;" /><p style="margin:6px 0 0;font-size:12px;color:${theme.muted};text-align:center;">${escapeHtml(alt || "图片")}</p></section>`;
  });

  // 外链降级为灰色小字 URL 文本（wechat-constraints §2）
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const isHttp = /^(https?:)?\/\//.test(href);
    if (!isHttp) return `<span style="color:${theme.ink};">${label}</span>`;
    return `<span style="color:${theme.muted};">${label}（${escapeHtml(href)}）</span>`;
  });

  // 加粗 / 斜体
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => {
    return `<strong style="font-weight:700;color:${theme.ink};">${t}</strong>`;
  });
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_m, pre: string, t: string) => {
    return `${pre}<em style="font-style:italic;">${t}</em>`;
  });

  return s;
}

const CONTAINER_HEAD = /^:::+\s*(\w+)?\s*$/;
const CONTAINER_END = /^:::+\s*$/;

function containerBlockStyle(kind: string, theme: WechatTheme): { wrap: string; title?: string } {
  switch (kind) {
    case "tip":
      return {
        wrap: `background:rgba(61,107,79,0.08);border-left:3px solid ${theme.tip};color:${theme.ink};padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0;`,
        title: "小技巧",
      };
    case "warn":
      return {
        wrap: `background:rgba(166,124,58,0.10);border-left:3px solid ${theme.warn};color:${theme.ink};padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0;`,
        title: "注意",
      };
    case "danger":
      return {
        wrap: `background:rgba(166,82,74,0.08);border-left:3px solid ${theme.danger};color:${theme.ink};padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0;`,
        title: "常见坑",
      };
    case "pull":
      return {
        wrap: `text-align:center;padding:18px 12px;margin:20px 0;border-top:1px solid ${theme.muted};border-bottom:1px solid ${theme.muted};`,
      };
    case "stat":
      return {
        wrap: `text-align:center;padding:14px 12px;margin:16px 0;background:${theme.paper};border:1px solid ${theme.muted};border-radius:10px;`,
      };
    case "dialogue":
      return {
        wrap: `padding:10px 14px;margin:16px 0;border:1px dashed ${theme.muted};border-radius:8px;`,
      };
    case "note":
    default:
      return {
        wrap: `background:rgba(0,0,0,0.04);border-left:3px solid ${theme.muted};color:${theme.secondary};padding:12px 14px;margin:16px 0;border-radius:0 8px 8px 0;`,
        title: "补充",
      };
  }
}

function renderParagraph(text: string, theme: WechatTheme): string {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:${theme.ink};text-align:left;word-break:break-word;">${inlineFormat(text, theme)}</p>`;
}

function renderHeading(level: number, text: string, theme: WechatTheme): string {
  // 不用 h1/pre/figure（wechat-constraints §7）：标题一律 p + 内联样式
  if (level === 1) {
    return `<p style="margin:28px 0 14px;font-size:20px;line-height:1.4;font-weight:700;color:${theme.ink};text-align:center;">${inlineFormat(text, theme)}</p>`;
  }
  if (level === 2) {
    return `<p style="margin:26px 0 12px;font-size:17px;line-height:1.4;font-weight:700;color:${theme.accent};text-align:left;">${inlineFormat(text, theme)}</p>`;
  }
  return `<p style="margin:20px 0 10px;font-size:15px;line-height:1.4;font-weight:700;color:${theme.ink};text-align:left;">${inlineFormat(text, theme)}</p>`;
}

/**
 * Markdown → 微信约束 HTML 片段（内联 style）。
 * 输出 section/p/span/div 子集；无 class / 无 h1 / 无 pre / 无 figure。
 */
export function wechatMarkdownToHtml(md: string, themeInput?: string | WechatTheme): string {
  const theme = typeof themeInput === "string" ? resolveWechatTheme(themeInput) : themeInput || WECHAT_THEMES["minimal-ink"];
  const { body } = stripWechatFrontmatter(md);
  const lines = body.split("\n");
  const out: string[] = [];

  let i = 0;
  let inFence = false;
  let fenceBuf: string[] = [];
  let paraBuf: string[] = [];
  let listBuf: Array<{ ordered: boolean; text: string }> = [];
  let container: { kind: string; buf: string[] } | null = null;

  const flushPara = () => {
    if (!paraBuf.length) return;
    out.push(renderParagraph(paraBuf.join(""), theme));
    paraBuf = [];
  };
  const flushList = () => {
    if (!listBuf.length) return;
    const ordered = listBuf[0].ordered;
    const tag = ordered ? "ol" : "ul";
    const items = listBuf
      .map(
        (it) =>
          `<li style="margin:0 0 8px;font-size:15px;line-height:1.7;color:${theme.ink};text-align:left;">${inlineFormat(it.text, theme)}</li>`,
      )
      .join("");
    out.push(
      `<${tag} style="margin:0 0 20px;padding-left:1.4em;">${items}</${tag}>`,
    );
    listBuf = [];
  };
  const flushFence = () => {
    if (!fenceBuf.length) return;
    // 不用 <pre>：section + pre-wrap + break-all（wechat-constraints §4/§7）
    const code = fenceBuf.map(escapeHtml).join("\n");
    out.push(
      `<section style="margin:16px 0;padding:12px 14px;background:#1e1e1e;color:#d4d4d4;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-all;">${code}</section>`,
    );
    fenceBuf = [];
  };
  const flushContainer = () => {
    if (!container) return;
    const style = containerBlockStyle(container.kind, theme);
    const inner = container.buf
      .filter((l) => l.trim())
      .map((l) => {
        if (container!.kind === "stat") {
          // md2wechat.py：仅保留 `值 | 说明` 管道行，非管道行静默丢弃
          if (!l.includes("|")) return "";
          const [value, desc] = l.split("|", 1);
          return (
            `<p style="margin:0 0 14px;line-height:1.3;text-align:left;">` +
            `<span style="font-size:26px;font-weight:700;color:${theme.stat};margin-right:10px;">${inlineFormat(value.trim(), theme)}</span>` +
            `<span style="font-size:13px;color:${theme.muted};">${inlineFormat((desc || "").trim(), theme)}</span></p>`
          );
        }
        if (container!.kind === "pull") {
          return `<p style="margin:0;font-size:18px;line-height:1.5;font-weight:700;color:${theme.pull};text-align:center;">${inlineFormat(l, theme)}</p>`;
        }
        return renderParagraph(l, theme);
      })
      .filter(Boolean)
      .join("");
    const title = style.title
      ? `<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${theme.muted};text-align:left;">${escapeHtml(style.title)}</p>`
      : "";
    out.push(`<section style="${style.wrap}">${title}${inner}</section>`);
    container = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // fenced code
    if (/^```(\w*)\s*$/.test(trimmed)) {
      if (inFence) {
        inFence = false;
        flushFence();
      } else {
        flushPara();
        flushList();
        inFence = true;
      }
      i++;
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      i++;
      continue;
    }

    // container
    const cHead = CONTAINER_HEAD.exec(trimmed);
    if (cHead) {
      flushPara();
      flushList();
      if (container) flushContainer();
      container = { kind: (cHead[1] || "note").toLowerCase(), buf: [] };
      i++;
      continue;
    }
    if (container && CONTAINER_END.test(trimmed)) {
      flushContainer();
      i++;
      continue;
    }
    if (container) {
      container.buf.push(line);
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push(renderHeading(h[1].length, h[2], theme));
      i++;
      continue;
    }

    // hr
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushPara();
      flushList();
      out.push(
        `<section style="margin:24px 0;border:none;border-top:1px solid ${theme.muted};"></section>`,
      );
      i++;
      continue;
    }

    // blockquote
    if (trimmed.startsWith(">")) {
      flushPara();
      flushList();
      const q = trimmed.replace(/^>\s?/, "");
      out.push(
        `<section style="margin:16px 0;padding:8px 14px;border-left:3px solid ${theme.accent};color:${theme.secondary};"><p style="margin:0;font-size:14px;line-height:1.7;text-align:left;">${inlineFormat(q, theme)}</p></section>`,
      );
      i++;
      continue;
    }

    // list
    const li = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d+\./.test(li[2]);
      if (listBuf.length && listBuf[0].ordered !== ordered) flushList();
      listBuf.push({ ordered, text: li[3] });
      i++;
      continue;
    }

    // blank
    if (trimmed === "") {
      flushPara();
      flushList();
      i++;
      continue;
    }

    if (listBuf.length) flushList();
    paraBuf.push(line);
    i++;
  }
  flushPara();
  flushList();
  flushFence();
  if (container) flushContainer();

  return out.join("\n");
}

/** 完整预览文档（head 里的 style 粘贴时会被剥离；正文保持内联）。 */
export function wechatHtmlDocument(md: string, themeInput?: string | WechatTheme): string {
  const theme = typeof themeInput === "string" ? resolveWechatTheme(themeInput) : themeInput || WECHAT_THEMES["minimal-ink"];
  const body = wechatMarkdownToHtml(md, theme);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>公众号预览</title>
<style>
  html, body { margin: 0; padding: 0; background: ${theme.paper}; }
  body {
    font-family: ${theme.fontFamily};
    max-width: 100%;
    padding: 20px 16px 40px;
    box-sizing: border-box;
  }
  /* 预览栏宽约微信阅读栏；正文内联样式保持百分比宽度 */
  #wechat-preview { max-width: 100%; margin: 0 auto; }
</style>
</head>
<body>
<div id="wechat-preview">
${body}
</div>
</body>
</html>`;
}

/** 「复制正文」用的片段（不含文档壳）。 */
export function wechatCopyHtml(md: string, themeInput?: string | WechatTheme): string {
  return wechatMarkdownToHtml(md, themeInput);
}
