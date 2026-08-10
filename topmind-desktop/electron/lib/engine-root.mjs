/**
 * Resolve topmind engine root for both monorepo dev and packaged Desktop.
 *
 * Layouts:
 * - Dev monorepo: {repo}/ with skills/ + topmind-desktop/ (+ templates/, lib/)
 * - Packaged: process.resourcesPath/topmind-engine/ with templates/ + lib/ (+ skills/ optional)
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Classic monorepo engine: skills + topmind-desktop (utr optional). */
export function isClassicEngineRoot(root) {
  const r = path.resolve(root);
  return existsSync(path.join(r, "skills")) && existsSync(path.join(r, "topmind-desktop"));
}

/** Portable / packaged engine: templates (+ lib preferred). */
export function isPortableEngineRoot(root) {
  const r = path.resolve(root);
  return existsSync(path.join(r, "templates"));
}

export function isValidEngineRoot(root) {
  return isClassicEngineRoot(root) || isPortableEngineRoot(root);
}

/**
 * Default engine candidate before validation.
 * Packaged Electron → resources/topmind-engine
 * Dev → monorepo parent of topmind-desktop
 */
export function defaultEngineCandidate() {
  try {
    const { app } = require("electron");
    if (app?.isPackaged && process.resourcesPath) {
      return path.join(process.resourcesPath, "topmind-engine");
    }
  } catch {
    // Not in Electron main process (tests) — fall through
  }
  // monorepo: topmind-desktop/ → parent topmind/
  return path.resolve(desktopRoot, "..");
}

export function desktopAppRoot() {
  return desktopRoot;
}
