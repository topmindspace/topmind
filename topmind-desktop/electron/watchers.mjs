import path from "node:path";
import chokidar from "chokidar";
import { toWorkspaceRelativePath, workspaceWatchRoots } from "./lib/path-model.mjs";

let watcher = null;
const ignoredChanges = new Map();

function normalizePath(filePath) {
  return path.resolve(filePath);
}

function pruneIgnoredChanges() {
  const now = Date.now();
  for (const [filePath, expiresAt] of ignoredChanges.entries()) {
    if (expiresAt <= now) {
      ignoredChanges.delete(filePath);
    }
  }
}

function shouldIgnore(filePath) {
  pruneIgnoredChanges();
  return ignoredChanges.has(normalizePath(filePath));
}

export function markIgnoredFileChanges(filePaths, durationMs = 2000) {
  const expiresAt = Date.now() + durationMs;
  for (const filePath of filePaths) {
    ignoredChanges.set(normalizePath(filePath), expiresAt);
  }
}

export async function closeWorkspaceWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}

export async function startWorkspaceWatcher(rootPath, onChange, options = {}) {
  await closeWorkspaceWatcher();

  // Windows native fs events can be unreliable for network drives — use polling.
  const isWin = process.platform === "win32";
  const usePolling = options.usePolling || isWin;

  watcher = chokidar.watch(workspaceWatchRoots(rootPath), {
    ignored: [
      /(^|[\/\\])\../,
      /__pycache__/,
      /\.pyc$/,
      /node_modules/,
      /dist/,
    ],
    ignoreInitial: true,
    usePolling,
    interval: options.interval || (usePolling ? 300 : 100),
    // Stabilize rapid write bursts (editor save + temp rename cycle).
    awaitWriteFinish: usePolling
      ? { stabilityThreshold: 200, pollInterval: 50 }
      : false,
  });

  // Listen to directory events too (create/delete folders from external tools).
  for (const eventName of ["add", "change", "unlink", "addDir", "unlinkDir"]) {
    watcher.on(eventName, (absolutePath) => {
      if (shouldIgnore(absolutePath)) {
        return;
      }

      onChange({
        event: eventName,
        absolutePath: normalizePath(absolutePath),
        relativePath: toWorkspaceRelativePath(rootPath, absolutePath),
        changedAt: new Date().toISOString(),
      });
    });
  }

  await new Promise((resolve) => {
    watcher.once("ready", resolve);
  });

  return watcher;
}
