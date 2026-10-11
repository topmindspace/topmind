/**
 * GitHub markdown / README fetch (network layer).
 * URL semantics live in github-md.mjs (pure, vendored from lib/).
 * Surface-only: Desktop HTTP. Kernel does not fetch.
 */
import {
  parseGithubFileUrl,
  parseGithubRepoReadmeTarget,
  githubRawUrl,
  githubBlobUrl,
  headingTitleFromMarkdown,
  titleFromMarkdown,
  rewriteGithubMarkdownImages,
  GITHUB_README_NAMES,
} from "./github-md.mjs";

const MAX_BYTES = 400 * 1024;
const TIMEOUT_MS = 8000;
const UA = "topmind-capture";

export class GithubMdError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "GithubMdError";
    this.status = status;
    this.code = "github_error";
  }
}

function withTimeout(ms, fn) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fn(ac.signal).finally(() => clearTimeout(timer));
}

function refFromGithubUrls(htmlUrl, downloadUrl, fallback) {
  if (htmlUrl) {
    const parsed = parseGithubFileUrl(htmlUrl);
    if (parsed) return parsed.ref;
  }
  if (downloadUrl) {
    try {
      const u = new URL(downloadUrl);
      if (u.hostname.toLowerCase() === "raw.githubusercontent.com") {
        const parts = u.pathname.replace(/^\/+/, "").split("/");
        if (parts.length >= 3) return decodeURIComponent(parts[2]);
      }
    } catch {
      /* ignore */
    }
  }
  return fallback || "main";
}

async function resolveReadmeViaApi(target, signal) {
  const sub = (target.subdir || "").replace(/^\/+|\/+$/g, "");
  const apiPath = sub
    ? `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
        target.repo,
      )}/readme/${sub
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    : `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(
        target.repo,
      )}/readme`;
  const url = target.ref ? `${apiPath}?ref=${encodeURIComponent(target.ref)}` : apiPath;
  try {
    const res = await fetch(url, {
      signal,
      redirect: "follow",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": UA,
      },
    });
    if (!res.ok) return null;
    const data = /** @type {{ path?: string, download_url?: string|null, html_url?: string|null, name?: string }} */ (
      await res.json()
    );
    const path = String(data.path || data.name || "").trim();
    if (!path) return null;
    const ref = refFromGithubUrls(data.html_url, data.download_url, target.ref);
    return { owner: target.owner, repo: target.repo, ref, path };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    return null;
  }
}

async function readRawResponse(parsed, res) {
  const finalHost = (() => {
    try {
      return new URL(res.url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (finalHost && finalHost !== "raw.githubusercontent.com") {
    throw new GithubMdError("GitHub 文件地址无效");
  }
  const len = Number(res.headers.get("content-length") || "0");
  if (len > MAX_BYTES) throw new GithubMdError("文件过大（上限约 400KB）");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) throw new GithubMdError("文件过大（上限约 400KB）");
  const markdown = rewriteGithubMarkdownImages(buf.toString("utf8"), parsed);
  if (!markdown.trim()) throw new GithubMdError("文件内容为空");
  return {
    ref: parsed,
    markdown,
    title: titleFromMarkdown(markdown, parsed.path),
    url: githubBlobUrl(parsed),
  };
}

async function fetchRawMarkdown(parsed, signal) {
  const res = await fetch(githubRawUrl(parsed), {
    signal,
    redirect: "follow",
    headers: {
      Accept: "text/plain, text/markdown, */*",
      "User-Agent": UA,
    },
  });
  if (!res.ok) {
    throw new GithubMdError(
      res.status === 404 ? "GitHub 文件不存在或仓库为私有" : "无法读取 GitHub 文件",
      400,
    );
  }
  return readRawResponse(parsed, res);
}

async function fetchReadmeRawFallback(target, signal) {
  const refs = target.ref ? [target.ref] : ["main", "master"];
  const sub = (target.subdir || "").replace(/^\/+|\/+$/g, "");
  let lastErr = null;
  for (const ref of refs) {
    for (const name of GITHUB_README_NAMES) {
      const path = sub ? `${sub}/${name}` : name;
      const tryRef = { owner: target.owner, repo: target.repo, ref, path };
      try {
        const res = await fetch(githubRawUrl(tryRef), {
          signal,
          redirect: "follow",
          headers: {
            Accept: "text/plain, text/markdown, */*",
            "User-Agent": UA,
          },
        });
        if (!res.ok) continue;
        return await readRawResponse(tryRef, res);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
        if (e instanceof GithubMdError) {
          lastErr = e;
          continue;
        }
        lastErr = e;
      }
    }
  }
  if (lastErr instanceof GithubMdError) throw lastErr;
  throw new GithubMdError("未找到 README（仓库不存在、为私有，或该路径下无 README）", 400);
}

/**
 * Fetch GitHub markdown file or repo README as clean Markdown.
 * @param {string} raw
 * @returns {Promise<{ ref: object, markdown: string, title: string, url: string, fetchMethod: string }>}
 */
export async function fetchGithubMarkdown(raw) {
  const file = parseGithubFileUrl(raw);
  const repoTarget = file ? null : parseGithubRepoReadmeTarget(raw);
  if (!file && !repoTarget) {
    throw new GithubMdError(
      "请粘贴 GitHub 仓库地址或 Markdown 文件链接（支持仓库根 / tree / blob / raw）",
    );
  }
  try {
    return await withTimeout(TIMEOUT_MS, async (signal) => {
      if (file) {
        const out = await fetchRawMarkdown(file, signal);
        return { ...out, fetchMethod: "github-raw" };
      }
      const viaApi = await resolveReadmeViaApi(repoTarget, signal);
      if (viaApi) {
        try {
          const out = await fetchRawMarkdown(viaApi, signal);
          return { ...out, fetchMethod: "github-readme" };
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") throw e;
          // fall through to raw name probing
        }
      }
      const out = await fetchReadmeRawFallback(repoTarget, signal);
      return { ...out, fetchMethod: "github-readme" };
    });
  } catch (e) {
    if (e instanceof GithubMdError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new GithubMdError("读取 GitHub 超时，请稍后重试");
    }
    throw new GithubMdError("无法读取 GitHub 文件");
  }
}

/** H1 title helper re-export for callers that only need naming. */
export { headingTitleFromMarkdown };
