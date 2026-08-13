# topmind

[中文](README.md) · [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/topmindspace/topmind?style=flat-square&color=blue)](https://github.com/topmindspace/topmind/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Node Version](https://img.shields.io/badge/Node.js-%E2%89%A520.11-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20Obsidian%20%7C%20Chrome-purple?style=flat-square)](#quick-start--installation-guide)
[![Build Status](https://img.shields.io/github/actions/workflow/status/topmindspace/topmind/ci.yml?style=flat-square&label=CI)](https://github.com/topmindspace/topmind/actions)

> **Local-First Personal Stream & Knowledge Workbench in the AI Agent Era**  
> **Just Log It** → **AI Assists with Suggestions / Todos / Memory** → **You Review & Confirm** → **Files Stay Yours Forever**

---

## Primary Interface & Product Demo (Showcase)

### Primary Stream Interface (Stream & AI Suggestions)

<p align="center">
  <img src="./docs/images/desktop-stream.jpg" alt="Topmind Stream Surface with AI Suggestions" width="780" />
</p>

### Full Product Demo

<p align="center">
  <img src="./docs/images/topmind-demo.gif" alt="Topmind Full Interactive Product Demo" width="820" />
</p>

<p align="center">
  <sub>If video playback is unavailable in your environment, download or open <a href="./docs/images/topmind-demo.mp4">HD MP4 Video File</a> directly</sub>
</p>

---

## Why Topmind?

Traditional note-taking tools (like Obsidian or Logseq) and modern AI knowledge bases often suffer from a major friction point: **excessive organization overhead**. Users waste energy manually tagging, categorizing, and linking notes instead of focusing on deep thinking and creation.

Topmind is built to be a **low-friction, flexible, and all-in-one** personal knowledge companion:

- **Instant Capture, Zero Burden**: Quick thoughts, web clips, document ingests, and drafting happen naturally without deciding "where to put it".
- **Log First, Organize Later**: Driven by a personal Stream time-axis. Capture now, categorize when ready.
- **Proactive Yet Unobtrusive AI**: AI understands workspace context, offering smart suggestions, todo maintenance, and memory synthesis — **AI suggests and carries the weight; you retain final authority**.
- **Local-First & Transparent**: Standard Markdown files stored directly on your disk. No vendor lock-in, no hidden proprietary databases.

---

## Quick Start & Installation Guide

Topmind consists of four core surfaces and one clip companion extension. Choose the entry point that best fits your workflow:

```text
topmind  =  Portable Skills  ⊕  Optional Desktop  ⊕  Optional UTR  ⊕  Optional Obsidian
            AI Skills Pack        Desktop App           CLI / MCP Tools      Vault Plugin
          + Optional Clip Extension (Desktop capture companion)
```

### Scenario 1: Standalone Desktop App (Topmind Desktop)

> Ideal for: Users who want a dedicated rich text app with visual AI confirmation UI.

- **Option A: Homebrew Install (Recommended for macOS)**:
  ```bash
  brew install topmindspace/tap/topmind
  ```
  *Installing via Homebrew automatically clears macOS `quarantine` flags and bypasses unverified developer errors.*

- **Option B: Manual Installer Download**:
  1. Download installers (`.dmg` / `.exe` / `.AppImage` / `.deb`) from [Releases](https://github.com/topmindspace/topmind/releases).
  2. Launch app, and press `⌘N` (Mac) / `Ctrl+N` (Win) to capture a note instantly.  
     *(If macOS prompts damaged file error on manual download, run: `sudo xattr -rd com.apple.quarantine /Applications/Topmind.app`)*
  3. Detailed Guide: [`topmind-desktop/README.md`](./topmind-desktop/README.md)

### Scenario 2: Embedded in Obsidian (Topmind Stream Plugin)

> Ideal for: Users who want Personal Stream inside their existing Obsidian Vault.

- **Option A: Obsidian Community Plugin Store**:
  *(Plugin submission in review)* Once approved, search `topmind stream` in Obsidian **Settings ➔ Community Plugins ➔ Browse** to install in 1 click.
- **Option B: Via BRAT Plugin**:
  Add GitHub repo `topmindspace/topmind` in Obsidian BRAT plugin.
- **Option C: Manual Extraction**:
  Download `topmind-obsidian-<ver>.zip` from [Releases](https://github.com/topmindspace/topmind/releases) and extract to `<Vault>/.obsidian/plugins/topmind-stream/`.
- Detailed Guide: [`obsidian-plugin/README.md`](./obsidian-plugin/README.md)

### Scenario 3: Agent Skills Pack (Claude Code / OpenCode / Codex)

> Ideal for: Users driving local workflows via AI Agents.

- **Option A (Via Community CLI & skills.sh Direct Install)**:
  ```bash
  npx skills add topmindspace/topmind -g -y
  ```
- **Option B (Via Desktop UI · Recommended)**:  
  Open Desktop ➔ **Settings ➔ Updates & Management**: Desktop automatically detects local Agent hosts and installs Skills globally.
- **Option C (Source CLI Install)**:  
  ```bash
  npm run skills:install        # Or node scripts/install-skills.mjs add topmindspace/topmind -g
  ```
- Detailed Guide: [`skills/INSTALL.md`](./skills/INSTALL.md) · [`SKILL-ARCHITECTURE.md`](./SKILL-ARCHITECTURE.md)

### Scenario 4: Browser Web Clipper (Clip Extension)

> Ideal for: One-click web page clip & content parsing.

1. Click "Prepare Clip Extension" in Desktop **Settings ➔ Updates & Management**, and follow instructions to load in Chrome/Edge.
2. Or download `topmind-clip-extension-<ver>.zip` from [Releases](https://github.com/topmindspace/topmind/releases) and load manually.
3. Detailed Guide: [`browser-extension/README.md`](./browser-extension/README.md)

### Scenario 5: Terminal CLI & MCP Server (UTR CLI / MCP)

> Ideal for: Users running deterministic tools in Terminal or MCP Server environments.

- Bundled automatically with Desktop app, or accessible directly from source `utr/` directory.
- Tool commands:
  ```bash
  npm run utr:doctor            # Run UTR toolchain diagnosis
  npm run utr:list              # List current 8 domains / 28 commands
  ```
- Detailed Guide: [`TOOLS.md`](./TOOLS.md) · [`utr/README.md`](./utr/README.md)

---

## Core Workflow

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
Capture -> Continue -> Ship/Settle -> Retrieve/Adjust
```

| Phase | User Action | Default Destination | Description |
|-------|-------------|---------------------|-------------|
| **① Capture** | Quick hotkey notes · Web clips · Office/PDF queue (anydoc default) | Weekly **Stream** file (`10-动态/`); fallback to `00-收件箱/` | Frictionless instant log |
| **② Continue** | Edit · Inline AI · Side Agent · Organize topics | `{Category}/{YYYY-Topic}/` | Stream cards & topic crystallization |
| **③ Ship/Settle** | Draft outputs · Update profile & periodic memory | `88-输出/` · `memory/profile.md` | Produce final deliverables |
| **④ Retrieve/Adjust** | Search · Restore · Periodic loops | `99-归档/` · Loop inspections | Safe backup & retrieval |

---

## Three-Plane Directory Model

Topmind organizes workspaces into three transparent, predictable planes:

```text
{Workspace}/
├── topmind.yaml              # System Plane: Contract & Facade Settings
├── 00-收件箱/                # Content Plane: Buffer inbox
├── 10-动态/                  # Content Plane: Personal Stream ({YYYY}/period.md)
├── 20-专题/2026-Topic/        # Content Plane: Emerging Topic Folders
│   └── topic.md              # Topic Home
├── 88-输出/                  # Content Plane: Deliverable files
├── 99-归档/                  # Content Plane Safety: backups · trash · receipts
├── memory/                   # Semantic Plane: profile & periodic reflections
└── .topmind/                 # System Plane: Index & Logs (rebuildable)
```

---

## Core Capability Honesty Table

| Capability | Status | Description |
|------------|--------|-------------|
| Capture / Stream / Editor / Ingest | **Done** | Frictionless streaming log; Desktop defaults to anydoc → Markdown (optional markitdown/pandoc + built-in fallback) |
| Kernel Writeback Gate · Memory Loop | **Done** | Confirmation before writeback; revertible actions |
| Inline AI Sanitize | **Done** | Automatically strips thinking tags from LLM responses |
| Keyword Search Truncation | **Done** | Honest local search; no unneeded full-database embeddings |
| AI Operations (Todo maintain · Memory organize · Topic classify) | **Done** | profile + periodic memory; content-category topics; confirm mode |
| Multi-AI Serial & Independent Sessions | **Done** | Background prep serial; agent streaming yields |

---

## Four Cores + Clip Distribution & Version Sources

**Four cores** ([`PRODUCT-BOUNDARIES.md`](./PRODUCT-BOUNDARIES.md)): Skills · Desktop · UTR · Obsidian — share content contracts and behavioral pacts, with no mandatory runtime binding. **Clip Extension** is a companion distribution surface for Desktop capture (not an independent Kernel host). Each surface manages its version independently (major aligned, minor independent). Run `npm run versions` to check.
- **Skills**: [`skills/topmind-pack.json`](./skills/topmind-pack.json) (Documentation: [`skills/INSTALL.md`](./skills/INSTALL.md))
- **Desktop**: [`topmind-desktop/package.json`](./topmind-desktop/package.json) (Documentation: [`topmind-desktop/README.md`](./topmind-desktop/README.md))
- **UTR**: [`utr/VERSION`](./utr/VERSION) (Documentation: [`TOOLS.md`](./TOOLS.md))
- **Obsidian**: [`obsidian-plugin/manifest.json`](./obsidian-plugin/manifest.json) (Documentation: [`obsidian-plugin/README.md`](./obsidian-plugin/README.md))
- **Clip Extension**: [`browser-extension/manifest.json`](./browser-extension/manifest.json) (Documentation: [`browser-extension/README.md`](./browser-extension/README.md))

---

## Local Development

```bash
# Clone repository
git clone https://github.com/topmindspace/topmind.git
cd topmind

# Launch Desktop dev mode
npm run desktop:dev

# Run skills test suite
npm run skills:test

# Run full quality gate validation
npm run validate
npm run versions
```

---

## Documentation Sitemap

| Topic | Document |
|-------|----------|
| Architecture Reset & Honesty State | [`docs/ARCHITECTURE-RESET.md`](./docs/ARCHITECTURE-RESET.md) |
| Product Boundaries | [`PRODUCT-BOUNDARIES.md`](./PRODUCT-BOUNDARIES.md) |
| Project & Content Model | [`PROJECT-MODEL.md`](./PROJECT-MODEL.md) |
| UI/UX Design System | [`DESIGN.md`](./DESIGN.md) |
| Desktop Workbench | [`topmind-desktop/README.md`](./topmind-desktop/README.md) |
| Obsidian Plugin | [`obsidian-plugin/README.md`](./obsidian-plugin/README.md) |
| Agent Skills Pack | [`SKILL-ARCHITECTURE.md`](./SKILL-ARCHITECTURE.md) · [`skills/INSTALL.md`](./skills/INSTALL.md) |
| UTR Tools & MCP | [`TOOLS.md`](./TOOLS.md) · [`utr/README.md`](./utr/README.md) |
| Web Clip Extension | [`browser-extension/README.md`](./browser-extension/README.md) |
| Packaging & CI/CD | [`docs/PACKAGING.md`](./docs/PACKAGING.md) |
| Global Docs Sitemap | [`docs/README.md`](./docs/README.md) |

---

## License

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
