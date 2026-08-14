# Packaging — independent distributables

Product entry: root [`README.md`](../README.md) (English) · [`README.zh-CN.md`](../README.zh-CN.md) (简体中文). Module READMEs follow the same pair.

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
| AI skills for Claude / Codex / OpenCode | `topmind-skills-<ver>.zip` or `.tar.gz` | `v*` (or hotfix `skills-v*`) |
| Browser clip extension (MV3) | `topmind-clip-extension-<ver>.zip` | `v*` (or hotfix `extension-v*`) |
| Obsidian Stream plugin | `topmind-obsidian-<ver>.zip` | `v*` (or hotfix `obsidian-v*`) |
| Desktop app (macOS) | `topmind-<ver>-mac-arm64.dmg` (or via `brew install topmindspace/tap/topmind`) | `v*` (or hotfix `desktop-v*`) |
| Desktop app (Linux x64) | `topmind-<ver>-linux-x64.AppImage` or `.deb` | `v*` |
| Desktop app (Linux ARM) | `topmind-<ver>-linux-arm64.AppImage` or `.deb` | `v*` |
| Desktop app (Windows) | `topmind-<ver>-win-x64.exe` | `v*` |

**Do not** treat `topmind-skills-*` as the Desktop installer. Skills are Markdown skill packs for agent hosts; Desktop is a native Electron app. **Do not** confuse `topmind-obsidian-*` with Desktop — it is a Vault plugin zip only.

### Install modules from Desktop (no separate download required when bundled)

Desktop **Settings → Manage & Updates** can install/upgrade/uninstall Skills into detected agent hosts, prepare the Clip extension folder (guided Load-unpacked only — browsers block silent sideload), and install the Obsidian plugin into the current vault when `.obsidian` is present. Standalone CLI/pack paths remain valid. In-app **Manage & Updates → Check for updates** covers Desktop + Skills + Clip + Obsidian surfaces via public `latest.json`.

## Commands (repo root)

| Command | Output |
|---------|--------|
| `npm run pack:skills` / `skills:pack` | Skills portable pack under `dist/` |
| `npm run pack:extension` / `extension:pack` | Extension zip under `dist/` |
| `npm run obsidian:pack` | Obsidian plugin zip under `dist/` (+ `obsidian-plugin/release/`) |
| `npm run cask:generate` | Local snapshot at `casks/topmind.rb` (gitignored; needs a local mac pack for real SHA256). Live Homebrew recipe is `topmindspace/homebrew-tap`, written by `release.yml` `update-homebrew-cask` |
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

### Desktop in-app update check (API-merged)

About → **检查** uses a two-source merge strategy for accurate per-surface version detection:

```text
1. Public latest.json  →  https://github.com/{repo}/releases/latest/download/latest.json
   Fast, CDN-backed, no rate limit. Gives baseline from last full v* release.
   Does NOT see surface-specific releases (obsidian-v*, skills-v*).

2. GitHub REST API  →  GET /repos/{repo}/releases?per_page=30
   Always tried (unauthenticated for public repos, 60 req/hour).
   Complete picture: sees ALL releases including surface-specific tags.
   Non-blocking: if API fails (rate limit, network), keeps latest.json result.

3. Public tag redirect  →  /releases/latest
   Last resort when both above fail.
```

CI (`release.yml`) writes `latest.json` into every release (full `v*` and surface-specific) with `desktop` / `skills` / `extension` / `obsidian` stamps + asset URLs.

| Priority | Path | When |
|----------|------|------|
| 1 | Public `latest.json` | Always (fast baseline, CDN, no rate limit) |
| 2 | GitHub REST API | Always (non-blocking; catches surface-specific releases) |
| 3 | Public `/releases/latest` tag redirect | Fallback when both above fail |

| Concern | Behavior |
|---------|----------|
| Network | Electron `net.fetch` when available (**system proxy**). Timeout + retry. Env: `topmind_UPDATE_TIMEOUT_MS`, `topmind_UPDATE_LATEST_URL`, `topmind_UPDATE_SKIP_API=1` |
| Desktop version | Running `app.getVersion()` vs installer names `topmind-X.Y.Z-*` across ALL releases |
| Skills version | **Installed** (from agent host receipt) > **bundled** (`versions.json`) vs remote |
| Extension | **Installed** (managed dir manifest) > **bundled** (`versions.json`) vs remote |
| Obsidian | **Installed** (vault plugin manifest) > **bundled** (`versions.json`) vs remote |
| UTR | Bundled in Desktop engine; version in `versions.json` / `utr/VERSION` — not a separate installer |

