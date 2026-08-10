// ── YAML resolution bridge (asar-aware) ───────────────────────────────────
// Engine lib/ lives in extraResources (outside asar) when packaged by
// electron-builder.  Node.js ESM bare-import resolution (import { … } from
// "yaml") cannot find packages in the asar's node_modules because the asar is
// not on the resolution path for extraResources files.
//
// This bridge uses createRequire with a fallback chain:
//   1. createRequire(import.meta.url) — works in dev / UTR / monorepo
//   2. createRequire(asar/package.json)  — works in packaged Electron
//
// electron-builder strips node_modules/ from extraResources, so we cannot
// stage a local node_modules/ next to the engine lib.  The asar's
// node_modules/ is the only reliable source for bare imports at runtime.

import { createRequire } from "node:module";
import path from "node:path";

let _cached = null;

function loadYaml() {
  if (_cached) return _cached;

  // 1. Local resolution — dev, UTR, monorepo (lib/ at repo root, yaml in node_modules/)
  try {
    const localRequire = createRequire(import.meta.url);
    _cached = localRequire("yaml");
    return _cached;
  } catch {
    // Fall through to asar resolution
  }

  // 2. Packaged Electron — resolve from app.asar/node_modules/
  //    process.resourcesPath is set by Electron in the main process.
  //    Engine lib is loaded via dynamic import() from the main process,
  //    so it runs in the same process and has access to process.resourcesPath.
  if (process.resourcesPath) {
    try {
      const asarRequire = createRequire(
        path.join(process.resourcesPath, "app.asar", "package.json"),
      );
      _cached = asarRequire("yaml");
      return _cached;
    } catch {
      // Fall through
    }
  }

  throw new Error(
    "[yaml-bridge] Cannot resolve 'yaml'.\n" +
      "  In dev/UTR: ensure yaml is in node_modules (npm ci at repo root).\n" +
      "  In packaged Electron: ensure app.asar contains node_modules/yaml\n" +
      "    (declared in topmind-desktop/package.json#dependencies).",
  );
}

// Lazy getters — only resolve on first access, not at module load time.
// This prevents crashes during static analysis / dead-code checks that
// might not have node_modules available.
export function parse(str, opts) {
  return loadYaml().parse(str, opts);
}

export function stringify(obj, opts) {
  return loadYaml().stringify(obj, opts);
}

// Re-export the full yaml API for any future consumers
export default loadYaml();
