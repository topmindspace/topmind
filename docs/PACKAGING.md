# Packaging — independent distributables

topmind has **four core surfaces** (Skills · Desktop · UTR · Obsidian) plus **Clip Extension** as a Desktop capture companion. They share content conventions, not a single binary. Artifact names always include the **surface** so downloads are unambiguous.

```text
Skills pack        →  dist/topmind-skills-<ver>.{tar.gz,zip,manifest,SHA256SUMS}
Browser extension  →  dist/topmind-clip-extension-<ver>.{zip,SHA256SUMS}
Obsidian plugin    →  dist/topmind-obsidian-<ver>.{zip,SHA256SUMS}
                      (also mirrored under obsidian-plugin/release/)
Desktop app        →  topmind-desktop/release/topmind-<ver>-<os>-<arch>.<ext>
UTR                →  bundled in Desktop engine; CLI via repo (no separate installer)
```

## Which file should I download?

| I want… | Download | Tag to build |
|---------|----------|--------------|
| AI skills for Claude / Codex / OpenCode | `topmind-skills-<ver>.zip` or `.tar.gz` | `skills-v*` or `v*` |
| Browser clip extension (MV3) | `topmind-clip-extension-<ver>.zip` | `extension-v*` or `v*` |
| Obsidian Stream plugin | `topmind-obsidian-<ver>.zip` | `obsidian-v*` or `v*` |
| Desktop app (macOS) | `topmind-<ver>-mac-arm64.dmg` (or `.zip`) | `desktop-v*` or `v*` |
| Desktop app (Linux x64) | `topmind-<ver>-linux-x64.AppImage` or `.deb` | `desktop-v*` or `v*` |
| Desktop app (Linux ARM) | `topmind-<ver>-linux-arm64.AppImage` or `.deb` | `desktop-v*` or `v*` |
| Desktop app (Windows) | `topmind-<ver>-win-x64.exe` | `desktop-v*` or `v*` |

**Do not** treat `topmind-skills-*` as the Desktop installer. Skills are Markdown skill packs for agent hosts; Desktop is a native Electron app. **Do not** confuse `topmind-obsidian-*` with Desktop — it is a Vault plugin zip only.

### Install companions from Desktop (no separate download required when bundled)

Desktop **Settings → Companions** can install/upgrade/uninstall Skills into detected agent hosts, prepare the Clip extension folder (guided Load-unpacked only — browsers block silent sideload), and install the Obsidian plugin into the current vault when `.obsidian` is present. Standalone CLI/pack paths remain valid. In-app **About → Check for updates** covers Desktop + Skills + Clip + Obsidian surfaces via public `latest.json`.

## Commands (repo root)

| Command | Output |
|---------|--------|
| `npm run pack:skills` / `skills:pack` | Skills portable pack under `dist/` |
| `npm run pack:extension` / `extension:pack` | Extension zip under `dist/` |
| `npm run obsidian:pack` | Obsidian plugin zip under `dist/` (+ `obsidian-plugin/release/`) |
| `npm run pack:all` | Skills + extension + Obsidian (no Desktop installers) |
| `npm run desktop:pack:prepare` | Stage `resources/topmind-engine/` + deps gate |
| `npm run desktop:pack:verify` | Asar / engine / import integrity (no build) |
| `npm run desktop:pack:dir` | Unpacked app dir + verify (CI smoke) |
| `npm run desktop:pack:mac` / `:linux` / `:win` | Platform installers + verify |

Desktop always runs `pack:prepare` first → stages `resources/topmind-engine/` (gitignored) from monorepo `templates/` + `lib/` + `skills/` + **`utr/`**, and runs the packaging dependency gate (`deps:packaging`).

Every pack path then runs **`pack:verify`** (CI: `pack:verify:strict`):

| Check | Why |
|-------|-----|
| `electron/` has no `../../lib/...` static imports | Monorepo-relative imports resolve outside `app.asar` → **main process `ERR_MODULE_NOT_FOUND` on Windows/mac installers** |
| asar contains `electron/main.mjs`, `dist/index.html`, `zod`, `ai` | Missing peers / renderer / entry |
| `resources/topmind-engine/templates` + `lib/template-loader.mjs` | Engine templates for workspace init |
| Installer size sanity | Empty/corrupt NSIS/DMG |

