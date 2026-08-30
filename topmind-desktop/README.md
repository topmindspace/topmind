# topmind Desktop

[English](README.md) · [简体中文](README.zh-CN.md)

> Local-first **rich workbench** — personal stream · deep editing · AI copilot · reversible writes.  
> **Version truth:** this directory’s [`package.json`](./package.json) (`npm run versions`).  
> **Content truth:** always the **workspace folder**. Desktop does not hard-depend on UTR.  
> User concepts ≤ 5: **Note it · Stream · Topic · My profile · Write out**  
> Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`

[Product overview](../README.md) · [简体中文总览](../README.zh-CN.md) · IA / pixels: [`DESIGN.md`](./DESIGN.md) · Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · Implementation lock: [`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md)

---

## Why Desktop

| Friction | Path |
|----------|------|
| No time to classify an idea | `⌘N` / `⌘⇧N` → this week’s **stream** |
| Office / PDF files scattered | Drop into the **ingest** queue |
| Polishing means switching to a chat app | **Inline AI** + sidebar Agent (output is sanitized) |
| Switching tools loses format | Plain Markdown · files stay portable |

1. **Stream-first navigation** — concepts stay few; Inbox / Write out / My profile stay reachable  
2. **Quiet Paper** — type size / leading / measure / paper · focus `⌘⌥F`  
3. **AI copilot** — skill-first · `auto | confirm` save settings · suggestions generate by default and run after you confirm; multi-lane AI keeps prep serial and chat independent (see `DESIGN.md` §0.0.3)  
4. **Multi-source ingest** — default anydoc (Word · PDF · Excel · PPT · ODF · RTF · EPUB · CSV) + built-in mail/HTML → Markdown; optional markitdown / pandoc  
5. **Composable** — shares content conventions with Skills / Clip / optional UTR; no mandatory runtime binding. WeRead connector uses the official Agent Gateway (flat `api_name` + `skill_version`); incremental skip by count/`note_fingerprint`; books with no 划线/想法 are not written.  
6. **Capture vocabulary** — **Note it** (full capture · 记一下) ≠ **Log it** (stream composer · 记下)  
7. **Localized AI** — suggestion / todo / op chrome follows host UI language; Agent and inline rewrite follow explicit request → source script → workspace locale (`lib/ai-output-locale.mjs`)  
8. **Manage & Updates** — detects agent hosts · browser · Obsidian; installs / upgrades / uninstalls Skills, Clip, and the plugin (browser side is guided load-unpacked, never silent inject); unified update check and health diagnosis
9. **Optional bookkeeping** — enable-gated mini-app (`memory/ledgers/`; Apps menu / StatusBar / ⌘K). Not a 6th user concept or PrimaryNav item.

---

## Interface tour and demo

Screenshots are compressed for docs (full-resolution sources live in `resources/img/` on the development machine only — the directory is gitignored; the shared library is [`../docs/images/`](../docs/images/README.md)).

### 1. Core workbench (`Stream` + AI suggestions)

Default three columns: **nav → content → AI copilot**. The main narrative is the stream timeline.

<p align="center">
  <img src="../docs/images/desktop-stream.jpg" alt="topmind Desktop · Stream and AI suggestions" width="760" />
</p>

### 2. Full product demo

<p align="center">
  <img src="../docs/images/topmind-demo.gif" alt="topmind Desktop product demo" width="820" />
</p>

<p align="center">
  <sub>If the GIF does not play, download the <a href="../docs/images/topmind-demo.mp4">HD MP4 demo</a>.</sub>
</p>

### 3. Interaction map

| Entry | Single job |
|-------|------------|
| Title-bar **Note it** `⌘N` | The **only** full capture (note / link / attachment) |
| Global float `⌘⇧N` | Capture from anywhere; submits to the capture queue |
| Stream **Log it** | Append the composer to this week’s period note |
| Stream **AI polish** | Inline clean/polish; edits the composer only · does not write disk |
| Stream / sidebar **AI todos** | Extract todos · detect done · confirm updates |
| AI panel **ActionBar** | Suggestions + pending writes; Kernel write gate runs after confirm |
| Sidebar **My profile** | Memory-plane browse (profile / periodic / topic memory); opening a row still lands on the file |
| **Ingest hub** | Default anydoc → Markdown (Word / PPT / Excel / ODF / RTF / EPUB / PDF / CSV); optional markitdown / pandoc; mail uses the built-in path |

- **Reading Aa**: size / leading / family / measure / margins / paper (edit and preview share the same chrome; preview is a static HTML snapshot, not live TipTap)  
- **Files**: `.md` opens in the Markdown editor (primary canvas and split pane); other files use `FilePreviewView` (sandboxed HTML, text, or open-external)  
- **Inline AI / stream polish**: `ai.complete` (`action: "polish"` and siblings) · sanitize before display  
- **Agent**: `load_skill` · save settings auto/confirm · ActionBar (suggestions + pending writes)  
- **Todos**: `memory/todo.md` · write gate · AI maintain (extract / detect done / force)  
- Focus `⌘⌥F` · multi-tab / single-tab  

