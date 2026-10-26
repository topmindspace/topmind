/**
 * Install replace + installer handoff decisions.
 *
 * Pure decisions stay free of GitHub and process spawns so tests can drive them.
 * The filesystem helper stages a complete tree beside the live one and swaps
 * only after that copy finishes. A locked or failed write leaves the previous
 * tree in place and never kills another app.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateArchive } from "./archive-guard.mjs";

/**
 * Desktop installer handoff while this topmind process is the one running.
 * Confirm quits only this process. Cancel does not report an update.
 * Never targets Obsidian, agent hosts, or every electron.exe.
 *
 * @param {{ running?: boolean, confirmed?: boolean }} [input]
 * @returns {{ action: "prompt"|"handoff"|"cancel", quitTarget: "self"|null, reportUpdate: false, killOthers: false }}
 */
export function decideDesktopInstallerHandoff(input = {}) {
  const running = input.running !== false;
  if (!running) {
    return { action: "handoff", quitTarget: null, reportUpdate: false, killOthers: false };
  }
  if (input.confirmed !== true) {
    return { action: "prompt", quitTarget: null, reportUpdate: false, killOthers: false };
  }
  return { action: "handoff", quitTarget: "self", reportUpdate: false, killOthers: false };
}

/**
 * Obsidian or a skills host holds the target files.
 * Stop with a close-and-retry prompt. Do not kill that process and do not remove the install.
 *
 * @param {{ locked?: boolean, owner?: string|null }} [input]
 */
export function decideLockedWrite(input = {}) {
  if (!input.locked) {
    return { action: "swap", kill: false, removeExisting: false, reason: null, owner: null };
  }
  return {
    action: "prompt-close",
    kill: false,
    removeExisting: false,
    reason: "close-app-and-retry",
    owner: input.owner || null,
  };
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy `src` to a sibling staging directory, then swap it into `dest`.
 * If the copy or the swap fails, `dest` bytes stay as they were.
 *
 * @param {string} src
 * @param {string} dest
 * @param {{
 *   trashDir?: string|null,
 *   probeLock?: (dest: string) => Promise<{ locked?: boolean, owner?: string|null }|null>,
 *   copyImpl?: (src: string, dest: string) => Promise<void>,
 *   renameImpl?: (from: string, to: string) => Promise<void>,
 * }} [opts]
 */
export async function replacePathAtomic(src, dest, opts = {}) {
  const probe = opts.probeLock || (async () => ({ locked: false }));
  const lock = await probe(dest);
  const decision = decideLockedWrite({ locked: Boolean(lock?.locked), owner: lock?.owner || null });
  if (decision.action === "prompt-close") {
    return {
      ok: false,
      reason: "close-app-and-retry",
      promptClose: true,
      kill: false,
      removeExisting: false,
      owner: decision.owner,
      error: "target files are in use — close the app and retry",
    };
  }

  const staging = `${dest}.topmind-staging`;
  await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  const copy = opts.copyImpl || (async (from, to) => {
    await fs.cp(from, to, { recursive: true, force: true });
  });
  try {
    await copy(src, staging);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      reason: "copy-failed",
      promptClose: false,
      kill: false,
      removeExisting: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const rename = opts.renameImpl || ((from, to) => fs.rename(from, to));
  const hadDest = await pathExists(dest);
  /** @type {string|null} */
  let parked = null;
  if (hadDest) {
    if (opts.trashDir) {
      await fs.mkdir(opts.trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      parked = path.join(opts.trashDir, `${path.basename(dest)}-${stamp}`);
    } else {
      parked = `${dest}.topmind-previous`;
      await fs.rm(parked, { recursive: true, force: true }).catch(() => {});
    }
    try {
      await rename(dest, parked);
    } catch (err) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        reason: "close-app-and-retry",
        promptClose: true,
        kill: false,
        removeExisting: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    await rename(staging, dest);
  } catch (err) {
    if (hadDest && parked) {
      await rename(parked, dest).catch(() => {});
    }
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      reason: "close-app-and-retry",
      promptClose: true,
      kill: false,
      removeExisting: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (hadDest && parked && !opts.trashDir) {
    await fs.rm(parked, { recursive: true, force: true }).catch(() => {});
  }
  return { ok: true, parked };
}

/**
 * Unpack a zip or tar.gz.
 * Windows does not require `unzip` on PATH. A zip uses Expand-Archive.
 * A .tar.gz uses `tar` (tar.exe on Windows). Expand-Archive cannot read tar.gz.
 * `spawnImpl` is injectable so tests can prove the Windows branch without a Windows host.
 *
 * @param {string} archivePath
 * @param {string} destDir
 * @param {{
 *   platform?: string,
 *   unzipOnPath?: boolean,
 *   spawnImpl?: (cmd: string, args: string[]) => boolean|Promise<boolean>,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, via?: string, error?: string }>}
 */
export async function unpackArchive(archivePath, destDir, opts = {}) {
  const inspected = await validateArchive(archivePath);
  if (!inspected.ok) return inspected;
  await fs.mkdir(destDir, { recursive: true });
  const platform = opts.platform || process.platform;
  const abs = path.resolve(archivePath);
  const dest = path.resolve(destDir);
  const spawnImpl = opts.spawnImpl || ((cmd, args) => {
    try {
      const result = spawnSync(cmd, args, { encoding: "utf8" });
      return result.status === 0;
    } catch {
      return false;
    }
  });
  const unzipOnPath = opts.unzipOnPath !== undefined ? Boolean(opts.unzipOnPath) : platform !== "win32";
  const isTar = /\.(tar\.gz|tgz)$/i.test(abs);

  if (!isTar && unzipOnPath) {
    if (await spawnImpl("unzip", ["-q", abs, "-d", dest])) {
      return { ok: true, via: "unzip" };
    }
  }
  // tar.gz is not a zip. Expand-Archive fails it, including on win32.
  if (isTar || platform !== "win32") {
    if (await spawnImpl("tar", ["-xf", abs, "-C", dest])) {
      return { ok: true, via: "tar" };
    }
    if (isTar) {
      return {
        ok: false,
        error: "failed to extract tar.gz (tar is required; Expand-Archive does not read tar.gz)",
      };
    }
  }
  if (platform === "win32") {
    const ps = `Expand-Archive -LiteralPath '${abs.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`;
    if (await spawnImpl("powershell.exe", ["-NoProfile", "-Command", ps])) {
      return { ok: true, via: "powershell" };
    }
  }
  return {
    ok: false,
    error: "failed to extract archive (Windows uses PowerShell Expand-Archive for zip when unzip is absent, and tar for tar.gz)",
  };
}
