/**
 * v4 Settings — persistence shell (atomic load/save/update).
 * Pure defaults/normalize/secret policy live in lib/settings-core.mjs.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { exists } from "./lib/fs-utils.mjs";
import { logWarn } from "./lib/writeback.mjs";
import {
  AI_SOURCE_PREFERENCES,
  createDefaultAppSettings,
  mergeAppSettings,
  parseSettingsBody,
  serializeSettingsForDisk,
  overlayLiveSecrets,
  resolvePersistenceOptions,
  isObject,
  clone,
  settingsCoreTest,
} from "./lib/settings-core.mjs";

export { AI_SOURCE_PREFERENCES };
export { createDefaultAppSettings };

export const __settingsTest = {
  ...settingsCoreTest,
  // keep hydrate/read helpers used by persist tests if present
  readSettingsForMerge: null, // filled below after function def — see rebind
};

function settingsBackupPath(settingsFilePath) {
  return `${settingsFilePath}.bak`;
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

/** Remove abandoned 0-byte atomic-write temp files. */
async function cleanupStaleSettingsTemps(settingsFilePath) {
  try {
    const dir = path.dirname(settingsFilePath);
    const base = path.basename(settingsFilePath);
    const entries = await fs.readdir(dir);
    for (const name of entries) {
      if (!name.startsWith(`${base}.tmp.`)) continue;
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(full);
        if (st.size === 0) await fs.unlink(full);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Best-effort read of previous secureStorage envelope (for secret preservation). */
async function readPreviousSecureStorage(settingsFilePath) {
  try {
    if (!(await exists(settingsFilePath))) return null;
    const raw = await fs.readFile(settingsFilePath, "utf-8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return isObject(parsed?.secureStorage) ? parsed.secureStorage : null;
  } catch {
    return null;
  }
}

export async function loadAppSettings(settingsFilePath, defaultWorkspaceRoot, options = {}) {
  const defaults = createDefaultAppSettings(defaultWorkspaceRoot);
  const resolvedOptions = resolvePersistenceOptions(options);
  const bakPath = settingsBackupPath(settingsFilePath);

  const tryPath = async (filePath, label) => {
    if (!(await exists(filePath))) return null;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      if (!raw.trim()) {
        logWarn("settings", `${label} is empty`, { path: filePath });
        return null;
      }
      const parsed = parseSettingsBody(raw, defaultWorkspaceRoot, resolvedOptions.secretAdapter);
      if (!parsed) {
        logWarn("settings", `${label} is not valid JSON object`, { path: filePath });
        return null;
      }
      return parsed;
    } catch (err) {
      logWarn("settings", `${label} read failed`, {
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const primary = await tryPath(settingsFilePath, "app-settings.json");
  if (primary) return primary;

  const backup = await tryPath(bakPath, "app-settings.json.bak");
  if (backup) {
    logWarn("settings", "recovered settings from .bak after primary missing/empty/corrupt", {
      path: settingsFilePath,
    });
    try {
      await saveAppSettings(settingsFilePath, backup, options);
    } catch (err) {
      logWarn("settings", "failed to restore primary from bak", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return backup;
  }

  if (await exists(settingsFilePath)) {
    logWarn("settings", "rewriting empty/corrupt app-settings.json with defaults", {
      path: settingsFilePath,
    });
    try {
      await saveAppSettings(settingsFilePath, defaults, options);
    } catch (err) {
      logWarn("settings", "failed to rewrite defaults settings file", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return defaults;
}

/**
 * Per-settings-file write chain — prevents concurrent load→merge→save races
 * (window bounds vs Settings UI vs clip bridge vs model cache).
 * @type {Map<string, Promise<unknown>>}
 */
const settingsWriteChains = new Map();

function enqueueSettingsWrite(settingsFilePath, task) {
  const key = path.resolve(settingsFilePath);
  const prev = settingsWriteChains.get(key) || Promise.resolve();
  const next = prev.then(task, task);
  settingsWriteChains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Read-only settings load for merge under the write queue.
 * Never writes / restores — avoids deadlock with enqueueSettingsWrite.
 *
 * @returns {Promise<object|null>}
 */
async function readSettingsForMerge(settingsFilePath, defaultWorkspaceRoot, options = {}) {
  const resolvedOptions = resolvePersistenceOptions(options);
  const tryRead = async (filePath) => {
    if (!(await exists(filePath))) return null;
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      if (!raw.trim()) return null;
      return parseSettingsBody(raw, defaultWorkspaceRoot, resolvedOptions.secretAdapter);
    } catch {
      return null;
    }
  };
  const primary = await tryRead(settingsFilePath);
  if (primary) return primary;
  return tryRead(settingsBackupPath(settingsFilePath));
}

__settingsTest.readSettingsForMerge = readSettingsForMerge;

/**
 * Unlocked atomic write (must only run inside enqueueSettingsWrite).
 */
async function saveAppSettingsUnlocked(settingsFilePath, settings, options = {}) {
  if (!isObject(settings)) {
    throw new Error("saveAppSettings requires a settings object.");
  }
  const resolvedOptions = resolvePersistenceOptions(options);
  await ensureParentDir(settingsFilePath);
  const previousSecure = await readPreviousSecureStorage(settingsFilePath);
  const persisted = serializeSettingsForDisk(
    settings,
    resolvedOptions.secretAdapter,
    previousSecure,
  );
  const body = `${JSON.stringify(persisted, null, 2)}\n`;
  if (!body.trim() || body.trim() === "null" || body.trim() === "{}") {
    if (body.trim() === "null" || !body.trim()) {
      throw new Error("refuse to write empty settings payload");
    }
  }
  if (body.length < 20) {
    throw new Error(`refuse to write suspiciously small settings payload (${body.length} bytes)`);
  }

  const tmpPath = `${settingsFilePath}.tmp.${process.pid}.${Date.now()}`;
  const bakPath = settingsBackupPath(settingsFilePath);
  await fs.writeFile(tmpPath, body, "utf-8");
  try {
    const fh = await fs.open(tmpPath, "r+");
    try { await fh.sync(); } finally { await fh.close(); }
  } catch { /* sync optional */ }

  try {
    if (await exists(settingsFilePath)) {
      const prev = await fs.readFile(settingsFilePath, "utf-8");
      if (prev.trim().length >= 20) {
        await fs.writeFile(bakPath, prev, "utf-8");
      }
    }
  } catch { /* bak is best-effort */ }

  await fs.rename(tmpPath, settingsFilePath);
  void cleanupStaleSettingsTemps(settingsFilePath);
  return settings;
}

/**
 * Atomic settings write: temp → fsync → rename.
 * Keeps a .bak of the previous good primary so crash mid-write is recoverable.
 * Never writes an empty payload (guards against silent 0-byte corruption).
 */
export async function saveAppSettings(settingsFilePath, settings, options = {}) {
  return enqueueSettingsWrite(settingsFilePath, () =>
    saveAppSettingsUnlocked(settingsFilePath, settings, options),
  );
}

/**
 * Patch settings under the per-file write chain.
 *
 * Inside the lock we **re-read disk** as structural base so concurrent callers
 * cannot clobber each other's patches. Non-empty secrets from `currentSettings`
 * overlay empty disk fields so in-process keys are not lost.
 */
export async function updateAppSettings(settingsFilePath, currentSettings, patch, options = {}) {
  return enqueueSettingsWrite(settingsFilePath, async () => {
    const defaultRoot =
      (isObject(currentSettings) && typeof currentSettings.workspaceRoot === "string"
        ? currentSettings.workspaceRoot
        : "") || "";
    let base = await readSettingsForMerge(settingsFilePath, defaultRoot, options);
    if (!base) {
      base = isObject(currentSettings)
        ? clone(currentSettings)
        : createDefaultAppSettings(defaultRoot);
    } else if (isObject(currentSettings)) {
      base = overlayLiveSecrets(base, currentSettings);
    }
    const next = mergeAppSettings(base, patch || {}, { strictValidation: true });
    return saveAppSettingsUnlocked(settingsFilePath, next, options);
  });
}
