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
 *   - SHA256SUMS verified when available
 *   - Temp files cleaned up on success or failure
 *   - No auto-execution of downloaded content
 */
import { promises as fs, existsSync, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DEFAULT_REPO = "topmindspace/topmind";
const DOWNLOAD_TIMEOUT_MS = 120_000; // 2 minutes for large files

/**
 * Asset name patterns for each surface.
 * @type {Record<string, (ver: string) => string>}
 */
const ASSET_PATTERNS = {
  skills: (ver) => `topmind-skills-${ver}.zip`,
  obsidian: (ver) => `topmind-obsidian-${ver}.zip`,
  extension: (ver) => `topmind-clip-extension-${ver}.zip`,
};

/**
 * SHA256SUMS file name pattern for each surface.
 * @type {Record<string, (ver: string) => string>}
 */
const SUMS_PATTERNS = {
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
 * Verify a downloaded file against a SHA256SUMS file.
 *
 * @param {string} zipPath - downloaded file path
 * @param {string} sumsPath - SHA256SUMS file path
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function verifySha256(zipPath, sumsPath) {
  if (!existsSync(sumsPath)) {
    // No sums file — skip verification (log warning)
    return { ok: true, error: "no-sums-file" };
  }

  try {
    const sumsContent = await fs.readFile(sumsPath, "utf8");
    const fileName = path.basename(zipPath);

    // Find the line matching our file
    const lines = sumsContent.trim().split("\n");
    let expectedHash = null;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[1].includes(fileName)) {
        expectedHash = parts[0];
        break;
      }
    }

    if (!expectedHash) {
      return { ok: true, error: "file-not-in-sums" };
    }

    // Compute actual hash
    const { spawnSync: spawn } = require("node:child_process");
    const hashResult = spawn("shasum", ["-a", "256", zipPath], {
      encoding: "utf8",
      timeout: 30_000,
    });

    let actualHash = null;
    if (hashResult.status === 0 && hashResult.stdout) {
      actualHash = hashResult.stdout.trim().split(/\s+/)[0];
    } else {
      // Fallback: sha256sum on Linux
      const altResult = spawn("sha256sum", [zipPath], {
        encoding: "utf8",
        timeout: 30_000,
      });
      if (altResult.status === 0 && altResult.stdout) {
        actualHash = altResult.stdout.trim().split(/\s+/)[0];
      }
    }

    if (!actualHash) {
      return { ok: false, error: "hash-computation-failed" };
    }

    if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return { ok: false, error: `hash-mismatch: expected ${expectedHash}, got ${actualHash}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Download a companion package from GitHub Releases.
 *
 * @param {object} opts
 * @param {string} opts.surface - "skills" | "obsidian" | "extension"
 * @param {string} opts.version - target version (e.g. "2.9.1")
 * @param {string} opts.tag - release tag (e.g. "skills-v2.9.1" or "v2.9.0")
 * @param {string} [opts.repo] - GitHub repo (default: topmindspace/topmind)
 * @param {typeof fetch} [opts.fetchImpl] - inject for testing
 * @param {string} [opts.tempDir] - temp directory for downloads
 * @returns {Promise<{ ok: boolean, zipPath?: string, error?: string }>}
 */
export async function downloadCompanionAsset(opts) {
  const { surface, version, tag } = opts;
  if (!surface || !version || !tag) {
    return { ok: false, error: "surface, version, and tag are required" };
  }

  const repo = opts.repo || DEFAULT_REPO;
  const pattern = ASSET_PATTERNS[surface];
  if (!pattern) {
    return { ok: false, error: `unknown surface: ${surface}` };
  }

  const assetName = pattern(version);
  const sumsName = SUMS_PATTERNS[surface]?.(version);
  const baseUrl = `https://github.com/${repo}/releases/download/${tag}`;
  const assetUrl = `${baseUrl}/${assetName}`;
  const sumsUrl = sumsName ? `${baseUrl}/${sumsName}` : null;

  // Create temp dir
  const tempDir = opts.tempDir || path.join(os.tmpdir(), `topmind-companion-${surface}-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const zipPath = path.join(tempDir, assetName);
  const sumsPath = sumsName ? path.join(tempDir, sumsName) : null;

  try {
    // Download asset
    const dlResult = await downloadFile(assetUrl, zipPath, { fetchImpl: opts.fetchImpl });
    if (!dlResult.ok) {
      return { ok: false, error: `download failed: ${dlResult.error}` };
    }

    // Download SHA256SUMS (optional, for verification)
    if (sumsUrl && sumsPath) {
      const sumsResult = await downloadFile(sumsUrl, sumsPath, { fetchImpl: opts.fetchImpl });
      if (sumsResult.ok) {
        const verifyResult = await verifySha256(zipPath, sumsPath);
        if (!verifyResult.ok) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          return { ok: false, error: `verification failed: ${verifyResult.error}` };
        }
      }
      // If sums download fails, proceed without verification (user-facing warning)
    }

    return { ok: true, zipPath, tempDir };
  } catch (err) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