### Desktop app icons

Style: **macOS-like white rounded plate** + centered mark  
(`scripts/generate-icons.py` → squircle with ~10% canvas inset so Dock size matches system apps, ~18% glyph margin, transparent outside the plate).

| File | Platform |
|------|----------|
| `topmind-desktop/build/icon.icns` | macOS Dock / `.app` |
| `topmind-desktop/build/icon.ico` | Windows exe / shortcuts / NSIS |
| `topmind-desktop/build/icon.png` + `build/icons/*.png` | Linux (hicolor) |
| `topmind-desktop/build/logo-mark.png` | Transparent mark only (re-gen input) |
| `topmind-desktop/electron/assets/icon.png` | Runtime window icon (Win/Linux) |
| `topmind-desktop/public/favicon-*.png` | Renderer tab / About |

Regenerate:

```bash
# from transparent mark (preferred after first run)
npm run --prefix topmind-desktop icons:generate
# or from raw photo / draft PNG (capped at 1024; black matte stripped → mark → white plate)
topmind_ICON_SOURCE=/path/to/logo.png npm run --prefix topmind-desktop icons:generate
# refresh dev Dock after icon change
npm run --prefix topmind-desktop icons:patch-electron
```

Draft sources under `topmind-desktop/public/icon-new*.png` are **gitignored** — never commit 2K/4K masters; only generated `build/` + `public/favicon-*` / `icon-256.png` ship.

**macOS Dock / runtime icon:**

| Path | Role |
|------|------|
| `build/icon.icns` | Bundle / electron-builder only |
| `build/icon-mac.png` (plate PNG) | **`app.dock.setIcon` 与 `BrowserWindow` icon** — 勿对 `setIcon` 传 `.icns`（Electron 会回落默认 atom） |
| `icons:patch-electron` | Dev：把 plate 写入 `Electron.app` 资源；改图标后需**完全退出** Electron 再开 |

`dev-electron` / `postinstall` runs `icons:patch-electron`. Restore: `npm run icons:restore-electron`.

## Version sources

| Surface | Version file | Artifact prefix |
|---------|----------------|-----------------|
| Skills | `skills/topmind-pack.json` → `version` | `topmind-skills-` |
| Extension | `browser-extension/manifest.json` → `version` | `topmind-clip-extension-` |
| Obsidian | `obsidian-plugin/manifest.json` → `version` | `topmind-obsidian-` |
| Desktop | `topmind-desktop/package.json` → `version` | `topmind-<ver>-` |
| UTR | `utr/VERSION` (follows Desktop) | bundled in Desktop engine |

### Desktop in-app update check (public-first)

About → **检查** prefers the **public** release asset `latest.json` — no GitHub API token, no rate limit:

```text
https://github.com/{repo}/releases/latest/download/latest.json
```

CI (`release.yml`) writes `latest.json` into every full product release (`v*`) with `desktop` / `skills` / `extension` / `obsidian` stamps + asset URLs.

| Priority | Path | When |
|----------|------|------|
| 1 | Public `latest.json` | Default (open-source friendly) |
| 2 | GitHub REST API | Only if `topmind_UPDATE_USE_API=1` or `GH_TOKEN` / `GITHUB_TOKEN` |
| 3 | Public `/releases/latest` tag redirect | Fallback when JSON missing |

| Concern | Behavior |
|---------|----------|
| Network | Electron `net.fetch` when available (**system proxy**). Timeout + retry. Env: `topmind_UPDATE_TIMEOUT_MS`, `topmind_UPDATE_LATEST_URL` |
| Desktop version | Running `app.getVersion()` vs `latest.json.desktop` / installer names `topmind-X.Y.Z-*` |
| Skills version | Bundled `topmind-engine/skills` + `versions.json` from `pack:prepare` |
| Extension | Browser-only; stamp in `versions.json` / `latest.json`, or `not-bundled` |
| UTR | Bundled in Desktop engine; version in `versions.json` / `utr/VERSION` — not a separate installer |

