/**
 * Companion inline download + install — download newer companion packages
 * from GitHub Releases and install them locally, replacing the bundled version.
 *
 * Surfaces:
 *   skills    → topmind-skills-<ver>.zip  (install to managed skills-extra root)
 *   obsidian  → topmind-obsidian-<ver>.zip  (install to vault plugins dir)
 *   extension → topmind-clip-extension-<ver>.zip  (extract to managed dir)
 *
 * Flow:
 *   1. checkForUpdates() detects a newer version on GitHub
 *   2. downloadCompanionAsset(surface) fetches the zip to a temp file
 *   3. installDownloadedCompanion(surface, zipPath) extracts + installs
 *   4. Status bar badge clears when all surfaces are up to date
 *
 * Security:
 *   - Downloads only from github.com/{repo}/releases/download/{tag}/
 *   - GitHub asset digest or SHA256SUMS is required (uses Node.js crypto, cross-platform)
 *   - Temp files cleaned up on success or failure
 *   - No auto-execution of downloaded content
 */
import { promises as fs, existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_REPO = "topmindspace/topmind";
/** Per-surface GitHub repos after the three-repo split. */
export const SURFACE_REPOS = {
  skills: "topmindspace/topmind-skills",
  obsidian: "topmindspace/topmind-obsidian",
  extension: "topmindspace/topmind",
  desktop: "topmindspace/topmind",
  writing: "topmindspace/topmind-writing-skills",
};
const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes for large files

/**
 * Asset name patterns for each surface.
 * Obsidian community-plugin releases ship bare main.js / manifest.json /
 * styles.css (no versioned zip) — downloadCompanionAsset falls back to that
 * three-file set when the zip 404s.
 * @type {Record<string, (ver: string) => string>}
 */
const ASSET_PATTERNS = {
  writing: (ver) => `topmind-writing-skills-${ver}.zip`,
  skills: (ver) => `topmind-skills-${ver}.zip`,
  obsidian: (ver) => `topmind-obsidian-${ver}.zip`,
  extension: (ver) => `topmind-clip-extension-${ver}.zip`,
};

/** Community-plugin loose files (Obsidian community catalog layout). */
const OBSIDIAN_COMMUNITY_FILES = ["main.js", "manifest.json", "styles.css"];

/**
 * SHA256SUMS file name pattern for each surface.
 * @type {Record<string, (ver: string) => string>}
 */
const SUMS_PATTERNS = {
  writing: (ver) => `topmind-writing-skills-${ver}.SHA256SUMS`,
  skills: (ver) => `topmind-skills-${ver}.SHA256SUMS`,
  obsidian: (ver) => `topmind-obsidian-${ver}.SHA256SUMS`,
  extension: (ver) => `topmind-clip-extension-${ver}.SHA256SUMS`,
};

/**
 * Download a file from a URL to a local path with progress and timeout.
 *
 * @param {string} url - download URL
 * @param {string} destPath - local file path
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, size?: number, error?: string }>}
 */
export async function downloadFile(url, destPath, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || DOWNLOAD_TIMEOUT_MS;

  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
      headers: { Accept: "application/octet-stream" },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }

    // Handle null/missing body (some fetch impls or 204 responses)
    if (!res.body) {
      return { ok: false, error: "response body is null — possibly a redirect issue" };
    }

    // Stream to file
    const fileStream = createWriteStream(destPath);
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
    }
    await new Promise((resolve, reject) => {
      fileStream.end(resolve);
      fileStream.on("error", reject);
    });

    const stat = await fs.stat(destPath);
    if (stat.size === 0) {
      return { ok: false, error: "downloaded file is empty (0 bytes)" };
    }
    return { ok: true, size: stat.size };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Compute SHA-256 hash of a file using Node.js built-in crypto.
 * Cross-platform — no external commands needed (fixes hash-computation-failed
 * on Windows / systems without shasum or sha256sum).
 *
 * @param {string} filePath - path to file to hash
 * @returns {Promise<string>} hex digest
 */
