/**
 * Multi-surface update check (public-first).
 *
 * Surfaces (independent semvers — do NOT use product tag v* as Desktop version):
 *   desktop   → topmind-<ver>-* installers · tags desktop-v* or product v* with assets
 *   skills    → topmind-skills-<ver>.*  (also bundled in topmind-engine/skills)
 *   extension → topmind-clip-extension-<ver>.*  (browser; not required inside Desktop)
 *
 * Strategy:
 *  1. Public latest.json via releases/latest/download (no API / no token)
 *  2. Optional GitHub REST API if topmind_UPDATE_USE_API=1 or GH_TOKEN
 *  3. Public /releases/latest tag redirect fallback
 *  4. Compare with running / bundled versions (engine versions.json when present)
 *
 * Env:
 *   topmind_UPDATE_REPO=owner/name
 *   topmind_UPDATE_LATEST_URL=…   override public stamp URL
 *   topmind_UPDATE_API=https://api.github.com
 *   topmind_UPDATE_USE_API=1
 *   topmind_UPDATE_TIMEOUT_MS=15000
 *   GH_TOKEN / GITHUB_TOKEN  opt-in API
 *
 * UTR is bundled under topmind-engine/utr (Tools console) but is not a separate
 * downloadable update surface — version is stamped in versions.json only.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const DEFAULT_REPO = "topmindspace/topmind";
const DEFAULT_API = "https://api.github.com";
const USER_AGENT = "topmind-Desktop-UpdateCheck";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareSemver(a, b) {
  const pa = String(a || "0")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * Tag → desktop version ONLY for explicit desktop-v* tags.
 * Product tags like v1.0.0 are monorepo ship events — NOT Desktop semver.
 * @param {string} tag
 * @returns {string | null}
 */
export function versionFromTag(tag) {
  const t = String(tag || "").trim();
  const desktop = /^desktop-v(.+)$/i.exec(t);
  if (desktop) return desktop[1];
  return null;
}

/**
 * True for product tags that may carry multi-surface assets (v1.0.0), not skills-/extension- only.
 * @param {string} tag
 */
export function isProductTag(tag) {
  const t = String(tag || "").trim();
  return /^v\d/i.test(t) && !/^(skills|extension|desktop)-v/i.test(t);
}

/**
 * Extract max version from Desktop installer asset names: topmind-1.0.0-win-x64.exe
 * @param {Array<{ name?: string }>} assets
 * @returns {string | null}
 */
export function desktopVersionFromAssets(assets) {
  let best = null;
  for (const a of assets || []) {
    const name = String(a?.name || "");
    const m = /^topmind-(\d+\.\d+\.\d+)(?=-)/i.exec(name);
    if (!m) continue;
    if (!best || compareSemver(m[1], best) > 0) best = m[1];
  }
  return best;
}

/**
 * topmind-skills-1.0.0.zip / .tar.gz / -manifest.json
 * @param {Array<{ name?: string }>} assets
 */
export function skillsVersionFromAssets(assets) {
  let best = null;
  for (const a of assets || []) {
    const name = String(a?.name || "");
    const m = /^topmind-skills-(\d+\.\d+\.\d+)(?=[.-])/i.exec(name);
    if (!m) continue;
    if (!best || compareSemver(m[1], best) > 0) best = m[1];
  }
  return best;
}

/**
 * topmind-clip-extension-1.0.0.zip
 * @param {Array<{ name?: string }>} assets
 */
export function extensionVersionFromAssets(assets) {
  let best = null;
  for (const a of assets || []) {
    const name = String(a?.name || "");
    const m = /^topmind-clip-extension-(\d+\.\d+\.\d+)(?=[.-])/i.exec(name);
    if (!m) continue;
    if (!best || compareSemver(m[1], best) > 0) best = m[1];
  }
  return best;
}

/**
 * Desktop version carried by a release (asset-first; desktop-v tag fallback).
 * @param {object} release
 * @returns {string | null}
 */
export function desktopVersionFromRelease(release) {
  const fromAssets = desktopVersionFromAssets(release?.assets);
  if (fromAssets) return fromAssets;
  return versionFromTag(release?.tag_name);
}

/**
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {(name: string) => boolean}
 */