Manual fallback: [GitHub Releases](https://github.com/topmindspace/topmind/releases).

### What Desktop packs (engine)

`pack:prepare` → `resources/topmind-engine/`:

- `templates/` · `lib/` · `skills/` · **`utr/`** · **`versions.json`**
- **UTR is bundled** for Settings → Tools / doctor（跳过 tests/`node_modules`；AI 写回仍不经 UTR `executeTool`）

Tag releases independently when needed（版本数字取真源，`npm run versions`）：

**独立版本策略**：各表面有独立版本号，大版本对齐，小版本独立。仅 re-package 版本号实际变化的表面。UTR 跟随 Desktop（同一安装包）；Obsidian Plugin 独立 tag。

```text
v{desktop}            # full portable + desktop — topmind-desktop/package.json
skills-v{skills}      # skills pack only — skills/topmind-pack.json
extension-v{extension}# clip extension only — browser-extension/manifest.json
desktop-v{desktop}    # desktop matrix only (icon / UI without bumping Skills)
obsidian-v{obsidian}  # obsidian plugin only — obsidian-plugin/manifest.json
```

## GitHub Actions

| Workflow | When | What |
|----------|------|------|
| `.github/workflows/ci.yml` | push/PR to main; **manual dispatch** | Default: Node **24**, secrets scan, tests, packaging-deps gate, Desktop **validate + pack:dir smoke**, skills/extension smoke packs. Dispatch-only adds a `plan-dryrun` job mirroring release.yml plan logic without packing. |
| `.github/workflows/release.yml` | version tags / dispatch | Surface-aware packs + **pack:verify:strict** + SHA256SUMS + GitHub Release (tag push → publish; dispatch → draft). Dispatch requires `release_tag` if `create_release` is checked. Empty installer upload → **error** (not warn). |

CI runners use Node **24**. Artifact actions use **upload/download-artifact@v5**（`merge-multiple` 用于 release 汇聚下载）；`actions/checkout@v5` · `actions/setup-node@v5`。  
Local engines still accept `>=20.11`.

### Release pipeline (surface-aware)

```text
plan            (resolves surfaces + validates dispatch inputs; always runs)
pack-skills     (skills-v* | v* | dispatch pack_skills=true)
pack-extension  (extension-v* | v* | dispatch pack_extension=true)
pack-obsidian   (obsidian-v* | v* | dispatch pack_obsidian=true)
pack-desktop    (desktop-v* | v* | dispatch pack_desktop=true)
finalize        (when plan.outputs.create_release=='true' and at least one surface produced assets)
                → also uploads latest.json (public update stamp for Desktop, no API)
```

| Tag push | Skills | Extension | Obsidian | Desktop | Release | Draft | GitHub **Latest** |
|----------|--------|-----------|----------|---------|---------|-------|-------------------|
| `v*.*.*` (full) | ✓ | ✓ | ✓ | ✓ | auto-publish | no | **yes** (only full `v*` tags) |
| `skills-v*` | ✓ | — | — | — | auto-publish | no | no |
| `extension-v*` | — | ✓ | — | — | auto-publish | no | no |
| `obsidian-v*` | — | — | ✓ | — | auto-publish | no | no |
| `desktop-v*` | — | — | — | ✓ | auto-publish | no | no |
| `workflow_dispatch` + `release_tag` | per checkboxes | per checkboxes | per checkboxes | per checkboxes | draft release | **yes** | no |
| `workflow_dispatch` w/o `release_tag` + `create_release` | — | — | — | — | **plan fails** (hard error) | — | — |

**How to ship from a clean main:**

```bash
# Read stamps first
npm run versions

# Full product release (skills + extension + obsidian + desktop matrix → published Release)
# tag = v$(node -p "require('./topmind-desktop/package.json').version")
git tag "v$(node -p "require('./topmind-desktop/package.json').version")"
git push origin --tags

# Skills pack only
git tag "skills-v$(node -p "require('./skills/topmind-pack.json').version")"
git push origin --tags

# Or Actions → Release → Run workflow (draft; set release_tag)
```

### Desktop in-app update check

About → **检查更新** calls GitHub Releases (`topmindspace/topmind`) and compares
`desktop-v*` / full `v*` tags to the running app version. Users download the
matching installer for their OS; automatic silent install can be added later
via `electron-updater` once the repo is public and (ideally) signed.

Env overrides: `topmind_UPDATE_REPO`, `topmind_UPDATE_API`, optional `GH_TOKEN`.

### Windows taskbar / .exe icon

Unsigned Windows packs set `signAndEditExecutable=false` (empty `WIN_CSC_*` otherwise
crashes rcedit+sign). That also skips embedding `icon.ico` into `topmind.exe`.

`scripts/electron-builder-ci.mjs` therefore runs `scripts/patch-win-exe-icon.mjs`
after a successful `win` pack to rcedit **--set-icon only**. Runtime window/taskbar
also loads `electron/assets/icon.ico` from asar (see `electron/lib/app-icon.mjs`).
### Plan job outputs (truth table)

The `plan` job in `release.yml` is the **single source of truth** for which surfaces run. Its `$GITHUB_OUTPUT` is consumed by every downstream job:

| Output | Tag push | workflow_dispatch |
|--------|----------|-------------------|
| `skills` | per tag prefix (skills-v* / v* → true; else false) | `${{ inputs.pack_skills }}` |
| `extension` | per tag prefix (extension-v* / v* → true; else false) | `${{ inputs.pack_extension }}` |
| `desktop` | per tag prefix (desktop-v* / v* → true; else false) | `${{ inputs.pack_desktop }}` |
| `tag` | `${GITHUB_REF_NAME}` (e.g. `v4.11.0`) | `${{ inputs.release_tag }}` — strip `refs/tags/` prefix if present |
| `create_release` | always `true` (tag pushes always release) | `${{ inputs.create_release }}` |

### workflow_dispatch behavior (important)

Tag pushes **publish** the release immediately (`draft: false`). Dispatch runs **publish a DRAFT** that you then click "Publish release" on the Releases page.

- `create_release=true` (default) with empty `release_tag` → `plan` job fails with a clear error message. Previously this silently skipped `github-release`, leaving you with green checkmarks but no release.
- `create_release=false` → pack only; no release is created.
- Dispatch never auto-publishes — by design — so you can review assets before they go live.

### Diagnosing "this job was skipped"

If `pack-*` shows "(this job was skipped)" with the checkbox checked:

1. Open the run → click `plan` → click "Release plan" in the step summary. The truth table of resolved `skills/extension/desktop/tag` is logged there.
2. If `desktop=true` is shown but `pack-desktop` was still skipped, the dispatched workflow file is an OLDER version than `main` — `workflow_dispatch` runs the workflow file as it exists on the dispatched branch. Click the workflow filename on the run page to confirm the SHA matches the current `main`.
3. If `desktop=false` is shown, you forgot to check the `pack_desktop` checkbox (its default is `false`).

Release notes group assets by surface and list only **user-facing** installers (no `.blockmap` / update metadata in the primary download table).

### Desktop matrix (Release)

| Runner | Script | Artifact id | User-facing files |
|--------|--------|-------------|-------------------|
| `macos-15` | `pack:mac:ci` | `desktop-macos` | `.dmg` (+ `.zip` portable) |
| `ubuntu-latest` | `pack:linux:ci` | `desktop-linux-x64` | `.AppImage` · `.deb` · `.tar.gz` |
| `ubuntu-24.04-arm` | `pack:linux:ci` | `desktop-linux-arm64` | same for arm64 |
| `windows-latest` | `pack:win:ci` | `desktop-windows` | `.exe` (NSIS) |

Artifact names: `topmind-<version>-<os>-<arch>.<ext>` (see `electron-builder.yml` `artifactName`).

Env always set in workflow: `CSC_IDENTITY_AUTO_DISCOVERY=false`.  
**All** pack entrypoints (local + CI): `topmind-desktop/scripts/electron-builder-ci.mjs` — unsets **empty** `CSC_*` secrets, forces `-c.mac.identity=null` when no cert, `-c.win.signAndEditExecutable=false` without Win cert, and refuses cross-arch packs unless `ELECTRON_BUILDER_ALLOW_CROSS_ARCH=1`. Supports `mac|linux|win|dir`.

**Never** set `ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true` — that hid missing peers (e.g. AI SDK `zod`) from pack failures.

Do **not** put `electron_mirror` in `.npmrc` (npm 10+ rejects unknown project keys). Use env vars only if you need a mirror locally.

### Pack integrity (required)

```bash
# After any pack, or during validate:
npm run --prefix topmind-desktop pack:verify
# CI / release: fail if release/ has no usable artifacts
npm run --prefix topmind-desktop pack:verify:strict
```

Script: `topmind-desktop/scripts/verify-pack.mjs`.

### Desktop packaging deps (AI SDK / zod)

AI SDK packages declare `zod` as a **peerDependency**. electron-builder only packs declared production dependencies, so `zod` must be listed in `topmind-desktop/package.json#dependencies`.

Gate (also runs before every pack / validate):

```bash
npm run --prefix topmind-desktop deps:packaging
```

### Linux / Ubuntu ARM notes

```bash
# On an aarch64 host (or after CI produces arm64 artifacts):
chmod +x topmind-*-linux-arm64.AppImage && ./topmind-*-linux-arm64.AppImage
# or:
sudo dpkg -i topmind-*-linux-arm64.deb
# or portable unpack:
tar -xzf topmind-*-linux-arm64.tar.gz && ./topmind/topmind
```

Runtime knobs (also used in production `main.mjs`):

| Env | Effect |
|-----|--------|
| `ELECTRON_NO_SANDBOX=1` | Disable Chromium sandbox (needed when userns is disabled / some containers) |
| `ELECTRON_DISABLE_GPU=1` | Force software rendering (default on arm64) |
| `ELECTRON_DISABLE_GPU=0` | Keep GPU even on arm |
| `ELECTRON_OZONE_PLATFORM_HINT=auto` | Wayland/X11 hybrid (default on Linux) |

Encrypted API keys need **libsecret** (e.g. `libsecret-1-0` + `gnome-keyring`). Without it, Desktop logs a warning and stores keys without OS encryption.

### Desktop signing (optional)

Set repository secrets (never commit):

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

Without them, electron-builder produces **unsigned** artifacts (fine for CI / personal use).  
When secrets are present, you may remove `identity: null` behavior by overriding via env (electron-builder picks CSC_LINK automatically).

## Packaged Desktop crash triage

| Symptom | Likely cause | Fix / check |
|---------|--------------|-------------|
| Windows: "A JavaScript error occurred in the main process" + `Cannot find module …/lib/template-loader` | `electron/` static-import monorepo `../../lib/` (not in asar) | Use `electron/lib/template-api.mjs`; `pack:verify` bans the old import |
| App exits immediately, no window | Engine missing / `initApp` throw | Log: `~/topmind/topmind-desktop/logs/main.log` (Windows: `%USERPROFILE%\topmind\topmind-desktop\logs\main.log`) |
| AI fails only in installer | `zod` not in production deps | `npm run deps:packaging` |
| Empty GitHub Release assets | Matrix leg failed or upload path mismatch | Release job step summary + `if-no-files-found: error` on Desktop upload |
| Unsigned Win pack fails at rcedit | Empty `WIN_CSC_*` | Always pack via `electron-builder-ci.mjs` (auto `signAndEditExecutable=false`) |

Runtime diagnostics RPC: `system.getDiagnostics` (version, packaged, engineRoot, log paths — no secrets).

## Local checklist before tagging

```bash
npm run secrets:scan
npm run validate          # full gate (includes Desktop + Obsidian + packaging deps + pack:verify)
npm run pack:all          # skills + extension + obsidian
# Desktop smoke (unpacked app + asar integrity):
npm run desktop:pack:dir
```

## What is gitignored

- `dist/` — pack outputs  
- `topmind-desktop/release/` — installers  
- `topmind-desktop/resources/` — staged engine  
- `.env*` — local secrets  

Do not force-add these directories.