---

## Mental model

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

```text
~/topmind/
├── topmind-workspace/     # content truth (user data)
└── topmind-desktop/       # runtime (state / plugins / logs)
```

- Categories + topics: [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md)  
- AI skill-first: engine `skills/` + optional `skills-extra/`  
- AI providers: OpenAI · Anthropic · Google · xAI · DeepSeek · Moonshot · Zhipu · MiniMax · Ollama (local) · Custom; official list-models + models.dev catalog + curated fallback  
- Four-core boundaries: [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md)  

---

## i18n and localized AI

- UI default `auto`: match OS / `navigator.language` to `zh-CN` or `en-US`  
- Main window and the `CaptureSurface` float stay in sync; packs live in `src/locales/{zh-CN,en-US}/`  
- **Workspace locale** (`topmind.yaml` `locale` / `workspace.locale`) is the last-resort language when the host UI is `auto`  
- **Document AI** (inline rewrite / Agent writing into a note): explicit request → source document → workspace locale. UI does not rewrite a Chinese note into English.  
- **Product AI** (suggestion cards, todo extract/maintain, memory organize): explicit request → Desktop UI locale (if not `auto`) → workspace locale. Obsidian uses its plugin / app language the same way.  
- Content resolution: `lib/ai-output-locale.mjs` (`resolveOutputLanguage` vs `resolveProductAiLanguage`)

---

## Install / upgrade / manage

### Install Desktop

#### Option 1: Homebrew (recommended on macOS)
```bash
brew install topmindspace/tap/topmind
```
Homebrew clears macOS `quarantine` so unsigned builds do not show as “damaged”.

#### Option 2: Manual installer
1. Download `topmind-<ver>-<os>-<arch>.{dmg,exe,AppImage,deb}` from [Releases](https://github.com/topmindspace/topmind/releases).  
   Daily product tag `v*` builds the Desktop matrix; `desktop-v*` is a hotfix-only escape hatch.
2. Install and open; pick or create a local workspace folder (content truth).  
   If macOS reports a damaged app after a manual install:  
   `sudo xattr -rd com.apple.quarantine /Applications/Topmind.app`
3. Optional: Settings → AI to configure a provider; Settings → General → Browser clip to enable Clip Bridge.

### Settings → Manage & Updates
| Capability | Behavior |
|------------|----------|
| **Agent Skills** | Detects Claude Code / Codex / Hermes / OpenCode / CodeBuddy; installs into the host global skills root; standalone CLI `npm run skills:install` and community `npx skills add topmindspace/topmind` still work |
| **Clip extension** | Unpacks to a hosted folder + guides “Load unpacked” — **cannot** silently write Chrome; uninstall cleans the hosted folder |
| **Obsidian plugin** | Community store (in review) / BRAT / direct install into `plugins/topmind-stream/` |
| **Standalone paths** | `npm run skills:install` (repo scripts) / community `npx skills` / pack zip remain valid and do not conflict with Desktop |
| **Pre-install version check** | Each companion install/upgrade checks GitHub latest; if the bundled copy is stale, downloads latest (network failure falls back to bundled) |

Onboarding after the first workspace open can offer optional modules; it does not block the main path.

### Upgrade
| Method | What to do |
|--------|------------|
| Homebrew | `brew upgrade topmind` |
| In-app check | Manage & Updates → **Check for updates** (Desktop / Skills / Clip / Obsidian; reads public `latest.json`, no GitHub token) |
| Inline upgrade | Manage & Updates → download button for Skills / Clip / Obsidian (installs from GitHub Releases without upgrading Desktop itself) |
| Module upgrade | Settings → Manage & Updates → upgrade per host / plugin |
| Manual installer | Install the newer package over the old one; workspace folder and `app-settings.json` are kept |
| From source | `git pull` → `npm run desktop:dev`; version truth is this directory’s `package.json` |

Workspace Markdown / `topmind.yaml` / `memory/` are **not** overwritten by a Desktop upgrade. Skills · UTR · Clip · Obsidian are bundled under `resources/topmind-engine/` and can be installed from the local source in Settings. UTR follows the Desktop version. Surfaces version independently; inline upgrades pull the latest GitHub package without upgrading Desktop itself. See [`../docs/PACKAGING.md`](../docs/PACKAGING.md).

---

## Develop

```bash
# this directory
npm run dev
npm run check:quality    # full quality gate

# repo root
npm run desktop:dev
npm run desktop:quality
npm run desktop:pack:mac # or :linux / :win
```

| Document | Role |
|----------|------|
| [`DESIGN.md`](./DESIGN.md) | Product interaction · inline AI adversarial cases |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | RPC · services · AI pipeline |
| [`PLUGIN.md`](./PLUGIN.md) | Plugin slots |
| [`../docs/PACKAGING.md`](../docs/PACKAGING.md) | Pack naming and installers |

Back to overview: [`../README.md`](../README.md)