export function assetMatcher(platform, arch = process.arch) {
  const p = platform || process.platform;
  const a = arch || process.arch;
  return (name) => {
    const n = String(name || "").toLowerCase();
    if (!n.startsWith("topmind-")) return false;
    if (n.includes("blockmap") || n.endsWith(".yml") || n.endsWith(".yaml")) return false;
    if (n.includes("sha256") || n.includes("manifest")) return false;
    if (p === "darwin") {
      const archOk =
        a === "arm64"
          ? n.includes("arm64") || n.includes("aarch64")
          : n.includes("x64") || n.includes("x86_64") || (!n.includes("arm64") && n.includes("mac"));
      return (n.endsWith(".dmg") || (n.endsWith(".zip") && n.includes("mac"))) && (archOk || n.includes("mac"));
    }
    if (p === "win32") {
      return n.endsWith(".exe") && (n.includes("win") || n.includes("x64") || n.includes("setup"));
    }
    const archOk =
      a === "arm64"
        ? n.includes("arm64") || n.includes("aarch64")
        : n.includes("x64") || n.includes("x86_64") || n.includes("amd64");
    return (
      (n.endsWith(".appimage") || n.endsWith(".deb") || (n.endsWith(".tar.gz") && n.includes("linux"))) &&
      (archOk || n.includes("linux"))
    );
  };
}

/**
 * @param {object} release GitHub release JSON
 * @param {string} platform
 * @param {string} arch
 */
export function pickAssets(release, platform, arch) {
  const match = assetMatcher(platform, arch);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets
    .filter((a) => match(a.name))
    .map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      contentType: a.content_type,
    }));
}

/**
 * Pack zip/tar for skills or extension (prefer .zip).
 * @param {object} release
 * @param {"skills"|"extension"} surface
 */
export function pickPackAssets(release, surface) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const re =
    surface === "skills"
      ? /^topmind-skills-\d/i
      : /^topmind-clip-extension-\d/i;
  const mapped = assets
    .filter((a) => re.test(String(a.name || "")) && !/sha256|manifest/i.test(String(a.name || "")))
    .map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
      contentType: a.content_type,
    }));
  mapped.sort((a, b) => {
    const az = a.name.endsWith(".zip") ? 0 : 1;
    const bz = b.name.endsWith(".zip") ? 0 : 1;
    return az - bz;
  });
  return mapped;
}

/**
 * @param {string} current
 * @param {string|null} latest
 */
function reasonFor(current, latest) {
  if (!latest) return "no-release";
  const cmp = compareSemver(latest, current);
  if (cmp > 0) return "newer";
  if (cmp < 0) return "local-ahead";
  return "up-to-date";
}

/**
 * Prefer Electron net.fetch (Chromium stack → system / OS proxy) over Node fetch.
 * @param {typeof fetch} [preferred]
 * @returns {typeof fetch}
 */
export function resolveFetchImpl(preferred) {
  if (typeof preferred === "function") return preferred;
  try {
    const { net } = require("electron");
    if (net && typeof net.fetch === "function") {
      return (input, init) => net.fetch(input, init);
    }
  } catch {
    /* tests / non-electron */
  }
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error("fetch is not available");
}

/**
 * Classify network / HTTP failures for user-facing copy.
 * @param {unknown} err
 * @param {number} [status]
 * @returns {{ code: string, message: string, hint: string }}
 */
