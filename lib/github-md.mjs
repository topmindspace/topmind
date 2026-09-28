// ── GitHub URL semantics for capture / ingest ──────────────────────────────
// Pure (no network). Single source for parsing GitHub markdown / README
// targets, building raw URLs, and rewriting relative image links.
// Network fetch lives in the surface layer (Desktop github-fetch.mjs).
// Vendored copies must stay byte-identical: topmind-obsidian/lib/,
// topmind-desktop/electron/lib/ (see kernel-engine-copy-parity).

const EXT = /\.(md|mdx|txt|markdown)$/i;
export const GITHUB_README_NAMES = [
  "README.md",
  "readme.md",
  "README.MD",
  "README.markdown",
  "README.mdx",
  "Readme.md",
];

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico)(?:\?|#|$)/i;

/** @typedef {{ owner: string, repo: string, ref: string, path: string }} GithubFileRef */
/** @typedef {{ owner: string, repo: string, ref?: string, subdir?: string }} GithubRepoReadmeTarget */

function stripGitSuffix(repo) {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

/** Parse blob/raw markdown file URLs only (exact file refs). */
export function parseGithubFileUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com") {
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 4) return null;
    const [owner, repo, ref, ...rest] = parts;
    const path = rest.join("/");
    if (!owner || !repo || !ref || !path || !EXT.test(path)) return null;
    return {
      owner,
      repo: stripGitSuffix(repo),
      ref: decodeURIComponent(ref),
      path: decodeURIComponent(path),
    };
  }
  if (host === "github.com" || host === "www.github.com") {
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 5) return null;
    const [owner, repo, blob, ...rest] = parts;
    if (blob !== "blob" && blob !== "raw") return null;
    if (rest.length < 2) return null;
    const ref = rest[0];
    const path = rest.slice(1).join("/");
    if (!owner || !repo || !ref || !path || !EXT.test(path)) return null;
    return {
      owner,
      repo: stripGitSuffix(repo),
      ref: decodeURIComponent(ref),
      path: decodeURIComponent(path),
    };
  }
  return null;
}

/**
 * Parse bare repo URLs and tree URLs for README auto-resolve.
 * Query/hash ignored. Rejects non-tree third segments (issues, pulls, …).
 */
export function parseGithubRepoReadmeTarget(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = stripGitSuffix(parts[1]);
  if (!owner || !repo) return null;
  if (parts.length === 2) {
    return { owner, repo };
  }
  const kind = parts[2];
  if (kind === "tree") {
    if (parts.length < 4) return null;
    const ref = decodeURIComponent(parts[3]);
    const subdir = parts
      .slice(4)
      .map((s) => decodeURIComponent(s))
      .join("/");
    return { owner, repo, ref, subdir: subdir || undefined };
  }
  // blob/raw → parseGithubFileUrl; other paths (issues, pulls, …) rejected
  return null;
}

/** True when URL points at a GitHub markdown file or a README-resolvable repo/tree. */
export function isGithubMarkdownFileUrl(raw) {
  return Boolean(parseGithubFileUrl(raw) || parseGithubRepoReadmeTarget(raw));
}

/** True for any github.com / raw.githubusercontent.com URL (including non-md). */
export function isGithubHostUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    const host = u.hostname.toLowerCase();
    return host === "github.com" || host === "www.github.com" || host === "raw.githubusercontent.com";
  } catch {
    return false;
  }
}

export function githubBlobUrl(ref) {
  return `https://github.com/${ref.owner}/${ref.repo}/blob/${ref.ref}/${ref.path}`;
}

export function githubRawUrl(ref) {
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}/${ref.path}`;
}

export function headingTitleFromMarkdown(markdown) {
  const m = String(markdown || "").match(/^\s*#\s+(.+)\s*$/m);
  if (!m) return null;
  const t = m[1].replace(/[#*_`]/g, "").trim().slice(0, 80);
  return t || null;
}

export function titleFromMarkdown(markdown, filename) {
  const fromH1 = headingTitleFromMarkdown(markdown);
  if (fromH1) return fromH1;
  const base = String(filename || "").split("/").pop() || String(filename || "");
  return base.replace(/\.(md|mdx|txt|markdown)$/i, "").slice(0, 80) || "无标题笔记";
}

function posixJoin(dir, rel) {
  const relNorm = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const rooted = relNorm.startsWith("/");
  const start = rooted ? [] : String(dir || "").split("/").filter(Boolean);
  const parts = [...start, ...relNorm.replace(/^\/+/, "").split("/")];
  const stack = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(p);
  }
  return stack.join("/");
}

