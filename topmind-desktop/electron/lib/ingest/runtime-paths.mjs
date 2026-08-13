/**
 * Injected / Electron userData paths for ingest tools (sidecar + disk cache).
 * Tests set overrides; production reads Electron userData.
 */
import { createRequire } from "node:module";
import path from "node:path";

/** @type {{ userDataDir: string|null, bundledAnydocDir: string|null }} */
const override = {
  userDataDir: null,
  bundledAnydocDir: null,
};

/**
 * @param {{ userDataDir?: string|null, bundledAnydocDir?: string|null }} p
 */
export function configureIngestRuntimePaths(p = {}) {
  if (Object.prototype.hasOwnProperty.call(p, "userDataDir")) {
    override.userDataDir = p.userDataDir || null;
  }
  if (Object.prototype.hasOwnProperty.call(p, "bundledAnydocDir")) {
    override.bundledAnydocDir = p.bundledAnydocDir || null;
  }
}

export function getIngestUserDataDir() {
  if (override.userDataDir) return override.userDataDir;
  try {
    const require = createRequire(import.meta.url);
    const { app } = require("electron");
    if (app?.getPath) return app.getPath("userData");
  } catch {
    /* unit tests / no electron */
  }
  return null;
}

/** Optional extraResource fallback: `{resources}/anydoc` (re-pack to change). */
export function getBundledAnydocDir() {
  if (override.bundledAnydocDir) return override.bundledAnydocDir;
  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    return path.join(process.resourcesPath, "anydoc");
  }
  return null;
}

/** Sidecar / user-data writes must never land inside asar. */
export function isOutsideAsar(absPath) {
  const s = String(absPath || "");
  if (!s) return false;
  const asarSeg = `${path.sep}app.asar${path.sep}`;
  if (s.includes(asarSeg)) return false;
  if (s.endsWith(`${path.sep}app.asar`)) return false;
  return true;
}