export function classifyUpdateError(err, status) {
  const raw = err instanceof Error ? err.message : String(err || "");
  const name = err instanceof Error ? err.name : "";

  if (status === 403 || /403/.test(raw)) {
    return {
      code: "rate-limit",
      message: "GitHub API 拒绝访问（403）",
      hint: "未认证请求有速率限制；可稍后重试，或设置 GH_TOKEN。内网请配置系统代理 / topmind_UPDATE_API 镜像。",
    };
  }
  if (status === 404 || /404/.test(raw)) {
    return {
      code: "not-found",
      message: "未找到仓库 Releases（404）",
      hint: "检查 topmind_UPDATE_REPO 是否正确，或仓库是否为公开。",
    };
  }
  if (name === "AbortError" || /aborted|timeout|TIMEDOUT|ETIMEDOUT/i.test(raw)) {
    return {
      code: "timeout",
      message: "连接 GitHub 超时",
      hint: "常见于网络受限或未配置代理。请检查系统代理，或稍后重试；也可手动打开 Releases 页下载。",
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|network|fetch failed|Failed to fetch|certificate|SSL|TLS/i.test(raw)) {
    return {
      code: "network",
      message: "无法连接 GitHub API",
      hint: "请检查网络、系统代理或公司防火墙。可设置 HTTPS_PROXY / 系统代理，或配置 topmind_UPDATE_API 为可达镜像。",
    };
  }
  if (status && status >= 500) {
    return {
      code: "server",
      message: `GitHub 服务异常（${status}）`,
      hint: "稍后重试，或浏览器打开 Releases 页手动检查。",
    };
  }
  return {
    code: "error",
    message: raw.slice(0, 240) || "检查更新失败",
    hint: "可手动打开 GitHub Releases；受限网络请配置代理。",
  };
}

/**
 * @param {string} url
 * @param {object} opts
 * @param {typeof fetch} opts.fetchImpl
 * @param {Record<string,string>} opts.headers
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 */
export async function fetchWithRetry(url, opts) {
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  const envTimeout = Number(process.env.topmind_UPDATE_TIMEOUT_MS);
  const timeoutMs =
    opts.timeoutMs ??
    (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let lastErr = null;
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const res = await fetchImpl(url, {
        headers: opts.headers,
        signal: controller?.signal,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        lastStatus = res.status;
        const body = await res.text().catch(() => "");
        lastErr = new Error(`GitHub releases ${res.status}: ${body.slice(0, 200)}`);
        // Retry 5xx and 429 only
        if ((res.status >= 500 || res.status === 429) && attempt < retries) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      return res;
    } catch (e) {
      if (timer) clearTimeout(timer);
      lastErr = e;
      const cls = classifyUpdateError(e, lastStatus);
      const retryable =
        cls.code === "timeout" ||
        cls.code === "network" ||
        cls.code === "server" ||
        lastStatus === 429;
      if (retryable && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      const classified = classifyUpdateError(e, lastStatus);
      const err = new Error(`${classified.message}: ${classified.hint}`);
      err.code = classified.code;
      err.cause = e;
      throw err;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Packaged engine versions stamp (written by pack:prepare).
 * @param {{ engineRoot?: string|null }} [opts]
 * @returns {{ skills?: string, extension?: string, desktop?: string, generatedAt?: string } | null}
 */
export function readEngineVersionsStamp(opts = {}) {
  const candidates = [];
  if (opts.engineRoot) {
    candidates.push(path.join(opts.engineRoot, "versions.json"));
  }
  candidates.push(path.join(DESKTOP_DIR, "resources", "topmind-engine", "versions.json"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      candidates.unshift(path.join(process.resourcesPath, "topmind-engine", "versions.json"));
    }
  } catch {
    /* */
  }
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j && typeof j === "object") return j;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Bundled / engine skills pack version.
 * @param {{ engineRoot?: string|null }} [opts]
 */
export function readBundledSkillsVersion(opts = {}) {
  const stamp = readEngineVersionsStamp(opts);
  if (stamp?.skills) return String(stamp.skills).replace(/^v/i, "");

  const candidates = [];
  if (opts.engineRoot) {
    candidates.push(path.join(opts.engineRoot, "skills", "topmind-pack.json"));
  }
  candidates.push(path.join(DESKTOP_DIR, "..", "skills", "topmind-pack.json"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      candidates.unshift(path.join(process.resourcesPath, "topmind-engine", "skills", "topmind-pack.json"));
    }
  } catch {
    /* tests / non-electron */
  }
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j?.version) return String(j.version).replace(/^v/i, "");
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Clip extension version: monorepo / stamp only (not required inside Desktop app).
 * @param {{ engineRoot?: string|null }} [opts]
 */
export function readBundledExtensionVersion(opts = {}) {
  const stamp = readEngineVersionsStamp(opts);
  if (stamp?.extension) return String(stamp.extension).replace(/^v/i, "");

  const candidates = [];
  if (opts.engineRoot) {
    candidates.push(path.join(opts.engineRoot, "browser-extension", "manifest.json"));
  }
  // monorepo sibling (dev)
  candidates.push(path.join(DESKTOP_DIR, "..", "browser-extension", "manifest.json"));
  // optional staged under engine (if pack:prepare copies version only)
  candidates.push(path.join(DESKTOP_DIR, "resources", "topmind-engine", "browser-extension", "manifest.json"));
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      candidates.unshift(
        path.join(process.resourcesPath, "topmind-engine", "browser-extension", "manifest.json"),
      );
    }
  } catch {
    /* */
  }
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j?.version) return String(j.version).replace(/^v/i, "");
    } catch {
      /* */
    }
  }
  return null;
}

/**
 * Pick the GitHub release that carries the highest version for a surface.
 * @param {any[]} releases
 * @param {(rel: any) => string|null} versionOf
 * @returns {{ release: any, version: string } | null}
 */
export function pickLatestReleaseFor(releases, versionOf) {
  let best = null;
  let bestVer = null;
  for (const rel of releases) {
    if (rel?.draft || rel?.prerelease) continue;
    const ver = versionOf(rel);
    if (!ver) continue;
    if (!best || compareSemver(ver, bestVer) > 0) {
      best = rel;
      bestVer = ver;
    }
  }
  return best && bestVer ? { release: best, version: bestVer } : null;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.currentVersion] Desktop running version
 * @param {string} [opts.skillsVersion]
 * @param {string} [opts.extensionVersion]
 * @param {string} [opts.repo]
 * @param {string} [opts.apiBase]
 * @param {string} [opts.platform]
 * @param {string} [opts.arch]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.token]
 * @param {string|null} [opts.engineRoot]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 */
