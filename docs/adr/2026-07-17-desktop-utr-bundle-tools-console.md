# ADR: Desktop bundles UTR + Tools console

**Date:** 2026-07-17  
**Status:** Accepted  
**Surfaces:** Desktop 1.0.4 · UTR 1.0.1

## Context

Users need deterministic doctor / catalog tools inside Desktop without installing a separate UTR CLI. Prior policy excluded `utr/` from the installer, which made Tools unusable in packaged builds and left monorepo doctor vulnerable to multi-Electron Dock icons (`process.execPath`).

## Decisions

1. **Bundle** `utr/` into `topmind-engine` via `pack:prepare` (skip tests/node_modules).  
2. **Tools console** Settings → Tools: `tool.catalog` / `preview` / `run` with shared `pathContext`.  
3. **Load path**: dynamic `import(pathToFileURL(engineRoot/utr/core/…))` — never monorepo-only `../../utr`.  
4. **Node runtime**: shared `utr/core/node-runtime.mjs` for executor + doctor (`ELECTRON_RUN_AS_NODE` when needed).  
5. **Boundary preserved**: AI writeback / editor save stay on WorkspaceService.  
6. **Skills pack**: still **no** UTR (Markdown-only surface).

## Consequences

- Installer size increases by UTR contracts/tools (~small).  
- Packaged doctor no longer no-ops; multi-Dock bug fixed at source.  
- Docs / About / update model flag `desktopBundlesUtr: true`.
