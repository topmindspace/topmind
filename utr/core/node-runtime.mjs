/**
 * Resolve a safe Node.js executable for UTR tool/doctor subprocesses.
 *
 * Inside Electron main, `process.execPath` is the Electron binary. Spawning it
 * without ELECTRON_RUN_AS_NODE creates a new app instance (extra Dock icon /
 * blank window on macOS). Always use this helper before execFile.
 *
 * Resolution order:
 *   1. topmind_NODE_RUNTIME (dev-electron.mjs sets host Node)
 *   2. `node` on PATH
 *   3. process.execPath + ELECTRON_RUN_AS_NODE=1 (packaged fallback)
 */
import { spawnSync } from "node:child_process";

let _nodeExecutable = null;

export function resolveNodeExecutable() {
  if (_nodeExecutable !== null) return _nodeExecutable;

  if (process.env.topmind_NODE_RUNTIME) {
    _nodeExecutable = process.env.topmind_NODE_RUNTIME;
    return _nodeExecutable;
  }

  try {
    const lookupCmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookupCmd, ["node"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    });
    const found = result.stdout?.trim();
    if (found) {
      _nodeExecutable = found.split("\n")[0].trim();
      return _nodeExecutable;
    }
  } catch {
    /* non-fatal */
  }

  _nodeExecutable = process.execPath || "node";
  return _nodeExecutable;
}

/** Reset cache (tests only). */
export function resetNodeExecutableCache() {
  _nodeExecutable = null;
}

/** True when exe is Electron (needs ELECTRON_RUN_AS_NODE). */
export function isElectronExecutable(exe) {
  return /[/\\]Electron\.app[/\\]|[\\/]electron(\.exe)?$/i.test(String(exe || ""));
}

/**
 * execFile options for UTR scripts — injects ELECTRON_RUN_AS_NODE when needed.
 * @param {object} [base]
 */
export function nodeExecFileOptions(base = {}) {
  const executable = resolveNodeExecutable();
  const opts = {
    maxBuffer: 1024 * 1024 * 6,
    timeout: 120_000,
    ...base,
  };
  if (isElectronExecutable(executable)) {
    opts.env = { ...(base.env || process.env), ELECTRON_RUN_AS_NODE: "1" };
  }
  return { executable, opts };
}