export async function checkForDesktopUpdate(opts = {}) {
  const multi = await checkAllSurfaces(opts);
  return multi.desktop;
}

/**
 * Public latest.json shape (uploaded on every full product release).
 * URL: https://github.com/{repo}/releases/latest/download/latest.json
 * No GitHub API / no auth — works for public repos worldwide (CDN redirect).
 *
 * @typedef {object} LatestJson
 * @property {string} [productTag]
 * @property {string} [desktop]
 * @property {string} [skills]
 * @property {string} [extension]
 * @property {string} [releaseUrl]
 * @property {string} [publishedAt]
 * @property {Array<{ name: string, browser_download_url?: string, url?: string, size?: number }>} [assets]
 */

/**
 * Fetch public latest.json (preferred update path).
 * @returns {Promise<LatestJson|null>}
 */
export async function fetchPublicLatestJson(opts = {}) {
  const repo = opts.repo || process.env.topmind_UPDATE_REPO || DEFAULT_REPO;
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  const url =
    opts.latestUrl ||
    process.env.topmind_UPDATE_LATEST_URL ||
    `https://github.com/${repo}/releases/latest/download/latest.json`;
  try {
    const res = await fetchWithRetry(url, {
      fetchImpl,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      timeoutMs: opts.timeoutMs ?? 12_000,
      retries: opts.retries ?? 2,
    });
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Minimal public fallback: resolve latest tag via HTML redirect (no API).
 * @returns {Promise<string|null>} tag name e.g. v1.0.2
 */
export async function fetchLatestTagPublic(opts = {}) {
  const repo = opts.repo || process.env.topmind_UPDATE_REPO || DEFAULT_REPO;
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  const url = `https://github.com/${repo}/releases/latest`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
    const finalUrl = String(res.url || "");
    const m = /\/releases\/tag\/([^/?#]+)/.exec(finalUrl);
    if (m) return decodeURIComponent(m[1]);
    // Some clients don't expose final URL — parse Location-less body for og:url
    const text = await res.text().catch(() => "");
    const m2 = /\/releases\/tag\/([^"'?\s]+)/.exec(text);
    return m2 ? decodeURIComponent(m2[1]) : null;
  } catch {
    return null;
  }
}

function syntheticReleaseFromLatest(latest, repo) {
  const tag = latest.productTag || latest.tag || null;
  const assets = Array.isArray(latest.assets)
    ? latest.assets.map((a) => ({
        name: a.name,
        size: a.size || 0,
        browser_download_url: a.browser_download_url || a.url || null,
        content_type: a.content_type,
      }))
    : [];
  // If no asset list, synthesize common names from versions so pickers still work
  // with GitHub public download URLs.
  if (assets.length === 0) {
    const desk = latest.desktop;
    const skills = latest.skills;
    const ext = latest.extension;
    const base = `https://github.com/${repo}/releases/download/${tag || "latest"}`;
    if (desk) {
      for (const name of [
        `topmind-${desk}-mac-arm64.dmg`,
        `topmind-${desk}-mac-arm64.zip`,
        `topmind-${desk}-win-x64.exe`,
        `topmind-${desk}-linux-x64.AppImage`,
        `topmind-${desk}-linux-x86_64.AppImage`,
        `topmind-${desk}-linux-arm64.AppImage`,
        `topmind-${desk}-linux-amd64.deb`,
        `topmind-${desk}-linux-arm64.deb`,
      ]) {
        assets.push({ name, size: 0, browser_download_url: `${base}/${name}` });
      }
    }
    if (skills) {
      assets.push({
        name: `topmind-skills-${skills}.zip`,
        size: 0,
        browser_download_url: `${base}/topmind-skills-${skills}.zip`,
      });
    }
    if (ext) {
      assets.push({
        name: `topmind-clip-extension-${ext}.zip`,
        size: 0,
        browser_download_url: `${base}/topmind-clip-extension-${ext}.zip`,
      });
    }
  }
  return {
    tag_name: tag,
    html_url: latest.releaseUrl || `https://github.com/${repo}/releases/tag/${tag || ""}`,
    published_at: latest.publishedAt || null,
    body: latest.notes || null,
    assets,
    draft: false,
    prerelease: false,
  };
}

/**
 * Full multi-surface product update check.
 *
 * Strategy (public-first for open-source topmind):
 *  1. latest.json via releases/latest/download (no API, no token)
 *  2. Optional GitHub API only if topmind_UPDATE_USE_API=1 or GH_TOKEN set
 *
 * @param {object} [opts]
 */
export async function checkAllSurfaces(opts = {}) {
  const currentDesktop = String(opts.currentVersion || "0.0.0").replace(/^v/i, "");
  const skillsResolved =
    opts.skillsVersion != null
      ? String(opts.skillsVersion).replace(/^v/i, "").trim()
      : readBundledSkillsVersion({ engineRoot: opts.engineRoot });
  const extensionRaw =
    opts.extensionVersion !== undefined
      ? opts.extensionVersion == null
        ? null
        : String(opts.extensionVersion).replace(/^v/i, "").trim()
      : readBundledExtensionVersion({ engineRoot: opts.engineRoot });

  const currentSkills = skillsResolved || "0.0.0";
  const currentExtension = extensionRaw && extensionRaw.length > 0 ? extensionRaw : null;
  const extensionKnown = currentExtension != null;

  const repo = opts.repo || process.env.topmind_UPDATE_REPO || DEFAULT_REPO;
  const platform = opts.platform || process.platform;
  const arch = opts.arch || process.arch;
  const fetchImpl = resolveFetchImpl(opts.fetchImpl);
  const checkedAt = new Date().toISOString();
  const releasesUrl = `https://github.com/${repo}/releases`;

  /** @type {any[]} */
  let releases = [];
  let source = "none";

  /** @type {LatestJson|null} */
  let latestStamp = null;

  // ── 1) Public latest.json (preferred) ───────────────────────────────────
  if (opts.forceApi !== true) {
    latestStamp = await fetchPublicLatestJson({
      repo,
      fetchImpl,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      latestUrl: opts.latestUrl,
    });
    if (
      latestStamp &&
      (latestStamp.desktop || latestStamp.skills || latestStamp.productTag || latestStamp.assets)
    ) {
      releases = [syntheticReleaseFromLatest(latestStamp, repo)];
      source = "public-latest-json";
    }
  }

  // ── 2) GitHub REST API (opt-in / token) ─────────────────────────────────
  const useApi =
    opts.forceApi === true ||
    process.env.topmind_UPDATE_USE_API === "1" ||
    Boolean(opts.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN);

  if (releases.length === 0 && useApi) {
    const apiBase = (opts.apiBase || process.env.topmind_UPDATE_API || DEFAULT_API).replace(/\/$/, "");
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = opts.token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const listUrl = `${apiBase}/repos/${repo}/releases?per_page=40`;
    const res = await fetchWithRetry(listUrl, {
      fetchImpl,
      headers,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
    });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("unexpected GitHub releases payload");
    releases = data;
    source = "github-api";
  }

  // ── 3) Last resort public: tag redirect only (limited asset URLs) ───────
  if (releases.length === 0) {
    const tag = await fetchLatestTagPublic({ repo, fetchImpl, timeoutMs: opts.timeoutMs });
    if (tag) {
      releases = [
        syntheticReleaseFromLatest(
          {
            productTag: tag,
            desktop: versionFromTag(tag) || String(tag).replace(/^v/i, ""),
            releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
          },
          repo,
        ),
      ];
      source = "public-latest-tag";
    }
  }

  if (releases.length === 0) {
    const err = new Error(
      "无法获取更新信息：公开 latest.json 与 GitHub 均不可达。请检查网络，或稍后打开 Releases 页手动下载。",
    );
    err.code = "network";
    throw err;
  }

  let desktopPickFinal = pickLatestReleaseFor(releases, desktopVersionFromRelease);
  let skillsPickResolved = pickLatestReleaseFor(releases, (r) => {
    const fromAssets = skillsVersionFromAssets(r.assets);
    if (fromAssets) return fromAssets;
    const m = /^skills-v(.+)$/i.exec(String(r.tag_name || ""));
    return m ? m[1] : null;
  });
  let extensionPickFinal = pickLatestReleaseFor(releases, (r) => {
    const fromAssets = extensionVersionFromAssets(r.assets);
    if (fromAssets) return fromAssets;
    const m = /^extension-v(.+)$/i.exec(String(r.tag_name || ""));
    return m ? m[1] : null;
  });

  // Prefer explicit version stamps from public latest.json
  if (latestStamp && releases[0]) {
    const rel = releases[0];
    if (latestStamp.desktop) {
      desktopPickFinal = {
        release: rel,
        version: String(latestStamp.desktop).replace(/^v/i, ""),
      };
    }
    if (latestStamp.skills) {
      skillsPickResolved = {
        release: rel,
        version: String(latestStamp.skills).replace(/^v/i, ""),
      };
    }
    if (latestStamp.extension) {
      extensionPickFinal = {
        release: rel,
        version: String(latestStamp.extension).replace(/^v/i, ""),
      };
    }
  }

  /** @param {"desktop"|"skills"|"extension"} surface */
  function buildSurface(surface, current, pick, options = {}) {
    if (options.notBundled) {
      return {
        ok: true,
        surface,
        updateAvailable: false,
        currentVersion: null,
        latestVersion: pick?.version || null,
        tagName: pick?.release?.tag_name || null,
        releaseUrl: pick?.release?.html_url || releasesUrl,
        notes: null,
        publishedAt: pick?.release?.published_at || null,
        assets: pick ? pickPackAssets(pick.release, surface) : [],
        repo,
        checkedAt,
        reason: "not-bundled",
      };
    }
    if (!pick) {
      return {
        ok: true,
        surface,
        updateAvailable: false,
        currentVersion: current,
        latestVersion: null,
        tagName: null,
        releaseUrl: releasesUrl,
        notes: null,
        publishedAt: null,
        assets: [],
        repo,
        checkedAt,
        reason: "no-release",
      };
    }
    const { release, version: latest } = pick;
    const cmp = compareSemver(latest, current || "0.0.0");
    let assets =
      surface === "desktop"
        ? pickAssets(release, platform, arch)
        : pickPackAssets(release, surface);
    // Public synthetic assets may 404 for wrong arch names — filter those without url only for display
    assets = assets.filter((a) => a.url || a.name);
    return {
      ok: true,
      surface,
      updateAvailable: cmp > 0,
      currentVersion: current,
      latestVersion: latest,
      tagName: release.tag_name,
      releaseUrl: release.html_url || releasesUrl,
      notes: typeof release.body === "string" ? release.body.slice(0, 4000) : null,
      publishedAt: release.published_at || release.created_at || null,
      assets,
      repo,
      checkedAt,
      reason: reasonFor(current || "0.0.0", latest),
    };
  }

  // Re-parse stamps from public latest if we have them embedded in release body
  // Better: store on release object when building synthetic
  const desktop = buildSurface("desktop", currentDesktop, desktopPickFinal);
  return {
    ok: true,
    ...desktop,
    desktop,
    skills: buildSurface("skills", currentSkills, skillsPickResolved),
    extension: buildSurface("extension", currentExtension, extensionPickFinal, {
      notBundled: !extensionKnown,
    }),
    releasesUrl,
    checkedAt,
    repo,
    source,
    model: {
      desktopBundlesSkills: true,
      desktopBundlesUtr: true,
      extensionIsBrowser: true,
    },
  };
}

/** Running app version from Electron when available. */
export function readRunningAppVersion() {
  try {
    const { app } = require("electron");
    return String(app.getVersion() || "0.0.0");
  } catch {
    try {
      // eslint-disable-next-line import/no-unresolved
      const pkg = require("../../package.json");
      return String(pkg.version || "0.0.0");
    } catch {
      return "0.0.0";
    }
  }
}