**Per-surface version comparison**:

The update check compares the **installed** version (what's actually deployed on disk via companion lifecycle) against the **remote** version — not the bundled version. This means:

- If you inline-upgraded Skills to a newer stamp via Desktop, the check shows "up to date" even if Desktop still ships an older bundled Skills stamp.
- If you never installed Skills to any agent host, the check uses the **bundled** version (from `versions.json`).
- The UI shows both `installed <on-disk> · bundled <engine>` when they differ.

**Env overrides**:

| Env | Effect |
|-----|--------|
| `topmind_UPDATE_REPO` | Override GitHub repo (default: `topmindspace/topmind`) |
| `topmind_UPDATE_LATEST_URL` | Override latest.json URL |
| `topmind_UPDATE_API` | Override GitHub API base (e.g. mirror) |
| `topmind_UPDATE_USE_API=1` | Force API-only (skip latest.json) |
| `topmind_UPDATE_SKIP_API=1` | Skip API (latest.json only — for restricted networks) |
| `topmind_UPDATE_TIMEOUT_MS` | Override timeout (default 15000) |
| `GH_TOKEN` / `GITHUB_TOKEN` | Enhance API rate limit (5000 req/hour) |

Manual fallback: [GitHub Releases](https://github.com/topmindspace/topmind/releases).

### Inline companion download + install (no Desktop update required)

When a companion (Skills / Obsidian plugin / Clip extension) has a newer version on GitHub Releases than the bundled version, Desktop can download and install it inline — no full Desktop update needed.

**Settings → Manage & Updates → Check for updates** detects available companion updates. When an update is available for Skills, Obsidian, or Clip, a download button appears next to the version row. Clicking it:

1. Downloads the companion package (e.g. `topmind-obsidian-<ver>.zip`) from GitHub Releases
2. Verifies SHA256 checksum when `SHA256SUMS` is available
3. Installs the package locally (replaces the bundled version)
4. Cleans up temp files automatically

| Surface | Asset pattern | Install destination |
|---------|---------------|---------------------|
| Skills | `topmind-skills-{ver}.zip` | Managed skills-extra root + agent host (if specified) |
| Obsidian | `topmind-obsidian-{ver}.zip` | Vault `.obsidian/plugins/topmind-stream/` |
| Extension | `topmind-clip-extension-{ver}.zip` | Managed clip extension dir (guided load-unpacked) |

**Security**: Downloads only from `github.com/{repo}/releases/download/{tag}/`. SHA256SUMS verified when available. No auto-execution of downloaded content. Temp files cleaned up on success or failure.

**Property name contract** (regression-fixed 2026-08-10):

The `downloadAndInstallCompanion` IPC handler in `system-service.mjs` passes the downloaded zip path to install functions. The property names MUST match:

| Surface | Install function | Property name | Accepted aliases |
|---------|-----------------|---------------|-----------------|
| Skills | `installSkillsPackLocal(zipPath)` | positional arg | — |
| Obsidian | `installObsidianPlugin({ zipPath })` | `zipPath` | `sourcePath`, `sourceZipPath` |
| Extension | `prepareClipExtensionInstall({ bundledZipPath })` | `bundledZipPath` | `sourcePath`, `sourceZipPath` |

**Regression**: Previously `sourcePath` was passed instead of `zipPath`/`bundledZipPath`, causing the downloaded zip to be silently ignored — the install function fell back to the bundled/monorepo version, defeating the inline upgrade. Both the correct property name and aliases are now accepted for robustness.

**Desktop itself** cannot be upgraded inline — it requires a full installer download (DMG/EXE/AppImage) or `brew upgrade topmind`. When Desktop is updated, it always bundles the latest companions from the same monorepo commit.

### Pre-install version guard (auto-download latest)

When a user clicks **Install** or **Upgrade** for any companion (Skills / Obsidian / Clip extension) in **Settings → Manage & Updates**, Desktop does not blindly install from the stale bundled version. Instead, each install handler runs a **pre-install version guard**:

1. Reads the **bundled version** (from `versions.json` / engine manifest — instant, no network)
2. Calls `checkAllSurfaces()` to fetch the **latest version** on GitHub (latest.json + API, same as "Check for updates")
3. If `latest > bundled`, **downloads the latest companion package** from GitHub Releases and installs it
4. If `latest <= bundled` or the network check fails (non-blocking), **installs from the bundled version** instead

This means that even if the Desktop bundle ships an older Skills stamp but a newer Skills package is published on GitHub, clicking "Install" in Desktop installs the published stamp — not the stale bundled copy.

| Surface | Handler | Download asset | Fallback |
|---------|---------|----------------|----------|
| Skills | `installCompanionSkills` / `upgradeCompanionSkills` | `topmind-skills-{ver}.zip` → `installSkillsPackLocal` → `installSkillsToHost` | Bundled engine skills/ |
| Obsidian | `installObsidianPlugin` | `topmind-obsidian-{ver}.zip` → `installObsidianPlugin({ zipPath })` | Bundled engine obsidian-plugin/ |
| Extension | `prepareClipExtension` | `topmind-clip-extension-{ver}.zip` → `prepareClipExtensionInstall({ bundledZipPath })` | Bundled engine browser-extension/ |

**Non-blocking fallback**: If the GitHub check fails (network error, rate limit), the install proceeds from the bundled source. A log message is written. The user is not blocked.

**Return metadata**: Install handlers now return `{ source: "downloaded" | "bundled", downloadedVersion?: string }` so the UI can display whether the install used a freshly-downloaded package or the bundled version.

**Clip extension uninstall**: `uninstallClipExtension` cleans the managed extension directory (removes all contents, keeps the directory for re-prepare). Available as a **Uninstall** button in Settings → Manage & Updates when the extension is prepared.

### AI key export for Obsidian plugin

Desktop stores AI provider keys encrypted via Electron `safeStorage`; the Obsidian plugin cannot decrypt them directly. **Settings → AI → Export for Obsidian** writes a temporary plaintext JSON file (`obsidian-key-export.json`) that the Obsidian plugin's **Import from Desktop** feature can read.

The export file contains:
- `ai.sourcePreference` — preferred provider ID
- `ai.defaultModel` — default model override
- `ai.manual.*` — all provider API keys (plaintext, temporary)

The Obsidian plugin checks both the export file and `app-settings.json` (for Linux without libsecret, where keys are plaintext).

### What Desktop packs (engine)

`pack:prepare` → `resources/topmind-engine/`:

- `templates/` · `lib/` · `skills/` · **`utr/`** · **`browser-extension/`** · **`obsidian-plugin/`** · **`versions.json`**
- **UTR is bundled** for Settings → Tools / doctor（跳过 tests/`node_modules`；AI 写回仍不经 UTR `executeTool`）
- **Clip Extension is bundled** for Settings → Manage → Install clip extension (guided load-unpacked)
- **Obsidian Plugin is bundled** for Settings → Manage → Install to vault (requires `.obsidian/`)

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
| `.github/workflows/ci.yml` | push/PR to main; **manual dispatch** | Default: Node **24**, secrets scan, docs:guard, root/skills/UTR tests + UTR doctor:engine, Desktop **validate + pack:dir smoke**, Obsidian validate, skills/extension/obsidian smoke packs. Dispatch-only adds a `plan-dryrun` job mirroring release.yml plan logic without packing. |
| `.github/workflows/release.yml` | version tags / dispatch | Surface-aware packs + **pack:verify:strict** + SHA256SUMS + GitHub Release (tag push → publish; dispatch → draft). Dispatch requires `release_tag` if `create_release` is checked. Empty installer upload → **error** (not warn). |

CI runners use Node **24**. `actions/checkout@v5` · `actions/setup-node@v5`. CI PR smoke uses `actions/upload-artifact@v5` for pack zips only. Release does **not** use Actions artifact storage (`download-artifact` / `merge-multiple`); pack jobs upload directly with `gh release upload` (avoids the 500MB Actions storage quota).  
Local engines still accept `>=20.11`.

### Release pipeline (one product snapshot)

```text
plan             (v*: pack vs reuse from previous Latest latest.json; dispatch: checkboxes)
create-release   (creates empty GitHub Release for the tag)
wait-for-release (polls API until release is visible — eventual consistency buffer)
pack-skills      (truth version changed | skills-v* hotfix | dispatch pack_skills=true)
pack-extension   (truth version changed | extension-v* | dispatch pack_extension=true)
pack-obsidian    (truth version changed | obsidian-v* | dispatch pack_obsidian=true)
pack-desktop     (truth version changed | desktop-v* | dispatch pack_desktop=true)
reuse-previous   (v* only: copy unchanged surface assets from previous Latest)
finalize         (when pack or reuse produced assets)
                 → also uploads latest.json (public update stamp for Desktop, no API)
update-cask      (when desktop=='true'; updates version & sha256 to topmindspace/homebrew-tap using HOMEBREW_TAP_TOKEN secret)
```

**Concurrent release protection:**

- A **shared concurrency group** (`release`) ensures only one release workflow runs at a time.
- Surface-specific hotfix tags (`skills-v*` / `desktop-v*` / `extension-v*` / `obsidian-v*`) are **skipped** if a full `v*` release for the same version already exists.
- All `gh release upload` calls use a **retry wrapper** (5 attempts, 10s delay) to handle transient GitHub API issues (e.g., "release not found" right after creation due to eventual consistency).
- **IMPORTANT**: Daily ship is **one** `v*` tag (follows Desktop). Do NOT push surface-specific tags alongside it.

| Tag push | Skills | Extension | Obsidian | Desktop | Release | Draft | GitHub **Latest** |
|----------|--------|-----------|----------|---------|---------|-------|-------------------|
| `v*.*.*` (product ship) | pack if changed, else reuse | same | same | same | auto-publish | no | **yes** |
| `skills-v*` (hotfix) | ✓ | — | — | — | auto-publish | no | no |
| `extension-v*` | — | ✓ | — | — | auto-publish | no | no |
| `obsidian-v*` | — | — | ✓ | — | auto-publish | no | no |
| `desktop-v*` | — | — | — | ✓ | auto-publish | no | no |
| `workflow_dispatch` + `release_tag` | per checkboxes | per checkboxes | per checkboxes | per checkboxes | draft release | **yes** | no |
| `workflow_dispatch` w/o `release_tag` + `create_release` | — | — | — | — | **plan fails** (hard error) | — | — |

**How to ship from a clean main:**

```bash
# Read stamps first
npm run versions

# One product Release (Latest). Packs only surfaces whose truth version changed
# vs previous Latest; copies the rest. Tag follows Desktop.
git tag "v$(node -p "require('./topmind-desktop/package.json').version")"
git push origin "v$(node -p "require('./topmind-desktop/package.json').version")"

# Hotfix one surface only (NOT alongside a full v* tag; not Latest)
git tag "obsidian-v$(node -p "require('./obsidian-plugin/manifest.json').version")"
git push origin "obsidian-v$(node -p "require('./obsidian-plugin/manifest.json').version")"

# Note: skills.sh / npx skills will automatically index the GitHub repo for `npx skills add topmindspace/topmind`
# Or Actions → Release → Run workflow (draft; set release_tag)
```

### Desktop in-app update check (legacy reference)

> See [Desktop in-app update check (API-merged)](#desktop-in-app-update-check-api-merged) above for the current strategy.

About → **检查更新** uses the API-merged strategy described above. The GitHub API sees ALL releases (full `v*` + surface-specific `obsidian-v*`, `skills-v*`, etc.) and picks the highest version per surface. `latest.json` serves as a fast CDN-backed fallback when the API is unavailable.

Env overrides: `topmind_UPDATE_REPO`, `topmind_UPDATE_API`, `topmind_UPDATE_SKIP_API`, optional `GH_TOKEN`.

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
| `skills` | `v*`: pack if truth ≠ previous Latest; `skills-v*` hotfix | `${{ inputs.pack_skills }}` |
| `extension` | `v*`: pack if truth ≠ previous Latest; `extension-v*` hotfix | `${{ inputs.pack_extension }}` |
| `obsidian` | `v*`: pack if truth ≠ previous Latest; `obsidian-v*` hotfix | `${{ inputs.pack_obsidian }}` |
| `desktop` | `v*`: pack if truth ≠ previous Latest; `desktop-v*` hotfix | `${{ inputs.pack_desktop }}` |
| `reuse_*` | `v*`: true when that surface's truth version equals previous Latest | always false |
| `prev_tag` | previous GitHub Latest tag (for reuse) | empty |
| `tag` | `${GITHUB_REF_NAME}` (e.g. `v3.4.0`) | `${{ inputs.release_tag }}` — strip `refs/tags/` prefix if present |
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
4. If the plan summary shows "skipped: full release vX.Y.Z already exists", a full `v*` release for the same version was already published. The surface-specific tag was correctly skipped to avoid a duplicate release. To force a surface-specific release, bump the surface version first.

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
