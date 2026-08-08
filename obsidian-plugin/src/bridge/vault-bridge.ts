// ── Vault Bridge: Obsidian Vault ↔ topmind workspace path mapping ──────────
//
// Obsidian Vault root = topmind workspace root.
// The Kernel engines use `import fs from "node:fs"` to access the file
// system directly, which works because Obsidian desktop runs in an
// Electron renderer with Node.js integration.
// esbuild platform:'node' keeps these as external require() calls.

import type { App } from "obsidian";
import fs from "node:fs";
import path from "node:path";

/**
 * Get the absolute path of the Obsidian Vault root (= topmind workspace root).
 * Uses the internal adapter's getBasePath() which is available on desktop.
 */
export function getVaultBasePath(app: App): string {
  // @ts-expect-error — getBasePath is internal but stable on desktop
  const basePath = app.vault.adapter.getBasePath?.();
  if (typeof basePath === "string" && basePath.length > 0) {
    return basePath;
  }
  throw new Error(
    "Cannot resolve vault base path. This plugin requires Obsidian desktop (Electron).",
  );
}

/**
 * Check if the vault has a topmind workspace structure (topmind.yaml).
 */
export function isTopmindWorkspace(app: App): boolean {
  try {
    const basePath = getVaultBasePath(app);
    return fs.existsSync(path.join(basePath, "topmind.yaml"));
  } catch {
    return false;
  }
}

/**
 * Get the engine root for template loading.
 * In the Obsidian plugin, the engine root is the plugin's directory,
 * where templates/ are copied alongside main.js.
 */
export function getEngineRoot(plugin: { manifest: { dir?: string } }): string {
  // plugin.manifest.dir is set by Obsidian to the plugin's absolute path
  return plugin.manifest.dir || "";
}