async function computeSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    let offset = 0;
    while (true) {
      const { bytesRead, buffer } = await handle.read(
        Buffer.allocUnsafe(CHUNK_SIZE),
        0,
        CHUNK_SIZE,
        offset,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/**
 * Verify a downloaded file against a SHA256SUMS file.
 *
 * Uses Node.js built-in crypto for cross-platform compatibility
 * (no dependency on external shasum/sha256sum commands).
 *
 * @param {string} zipPath - downloaded file path
 * @param {string} sumsPath - SHA256SUMS file path
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifySha256(zipPath, sumsPath) {
  if (!existsSync(sumsPath)) {
    // Never treat missing integrity metadata as verified.
    return { ok: false, error: "no-sums-file" };
  }

  try {
    const sumsContent = await fs.readFile(sumsPath, "utf8");
    const fileName = path.basename(zipPath);

    // Find the line matching our file
    const lines = sumsContent.trim().split("\n");
    let expectedHash = null;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[1].replace(/^\*/u, "") === fileName) {
          if (!/^[a-f0-9]{64}$/iu.test(parts[0])) return { ok: false, error: "invalid checksum" };
        expectedHash = parts[0];
        break;
      }
    }

    if (!expectedHash) {
      return { ok: false, error: "file-not-in-sums" };
    }

    // Compute actual hash using Node.js crypto (cross-platform, no external deps)
    const actualHash = await computeSha256(zipPath);

    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return { ok: false, error: `hash-mismatch: expected ${expectedHash}, got ${actualHash}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function listedAssets(opts) {
  return (Array.isArray(opts.assets) ? opts.assets : [])
    .filter((a) => a && a.name && (a.url || a.browser_download_url))
    .map((a) => ({
      name: String(a.name),
      url: String(a.url || a.browser_download_url),
      digest: a.digest || null,
    }));
}

function isCommunitySet(files) {
  const names = new Set(files.map((a) => a.name));
  return OBSIDIAN_COMMUNITY_FILES.every((name) => names.has(name));
}

async function failDownload(tempDir, error) {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  return { ok: false, error, claimedLatest: false };
}

/**
 * Download a companion package from GitHub Releases.
 *
 * When `assets` is provided (the update check's real file list), only those
 * URLs are fetched. A missing Obsidian zip is not invented. A 404 or hash
 * mismatch returns ok: false and deletes the temp dir.
 *
 * @param {object} opts
 * @param {string} opts.surface - "skills" | "obsidian" | "extension"
 * @param {string} opts.version - target version (e.g. "2.9.1")
 * @param {string} opts.tag - release tag (e.g. "skills-v2.9.1" or "v2.9.0")
 * @param {string} [opts.repo] - GitHub repo (default: per-surface sister repo)
 * @param {Array<{ name?: string, url?: string, browser_download_url?: string }>} [opts.assets]
 * @param {typeof fetch} [opts.fetchImpl] - inject for testing
 * @param {string} [opts.tempDir] - temp directory for downloads
 * @returns {Promise<{ ok: boolean, zipPath?: string|null, packageDir?: string, tempDir?: string, error?: string, claimedLatest?: boolean }>}
 */
export async function downloadCompanionAsset(opts) {
  const { surface, version, tag } = opts;
  if (!surface || !version || !tag) {
    return { ok: false, error: "surface, version, and tag are required", claimedLatest: false };
  }
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(version) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(tag)) return { ok: false, error: "invalid release version or tag", claimedLatest: false };

  const repo = opts.repo || SURFACE_REPOS[surface] || DEFAULT_REPO;
  const pattern = ASSET_PATTERNS[surface];
  if (!pattern) {
    return { ok: false, error: `unknown surface: ${surface}`, claimedLatest: false };
  }

  const tempDir = opts.tempDir || path.join(os.tmpdir(), `topmind-companion-${surface}-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const listed = listedAssets(opts);
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;
  const verifyDigest = async (file, digest) => {
    if (!/^sha256:[a-f0-9]{64}$/iu.test(String(digest || ""))) return false;
    return (await computeSha256(file)).toLowerCase() === digest.slice(7).toLowerCase();
  };

  try {
    for (const asset of listed) {
      if (path.basename(asset.name) !== asset.name || asset.name.includes("\\") || !asset.url.startsWith(`${baseUrl}/`)) return failDownload(tempDir, "asset is outside the selected release");
    }
    if (surface === "obsidian" && listed.length && isCommunitySet(listed) && !listed.some((a) => /\.zip$/i.test(a.name))) {
      const pkgDir = path.join(tempDir, "package");
      await fs.mkdir(pkgDir, { recursive: true });
      for (const name of OBSIDIAN_COMMUNITY_FILES) {
        const file = listed.find((a) => a.name === name);
        const result = await downloadFile(file.url, path.join(pkgDir, name), { fetchImpl: opts.fetchImpl });
        if (!result.ok) {
          return failDownload(tempDir, `download failed: ${result.error}`);
        }
        if (!await verifyDigest(path.join(pkgDir, name), file.digest)) return failDownload(tempDir, `missing or invalid asset digest: ${name}`);
      }
      return { ok: true, zipPath: null, packageDir: pkgDir, tempDir, claimedLatest: false };
    }

    /** @type {{ name: string, url: string }|null} */
    let archive = null;
    if (listed.length) {
      archive =
        listed.find((a) => a.name.endsWith(".zip")) ||
        listed.find((a) => /\.(tar\.gz|tgz)$/i.test(a.name)) ||
        null;
      if (!archive) {
        return failDownload(tempDir, "download failed: release has no installable asset");
      }
    } else {
      const assetName = pattern(version);
      archive = { name: assetName, url: `${baseUrl}/${assetName}` };
    }

    const archivePath = path.join(tempDir, archive.name);
    const dlResult = await downloadFile(archive.url, archivePath, { fetchImpl: opts.fetchImpl });
    if (!dlResult.ok) {
      return failDownload(tempDir, `download failed: ${dlResult.error}`);
    }

    if (archive.digest) {
      if (!await verifyDigest(archivePath, archive.digest)) return failDownload(tempDir, "asset digest verification failed");
      return { ok: true, zipPath: archivePath, tempDir, claimedLatest: false };
    }
    const sumsName = SUMS_PATTERNS[surface]?.(version);
    const sumsFromList = listed.find((a) => /sha256/i.test(a.name));
    const sumsUrl = sumsFromList?.url || (sumsName ? `${baseUrl}/${sumsName}` : null);
    if (sumsUrl) {
      const sumsPath = path.join(tempDir, sumsName || path.basename(sumsUrl));
      const sumsResult = await downloadFile(sumsUrl, sumsPath, { fetchImpl: opts.fetchImpl });
      if (!sumsResult.ok) return failDownload(tempDir, "component checksum is required");
      if (sumsResult.ok) {
        const verifyResult = await verifySha256(archivePath, sumsPath);
        if (!verifyResult.ok) {
          return failDownload(tempDir, `verification failed: ${verifyResult.error}`);
        }
      }
    }

    return { ok: true, zipPath: archivePath, tempDir, claimedLatest: false };
  } catch (err) {
    return failDownload(tempDir, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Download, hand the files to `consumer`, and always delete the temp dir.
 * A failed download does not call the consumer and does not report success.
 *
 * @param {object} opts downloadCompanionAsset options
 * @param {(dl: { ok: true, zipPath?: string|null, packageDir?: string, tempDir?: string }) => Promise<any>} consumer
 */
export async function withCompanionDownload(opts, consumer) {
  const dl = await downloadCompanionAsset(opts);
  if (!dl.ok) return dl;
  try {
    const result = await consumer(dl);
    return result;
  } finally {
    if (dl.tempDir) await cleanupDownloadTemp(dl.tempDir);
  }
}

/**
 * Clean up a downloaded companion package temp directory.
 *
 * @param {string} tempDir - temp directory path
 */
export async function cleanupDownloadTemp(tempDir) {
  if (!tempDir) return;
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