function fileDir(filePath) {
  const i = String(filePath || "").lastIndexOf("/");
  return i >= 0 ? filePath.slice(0, i) : "";
}

function unwrapUrl(raw) {
  let s = String(raw || "").trim();
  if (
    (s.startsWith("<") && s.endsWith(">")) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith('"') && s.endsWith('"'))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function githubRawAssetUrl(ref, relPath) {
  const joined = posixJoin(fileDir(ref.path), relPath);
  const encoded = joined
    .split("/")
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join("/");
  return `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${ref.ref}/${encoded}`;
}

export function rewriteGithubImageSrc(src, ref) {
  const raw = unwrapUrl(src);
  if (!raw || raw.startsWith("#") || raw.startsWith("data:") || raw.startsWith("mailto:")) return src;
  const withProto = raw.startsWith("//") ? `https:${raw}` : raw;
  if (/^https?:\/\//i.test(withProto)) {
    try {
      const u = new URL(withProto);
      const host = u.hostname.toLowerCase();
      if (host === "github.com" || host === "www.github.com") {
        const parts = u.pathname.replace(/^\/+/, "").split("/");
        if (parts.length >= 5 && (parts[2] === "blob" || parts[2] === "raw")) {
          const owner = parts[0];
          const repo = parts[1];
          const r = parts[3];
          const p = parts.slice(4).join("/");
          if (owner && repo && r && p) {
            return `https://raw.githubusercontent.com/${owner}/${repo}/${r}/${p}${u.search}`;
          }
        }
      }
      return withProto;
    } catch {
      return src;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return src;
  return githubRawAssetUrl(ref, raw.split("#")[0]);
}

function looksLikeImageDest(url) {
  const u = unwrapUrl(url);
  if (IMAGE_EXT.test(u)) return true;
  if (/github\.com\/[^/]+\/[^/]+\/(?:blob|raw)\//i.test(u)) return true;
  if (/raw\.githubusercontent\.com\//i.test(u)) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("#") && !u.startsWith("mailto:")) {
    return IMAGE_EXT.test(u.split("?")[0] || "");
  }
  return false;
}

export function rewriteGithubMarkdownImages(markdown, ref) {
  let out = String(markdown || "").replace(
    /(!?\[[^\]]*]\()\s*(<)?([^)\s>]+)(>)?/g,
    (full, prefix, lt, url, gt) => {
      const bang = prefix.startsWith("!");
      if (!bang && !looksLikeImageDest(url)) return full;
      const next = rewriteGithubImageSrc(url, ref);
      if (next === url) return full;
      return `${prefix}${lt || ""}${next}${gt || ""}`;
    },
  );
  out = out.replace(/<img\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2/gi, (full, pre, q, url) => {
    const next = rewriteGithubImageSrc(url, ref);
    if (next === url) return full;
    return `<img${pre}src=${q}${next}${q}`;
  });
  out = out.replace(/<img\b([^>]*?)\bsrc\s*=\s*([^\s>"']+)/gi, (full, pre, url) => {
    if (url.startsWith('"') || url.startsWith("'")) return full;
    const next = rewriteGithubImageSrc(url, ref);
    if (next === url) return full;
    return `<img${pre}src="${next}"`;
  });
  return out;
}

/**
 * Classify a capture URL for routing / UI hints.
 * @returns {{ kind: "github-file"|"github-readme"|"github-other"|"x-status"|"x-article"|"web", github?: object, labelKey?: string } | null}
 */
export function classifyCaptureUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;

  const file = parseGithubFileUrl(s);
  if (file) {
    return { kind: "github-file", github: file, labelKey: "capture.urlKindGithubFile" };
  }
  const readme = parseGithubRepoReadmeTarget(s);
  if (readme) {
    return { kind: "github-readme", github: readme, labelKey: "capture.urlKindGithubReadme" };
  }
  if (isGithubHostUrl(s)) {
    return { kind: "github-other", labelKey: "capture.urlKindGithubOther" };
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts[0] === "i" && parts[1] === "article" && parts[2]) {
      return { kind: "x-article", labelKey: "capture.urlKindXArticle" };
    }
    if (parts.includes("status")) {
      return { kind: "x-status", labelKey: "capture.urlKindXStatus" };
    }
  }

  return { kind: "web", labelKey: "capture.urlKindWeb" };
}

/**
 * Prefer a raw.githubusercontent URL when the target is a GitHub markdown file
 * so hosts without HTML extraction still get clean Markdown.
 * Non-GitHub / non-md inputs are returned unchanged.
 */
export function preferGithubRawUrl(raw) {
  const file = parseGithubFileUrl(raw);
  if (file) return githubRawUrl(file);
  return String(raw || "").trim();
}
