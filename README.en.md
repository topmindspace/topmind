# topmind

[简体中文](README.md) · [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/topmindspace/topmind?style=flat-square&color=blue)](https://github.com/topmindspace/topmind/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/Node.js-%E2%89%A520.11-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Obsidian%20%7C%20Chrome-purple?style=flat-square)](#quick-start-and-installation)
[![Build Status](https://img.shields.io/github/actions/workflow/status/topmindspace/topmind/ci.yml?style=flat-square&label=CI)](https://github.com/topmindspace/topmind/actions)

> **Local-first personal stream and knowledge workbench for the agent era**  
> **Just log it** → **AI suggests, organizes, extracts todos, and maintains memory** → **You confirm before anything settles** → **Files stay yours**

---

## Interface and product demo

### Three-column workbench (stream timeline + AI workspace)

Navigation → stream timeline → AI workspace (**Chat · Suggest · List · Apps**). The weekly stream is the main narrative; AI proposes and waits for your confirmation before anything settles.

<p align="center">
  <img src="./docs/images/desktop-stream-en.jpg" alt="topmind Desktop three-column workbench: stream timeline with the AI workspace suggestion pane" width="820" />
</p>

### Full product demo

<p align="center">
  <img src="./docs/images/topmind-demo.gif" alt="topmind interactive product demo" width="820" />
</p>

<p align="center">
  <sub>If the GIF does not play in your environment, download the <a href="./docs/images/topmind-demo.mp4">HD MP4 demo</a>.</sub>
</p>

---

## Why topmind?

Traditional note apps (Obsidian, Logseq) and modern AI knowledge bases often share one cost: **too much organization overhead**. Energy goes into folders, tags, formatting, and backlinks instead of thinking and writing.

topmind is a **low-friction, flexible, all-in-one** personal knowledge companion:

- **Instant capture, zero burden** — thoughts, web clips, document ingest, and drafting happen without deciding “where this belongs” first.
- **Log first, organize later** — the default surface is a stream timeline. Capture now; classify when ready.
- **Proactive, unobtrusive AI** — when AI is on, the system reads workspace context and offers just-enough organization and todo suggestions. **AI proposes and carries the work; you keep the final say.**
- **Local-first and transparent** — standard Markdown folders on disk. Files are the source of truth. No proprietary database lock-in.

---

## Quick start and installation

topmind is four core surfaces plus one clip companion. Pick the entry that matches how you work:

```text
topmind  =  Portable Skills  ⊕  Optional Desktop  ⊕  Optional UTR  ⊕  Optional Obsidian
            AI skills pack        Desktop app           CLI / MCP tools      Vault plugin
          + Optional Clip companion (Desktop capture distribution; not an independent Kernel host)
```

### Scenario 1: Standalone Desktop app

> Best when you want a dedicated rich-text workbench and a visual AI confirmation UI.

- **Option A — Homebrew (recommended on macOS)**:
  ```bash
  brew install topmindspace/tap/topmind
  ```
  Homebrew clears the macOS `quarantine` flag so unsigned builds do not show as “damaged”.

- **Option B — Manual installer**:
  1. Download `.dmg` / `.exe` / `.AppImage` / `.deb` from [Releases](https://github.com/topmindspace/topmind/releases).
  2. Launch the app and press `⌘N` (macOS) / `Ctrl+N` (Windows/Linux) to capture a note.  
     If macOS says the app is damaged after a manual install:  
     `sudo xattr -rd com.apple.quarantine /Applications/topmind.app`  
     If `brew upgrade --cask topmind --greedy` fails with `App source '/Applications/topmind.app' is not there`:  
     `brew uninstall --cask topmind --force && brew install --cask topmind` (or `brew reinstall --cask topmind`).
  3. Guide: [`topmind-desktop/README.md`](./topmind-desktop/README.md)（简体中文） · [English](./topmind-desktop/README.en.md)

### Scenario 2: Inside Obsidian (topmind Stream plugin)

> Best when you want the personal stream inside an existing Obsidian vault.

- **Option A — Community Plugin Store** *(submission in review)*: after listing, search `Topmind Stream` under **Settings → Community plugins → Browse**.
- **Option B — BRAT**: add the GitHub repo `topmindspace/topmind-obsidian` in BRAT.
- **Option C — Manual zip**: download `topmind-obsidian-<ver>.zip` from [Releases](https://github.com/topmindspace/topmind-obsidian/releases) and extract to `<Vault>/.obsidian/plugins/topmind-stream/`.
- After enabling, open the command palette (`⌘P` / `Ctrl+P`) and run **Topmind: Open Stream**.
- Guide: [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian)

### Scenario 3: Agent Skills (Claude Code / OpenCode / Codex)

> Best when an AI agent drives the local workflow.

- **Option A — Community CLI / skills.sh**:
  ```bash
  npx skills add topmindspace/topmind-skills -g -y
  ```
- **Option B — Desktop UI (recommended if Desktop is installed)**:  
  **Settings → Extensions & integrations / About & updates** detects local agent hosts and installs Skills globally.
- **Option C — Source CLI**:
  ```bash
  npx skills add topmindspace/topmind-skills -g -y
  ```
- Guide: [topmind-skills](https://github.com/topmindspace/topmind-skills) · [INSTALL](https://github.com/topmindspace/topmind-skills/blob/main/INSTALL.md) · [`SKILL-ARCHITECTURE.md`](./SKILL-ARCHITECTURE.md)

### Scenario 4: Browser clip extension

> Best for one-click article capture and cleanup.

1. In Desktop **Settings → Extensions & integrations / About & updates**, click **Prepare clip extension**, then load the unpacked folder in Chrome/Edge.
2. Or download `topmind-clip-extension-<ver>.zip` from [Releases](https://github.com/topmindspace/topmind/releases) and load it manually.
3. Guide: [`browser-extension/README.md`](./browser-extension/README.md)（简体中文） · [English](./browser-extension/README.en.md)

### Scenario 5: Terminal CLI and MCP (UTR)

> Best when you need deterministic tools in a terminal or MCP host.

- Bundled with the Desktop app, or usable from the source `utr/` tree.
- Inspect the current action surface:
  ```bash
  npm run utr:doctor            # toolchain diagnosis
  npm run utr:list              # 8 domains / 28 commands
  ```
- Guide: [`TOOLS.md`](./TOOLS.md) · [`utr/README.md`](./utr/README.md)（简体中文） · [English](./utr/README.en.md)

---

## Core workflow

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
Capture -> Continue -> Ship / Settle -> Retrieve / Adjust
```

```mermaid
flowchart LR
  A["① Capture<br/>notes · clips · documents"] --> B["② Continue<br/>stream · topics · edit"]
  B --> C["③ Ship / Settle<br/>outputs · Memory"]
  C --> D["④ Retrieve / Adjust<br/>search · archive · Loop"]
  D -.-> A
```

| Phase | What you do | Default destination | Notes |
|-------|-------------|---------------------|-------|
| **① Capture** | Hotkey notes · web clips · Office/PDF queue | This week’s **stream** (`10-Stream/` or live `role:loose-stream`); uncertain → inbox (`00-Inbox/` / `role:buffer`) | Frictionless instant log |
| **② Continue** | Edit · inline AI · side Agent · organize topics | `{Category}/{YYYY-Topic}/` | Stream cards and topic crystallization |
| **③ Ship / Settle** | Write deliverables · confirm profile / topics | `88-Delivery/` · `memory/profile.md` | Finished files; update personal profile |
| **④ Retrieve / Adjust** | Search · restore · My profile browse · periodic Loop | `99-Archive/` · `memory/` · Loop inspections | Safe archive, memory-plane browse, retrieval |

---

## Three-plane directory model

```text
{workspace}/
├── topmind.yaml              # System plane: behavior contract
├── 00-Inbox/                 # Content plane: buffer (live dir name; role:buffer)
├── 10-Stream/                # Content plane: period notes ({YYYY}/period.md)
├── 20-Topics/2026-Topic/     # Content plane: emergent topic folders
│   └── topic.md              # Topic home
├── 88-Delivery/               # Content plane: flat deliverables
├── 99-Archive/               # Content plane safety: backups · trash · receipts
├── memory/                   # Semantic plane: profile · periodic · topics
└── .topmind/                 # System plane: index & logs (rebuildable)
```

Directory names follow the live contract (`en-US` stream template uses the English names above). Localized or user-renamed names — e.g. `10-动态` / `99-归档`, or a renamed `00-收件箱` — are equally valid.

**6 条核心规约** (six core rules — [`PROJECT-MODEL.md`](./PROJECT-MODEL.md) §3): categories do not overlap; topics emerge naturally; the stream class stays flat by default; fallback classes are cleaned on a ~30-day cadence; reference material has a clear home; category names stay stable (rename via migration).

---

## Capability honesty

| Capability | Status | Notes |
|------------|--------|-------|
| Capture / period notes / editor / clip / ingest | **Done** | Frictionless stream log; Desktop defaults to anydoc → Markdown (optional markitdown/pandoc + built-in fallback) |
| Kernel write gate · Memory loop · stream surface | **Done** | Confirm before durable writes; high-impact actions are reversible |
| Inline AI sanitization | **Done** | Strips thinking tags from model output |
| Keyword search with honest truncation · **no** full-library embeddings | **Done** | Lightweight and transparent |
| AI operations: todo maintain · memory organize · topic classify | **Done** | Activity-window driven; confirm path is safe |
| Optional bookkeeping (`memory/ledgers/`) | **Done** | ledger-engine satellite; Skills `topmind-ledger`; Desktop enable-gated mini-app — not a 6th user concept |
| Multi-lane AI (serial prep + independent agent) | **Done** | Background prep is serial; agent streaming yields |

---

## Four cores + Clip distribution and version sources

**Four cores** ([`PRODUCT-BOUNDARIES.md`](./PRODUCT-BOUNDARIES.md)): Skills · Desktop · UTR · Obsidian — they share content conventions and the workspace behavior contract, with no mandatory runtime binding. **Clip Extension** is a Desktop capture companion (not an independent Kernel host).

Each surface versions independently (majors stay aligned; minors move on their own). One product tag `v*` = one GitHub Release. Run `npm run versions` to print current numbers from truth files only:

- **Skills**: [topmind-skills/topmind-pack.json](https://github.com/topmindspace/topmind-skills/blob/main/topmind-pack.json) — [topmind-skills README](https://github.com/topmindspace/topmind-skills#readme)
- **Desktop**: [`topmind-desktop/package.json`](./topmind-desktop/package.json) — [`topmind-desktop/README.md`](./topmind-desktop/README.md)
- **UTR**: [`utr/VERSION`](./utr/VERSION) — [`TOOLS.md`](./TOOLS.md)
- **Obsidian**: [topmind-obsidian/manifest.json](https://github.com/topmindspace/topmind-obsidian/blob/main/manifest.json) — [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian)
- **Clip Extension**: [`browser-extension/manifest.json`](./browser-extension/manifest.json) — [`browser-extension/README.md`](./browser-extension/README.md)

---

## Local development

```bash
git clone https://github.com/topmindspace/topmind.git
cd topmind

npm run desktop:dev         # Desktop workbench
# Skills tests: https://github.com/topmindspace/topmind-skills (npm test)
npm run validate            # full quality gate
npm run versions            # print surface versions from truth sources
```

Requires **Node.js ≥ 20.11**.

---

## Documentation map

| Topic | Document |
|-------|----------|
| Architecture lock and honesty table | [`docs/ARCHITECTURE-RESET.md`](./docs/ARCHITECTURE-RESET.md) |
| Surface capabilities and hard boundaries | [`PRODUCT-BOUNDARIES.md`](./PRODUCT-BOUNDARIES.md) |
| Data model and 6 条核心规约 | [`PROJECT-MODEL.md`](./PROJECT-MODEL.md) |
| Product interaction and UX | [`DESIGN.md`](./DESIGN.md) |
| Desktop workbench | [`topmind-desktop/README.md`](./topmind-desktop/README.md)（简体中文） · [English](./topmind-desktop/README.en.md) |
| Obsidian plugin | [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) |
| Agent Skills architecture and install | [`SKILL-ARCHITECTURE.md`](./SKILL-ARCHITECTURE.md) · [topmind-skills INSTALL](https://github.com/topmindspace/topmind-skills/blob/main/INSTALL.md) |
| UTR CLI / MCP command dictionary | [`TOOLS.md`](./TOOLS.md) · [`utr/README.md`](./utr/README.md) |
| Browser clip extension | [`browser-extension/README.md`](./browser-extension/README.md)（简体中文） · [English](./browser-extension/README.en.md) |
| Packaging and CI | [`docs/PACKAGING.md`](./docs/PACKAGING.md) |
| Docs sitemap | [`docs/README.md`](./docs/README.md)（简体中文） · [English](./docs/README.en.md) |

**README convention:** every module uses `README.md` for Simplified Chinese (GitHub default) and `README.en.md` for English. `README.zh-CN.md` is a compatibility redirect.

---

## License

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
