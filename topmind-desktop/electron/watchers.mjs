import path from "node:path";
import { realpathSync } from "node:fs";
import chokidar from "chokidar";
import { toWorkspaceRelativePath, workspaceWatchRoots, absWorkspaceRoot } from "./lib/path-model.mjs";
import {
  loadVaultIgnoreSync,
  pathMatchesUserIgnore,
  shouldSkipVaultDirName,
} from "./lib/file-filter.mjs";
import { isEscapingSymlinkSync } from "./lib/path-safety.mjs";
import { logError } from "./lib/writeback.mjs";
import {
  forgetDesktopOwned,
  registerDesktopOwned,
} from "./lib/runtime-bounds.mjs";

let watcher = null;
const WATCHER_OWNED_ID = "workspace-watcher";

function normalizePath(filePath) {
  return path.resolve(filePath);
}

/**
 * EMFILE / ENFILE from fs.watch is a full descriptor table, not a dead process.
 * The crash dialog must not treat it as a fatal unhandledRejection.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRecoverableWatcherError(error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  if (code === "EMFILE" || code === "ENFILE") return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /EMFILE|ENFILE|too many open files/iu.test(msg);
}

/**
 * A path is inside when it is the root or a relative child.
 * `..` and absolute results are outside.
 * @param {string} rel
 * @returns {boolean}
 */
function isInsideRelative(rel) {
  if (!rel || rel === ".") return true;
  if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`)) return false;
  return true;
}

/**
 * macOS aliases `/var` to `/private/var`. Compare against both spellings so a
 * note is not treated as outside the vault.
 * @param {string} root
 * @param {string} realRoot
 * @param {string} abs
 * @returns {string}
 */
function vaultRelative(root, realRoot, abs) {
  const first = path.relative(root, abs);
  if (isInsideRelative(first)) return first;
  if (realRoot !== root) {
    const second = path.relative(realRoot, abs);
    if (isInsideRelative(second)) return second;
  }
  return first;
}

/**
 * Chokidar ignore predicate. Returning true for a directory stops descent.
 * `followSymlinks` is false; an escaping link is still ignored so a direct
 * watch on that path cannot `fs.watch` the target.
 * @param {string} workspaceRoot
 * @returns {(filePath: string, stats?: { isSymbolicLink?: () => boolean }) => boolean}
 */
export function createWorkspaceWatchIgnored(workspaceRoot) {
  const root = absWorkspaceRoot(workspaceRoot);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    /* root may not exist yet */
  }
  const filters = loadVaultIgnoreSync(root);
  return (filePath, stats) => {
    const abs = path.resolve(String(filePath || ""));
    const rel = vaultRelative(root, realRoot, abs);
    // Only the vault-relative path. An ancestor named `dist` or `.app`
    // outside the workspace must not hide the whole vault.
    if (!rel || rel === ".") return false;
    if (!isInsideRelative(rel)) return true;
    const relPosix = rel.split(path.sep).join("/");
    for (const part of relPosix.split("/")) {
      if (!part) continue;
      if (shouldSkipVaultDirName(part)) return true;
    }
    if (pathMatchesUserIgnore(relPosix, filters)) return true;
    if (stats && typeof stats.isSymbolicLink === "function" && stats.isSymbolicLink()) {
      return isEscapingSymlinkSync(root, abs);
    }
    return false;
  };
}

/** Test hook: deliver an error the same way chokidar does. */
export function emitWatcherErrorForTest(error) {
  if (watcher) watcher.emit("error", error);
}

export async function closeWorkspaceWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
  forgetDesktopOwned(WATCHER_OWNED_ID);
}

export async function startWorkspaceWatcher(rootPath, onChange, options = {}) {
  await closeWorkspaceWatcher();

  // Windows native fs events can be unreliable for network drives — use polling.
  const isWin = process.platform === "win32";
  const usePolling = options.usePolling || isWin;

  const watchRoot = absWorkspaceRoot(rootPath);
  let watchRealRoot = watchRoot;
  try {
    watchRealRoot = realpathSync(watchRoot);
  } catch {
    /* root may not exist yet */
  }

  watcher = chokidar.watch(workspaceWatchRoots(rootPath), {
    ignored: createWorkspaceWatchIgnored(rootPath),
    // Never follow a symlink out of the vault. The crash path was
    // `_tool/mnt/<space>` → /Applications, then one fs.watch per framework.
    followSymlinks: false,
    ignoreInitial: true,
    usePolling,
    interval: options.interval || (usePolling ? 300 : 100),
    // Stabilize rapid write bursts (editor save + temp rename cycle).
    awaitWriteFinish: usePolling
      ? { stabilityThreshold: 200, pollInterval: 50 }
      : false,
  });

  watcher.on("error", (error) => {
    const recoverable = isRecoverableWatcherError(error);
    logError("watcher", recoverable ? "watcher degraded" : "watcher error", {
      error: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : "",
    });
    if (typeof options.onError === "function") {
      try {
        options.onError(error, { recoverable });
      } catch {
        /* caller logging must not rethrow into the watcher */
      }
    }
    if (recoverable) {
      void closeWorkspaceWatcher();
    }
  });

  // Listen to directory events too (create/delete folders from external tools).
  for (const eventName of ["add", "change", "unlink", "addDir", "unlinkDir"]) {
    watcher.on(eventName, (absolutePath) => {
      const absolute = normalizePath(absolutePath);
      let relativePath = toWorkspaceRelativePath(rootPath, absolute);
      if (!isInsideRelative(relativePath.split("/").join(path.sep)) && relativePath !== "") {
        const alt = vaultRelative(watchRoot, watchRealRoot, absolute).split(path.sep).join("/");
        if (isInsideRelative(alt.split("/").join(path.sep))) relativePath = alt;
      }
      onChange({
        event: eventName,
        absolutePath: absolute,
        relativePath,
        changedAt: new Date().toISOString(),
      });
    });
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    watcher.once("ready", finish);
    // EMFILE during the initial scan must not leave workspace open hanging.
    watcher.once("error", finish);
  });

  registerDesktopOwned({
    kind: "watcher",
    id: WATCHER_OWNED_ID,
    token: typeof rootPath === "string" ? rootPath : "workspace",
  });

  return watcher;
}
