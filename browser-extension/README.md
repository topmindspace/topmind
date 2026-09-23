# topmind Clip · browser web clipper

[English](README.md) · [简体中文](README.zh-CN.md)

> **Version truth:** [`manifest.json`](./manifest.json) (`npm run versions`)  
> Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整` (clip only covers **Capture**)  
> [Overview](../README.md) · [简体中文总览](../README.zh-CN.md) · [Capability matrix](../docs/capture-clip-matrix.md)

Send the current page, selection, or **highlights** into a topmind workspace (Inbox · category · topic) in one click.  
Parity with common web clippers: preview · highlights · templates · destination · image localization.

### Two write paths (either one is enough)

| Path | When | Traits |
|------|------|--------|
| **Desktop Bridge** | Desktop is running | Same HTML→MD · destination API · Desktop write gate · image localization |
| **Local workspace** | Desktop need not be open | File System Access after the user grants a folder |

What is shared is the **content contract** (paths · frontmatter · `external-capture`), not Desktop runtime state.

---

## Architecture

Canonical ADR: [`../docs/adr/2026-07-13-browser-clip-extension.md`](../docs/adr/2026-07-13-browser-clip-extension.md)

```text
Extension (Mozilla Readability on live DOM)
        │
        ├─ mode=bridge / auto+online
        │     GET  /v1/destinations  → destination list
        │     POST /v1/clip          → normalize → template → images → inbox/dest
        │
        └─ mode=workspace / auto+offline
              File System Access → {Inbox|category|topic}/*.md
              same HTML→MD · templates · optional image download
```

| | Bridge | Workspace-direct |
|--|--------|------------------|
| Requires Desktop running | **Yes** | **No** |
| HTML→MD | Shared `html-to-markdown` + article template post-process | Same converter + templates (no Node write gate; the user gesture is the confirm) |
| Destination | destinations API | FS directories (same dest shape) |
| Images | Localized by default to `images/{slug}/` | Same; needs host permission to fetch CDNs |
| Safety | 127.0.0.1 + Bearer + CSP | User-granted directory |

---

## Pack

```bash
# repo root
npm run pack:extension   # dist/topmind-clip-extension-<version>.zip
# or with pack:all (skills + extension + obsidian)
```

The Latest snapshot on product tag `v*` includes the current extension zip; `extension-v*` is a hotfix-only escape hatch. Version truth: [`manifest.json`](./manifest.json) (`npm run versions`).

---

## Install / upgrade

### From a Release (recommended)

1. Download `topmind-clip-extension-<ver>.zip` from [Releases](https://github.com/topmindspace/topmind/releases)
2. Extract to any local folder
3. Chrome / Edge → `chrome://extensions` → Developer mode → **Load unpacked** → pick the extracted folder

### Upgrade

1. Download the new zip and overwrite the local extension folder (or extract to a new folder)
2. Click **Reload** on the extension card in `chrome://extensions`
3. Token / workspace-directory grants usually survive; if Bridge fails, paste the token again on the options page and test

### Development install

1. Chrome / Edge → `chrome://extensions` → Developer mode → **Load unpacked** → pick monorepo `browser-extension/`  
2. Open the toolbar popup: unconfigured installs start the **Setup** wizard  
3. In **Options**, configure one or both:  
   - **Bridge**: Desktop Settings → General → Browser clip → enable → copy Token → paste into the extension and test  
   - **Workspace**: choose the workspace folder → **Re-authorize write** (or confirm the browser permission on the first clip)  
4. Write mode: `Auto` (default) | `Bridge only` | `Workspace only`

**Local-mode permission note:** after Chromium stores a directory handle in IndexedDB, cross-session permission is often `prompt`.  
A Service Worker **cannot** show the permission dialog; `requestPermission` must run from an **options / popup click**.  
This extension re-confirms immediately after a folder is chosen, and again before a popup “Clip” click.

---

## Use

- Toolbar popup: editable title · **Preview** · mode · **Destination** · Highlight mode  
- Highlights: drag-select on the page; **Alt+click** removes one; popup “Clear highlights” clears all; clip again in Highlight mode  
- Context menu · `⌘⇧M` / `Ctrl+Shift+M`  
- Success: badge ✓ · path receipt; failure: badge ✕ / unconfigured `!`

### Templates

Built-in: `article` · `selection` · `bookmark` · `github` / `zhihu`.  
Custom: Options page **Import/Export JSON** (`chrome.storage`).  
Bridge and workspace both run **the same HTML→MD first, then the template**. Bridge additionally uses the Desktop destination API and write gate.

### Performance

- Popup first paint reads tab metadata only; extract-preview runs when idle  
- Readability injection is reused for the same page session  
- Restricted protocols (`chrome://` and similar) fail fast without injecting scripts  
- Auto mode uses a health cache; clip results are double-written to storage to avoid *message channel closed*

---

## Internationalization

Chrome native i18n: `_locales/` + `chrome.i18n.getMessage()`.  
Current: `zh_CN` · `en_US`.

---

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Options buttons do nothing | Reload the extension; check the options error banner |
| “Choose workspace folder” does nothing | Use Chrome/Edge 86+; confirm enterprise policy does not disable File System Access |
| Bridge will not connect | Desktop clip is enabled, Token matches, localhost `127.0.0.1` is not blocked |
| Images were not localized | Bridge is online and has image permission; workspace mode needs host permission for image CDNs |

---

## Security

- Bridge binds **only** `127.0.0.1`, Bearer Token  
- Do not commit a real Token in extension source  
- See [`../SECURITY.md`](../SECURITY.md)

Back to overview: [`../README.md`](../README.md)
