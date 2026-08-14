# Topmind Stream for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-purple?style=flat-square&logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Minimum Obsidian Version](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-informational?style=flat-square)](https://obsidian.md)
[![Version](https://img.shields.io/badge/version-dynamic-green.svg?style=flat-square)](manifest.json)

> **Main-area Stream + Background AI Copilot for Obsidian**  
> Capture thoughts instantly, let AI propose organized updates in the background, review & confirm before saving — your Markdown files always remain yours.

---

## What is Topmind Stream?

**Topmind Stream** brings the core low-friction **Personal Stream Workflow** of the Topmind engine directly into your Obsidian Vault.

Traditional note-taking often forces you to make frustrating upfront decisions about folders, tags, and structure before writing. Topmind Stream replaces that friction with a seamless capture-and-settle workflow:

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
Capture Instantly  ->  AI Proposes in Background  ->  You Review & Confirm  ->  Markdown Files Stay Yours
```

- **Zero Friction Capture**: Jot down ideas, links, or quick snippets without worrying about placement.
- **Local-First & Standard Markdown**: No custom databases or proprietary locking. Everything is stored as plain Markdown in your Vault (`topmind.yaml` + folder categories).
- **Proactive Yet Unobtrusive AI**: AI extracts action items, suggests topic emergence, and organizes memory, but **never mutates your vault without your confirmation**.

---

## Key Features

- **Note it**: Open the capture modal (bind a hotkey in Obsidian Settings → Hotkeys). Destinations: this week's stream or Inbox.
- **Stream view**: A tab in the Obsidian main area with a compose box (**Log it** into the period note), a timeline of cards, and AI suggestions.
- **AI Copilot Panel** (Sidebar): A tabbed right sidebar unifying all AI capabilities — **Todos**, **Suggestions**, **Chat**, and **Stream** — in one place. Includes a model badge showing the active AI provider + model.
- **AI Chat**: Converse with AI about your notes, todos, and stream entries. The chat is context-aware — it automatically injects your recent stream entries, current todos, and personal profile.
- **Weekly Reconciliation**: Reconcile your weekly logs, extract pending action items, and refresh suggestions with one click.
- **Background AI Copilot**: Automatically extract todos (`memory/todo.md`), suggest emergent topics, and maintain your personal context profile (`memory/profile.md`).
- **Quick Settings Access**: One-click access to plugin settings from both the sidebar header and the workbench toolbar. Model badge shows the currently active AI provider + model.
- **Writeback Protection**: Every AI modification goes through the Kernel `writeback-engine` (`open`/`locked`). Backups and receipts are **high-impact only** (locked overwrite; delete/archive of locked/core notes). Ordinary open updates do not create Archive copies.

---

## User Core Concepts (≤ 5)

Topmind Stream reduces mental overhead by focusing on 5 plain-language concepts:

| Concept | Meaning | Vault Location |
|---------|---------|----------------|
| **Capture** (*记一下*) | Save a quick thought / snippet | Weekly Stream Log / `00-收件箱/` |
| **Stream** (*动态*) | Daily activity & timeline | `10-动态/` (weekly file per log) |
| **Topic** (*专题*) | Long-term subject folder | `{Category}/{YYYY-Topic}/` |
| **My Profile** (*我的情况*) | Stable facts & personal memory | `memory/profile.md` |
| **Deliverables** (*写出来*) | Final outputs & published work | `88-输出/` |

---

## Quick Start

### 1. Installation

#### Option A: Obsidian Community Plugins (Recommended once listed)
1. Open **Obsidian Settings** -> **Community plugins**.
2. Turn off Safe Mode and click **Browse**.
3. Search for **Topmind Stream**.
4. Click **Install** and then **Enable**.

#### Option B: Obsidian BRAT (Beta Builds)
1. Install the [Obsidian BRAT](https://github.com/obsidian-tools/obsidian-brat) plugin.
2. Go to **BRAT Settings** -> **Add Plugin**.
3. Enter repository URL: `https://github.com/topmindspace/topmind`
4. Enable **Topmind Stream**.

#### Option C: Manual Installation
1. Download `topmind-obsidian-<version>.zip` from [Releases](https://github.com/topmindspace/topmind/releases) (full `v*` product tags and `obsidian-v*` surface tags both ship this artifact).
2. Extract `main.js`, `manifest.json`, `styles.css`, and `templates/` to:
   `<your-vault>/.obsidian/plugins/topmind-stream/`
3. Reload Obsidian, navigate to **Settings -> Community plugins**, and enable **Topmind Stream**.

#### Upgrade
| Method | How |
|--------|-----|
| Community / BRAT | Update from the plugin list / BRAT "Check for updates" |
| Manual zip | Download the newer `topmind-obsidian-<ver>.zip`, replace files under `plugins/topmind-stream/`, reload Obsidian |
| From source | `npm run obsidian:pack` -> install zip as above |

Your vault files (`topmind.yaml`, `10-动态/`, `memory/`) are **not** replaced by the plugin upgrade. Version truth: [`manifest.json`](./manifest.json) (`npm run versions`).

---

### 2. Workspace Initialization

When first enabled, Topmind Stream checks if your vault already contains a Topmind workspace structure (`topmind.yaml` and standard numbered folders).

- **Existing Workspace**: Automatically detected; no setup needed.
- **New Vault**: Go to **Settings -> Topmind Stream**, select a template (`stream`, `balanced`, `research`, or `periodic`), and click **Initialize Workspace**.

---

### 3. Configure AI Copilot (Optional)

Navigate to **Settings -> Topmind Stream -> AI Copilot**:

- **Multi-provider**: Configure all your API keys at once — OpenAI, Anthropic, Google Gemini, DeepSeek, Moonshot, Zhipu, MiniMax, xAI, Ollama (local), or Custom endpoint.
- Set a **default provider** preference, or let the plugin auto-select the first configured one.
- Optionally pick a **model**. Lists resolve from three sources (official provider `list-models` when a key/endpoint exists, then the [models.dev](https://models.dev) community catalog via Obsidian `requestUrl`, then curated defaults). Refresh force-bypasses cache; a failed download is not stored as live. Custom model IDs stay selectable.
- **Import from Desktop**: One-click import of AI keys from topmind Desktop. Works with encrypted keys — use Desktop's **Settings → AI → Export for Obsidian** to create a plaintext export file, then click **Import from Desktop** in the plugin settings.
- Choose **Writeback Mode**:
  - `confirm` (*Ask before saving* — Recommended): Preview changes in the Suggestion Popover before writing.
  - `auto` (*Auto Save*): Automatically apply AI suggestions with automatic background backups.

*Note: AI is completely optional! Quick capture, timeline browsing, and manual weekly reconciliation work seamlessly without an API key.*

---

### 4. Daily Usage

- Command palette -> **Topmind: Note it** (*bind a hotkey in Obsidian Settings -> Hotkeys*).
- `Cmd/Ctrl + P` -> **Topmind: Open Stream** to open the timeline tab.
- Click the **Waves icon** in the left ribbon to open **Note it** instantly.

Product vocabulary (aligned with Desktop): **Note it** / 记一下 · **Log it** / 记下 · stream · topic · My profile · write out.

---

## Command Palette Reference

| Command Name | Description |
|--------------|-------------|
| `Topmind: Note it` | Capture a note or snippet (default: this week's stream) |
| `Topmind: Open Stream` | Open the Stream timeline tab |
| `Topmind: Open Sidebar` | Open the sidebar dock widget |
| `Topmind: Organize This Week` | Reconcile weekly log & refresh suggestions |
| `Topmind: Refresh AI Suggestions` | Regenerate AI suggestion cards |
| `Topmind: AI Maintain Todos` | Run AI todo extraction on recent activities |
| `Topmind: Classify Topics` | Run AI topic classification |
| `Topmind: Organize My Profile` | Run AI organization of My profile (profile + periodic) |
| `Topmind: Open My Profile` | Open `memory/profile.md` |
| `Topmind: Open Inbox` | Open the inbox category directory |

---

## Architecture & Ecosystem

Topmind Stream is an optional surface of the **Topmind Monorepo Ecosystem**. It shares the exact same core Kernel engine and directory contract with Topmind Desktop, UTR CLI, and Portable AI Skills.

```text
Obsidian Surface (TypeScript + esbuild)
  ├── ItemView & Sidebar Widgets
  ├── Settings Tab (PluginSettingTab)
  └── Vault Bridge & AI Provider Layer
        │
        ▼
Kernel 八引擎 (Bundled lib/*.mjs)
  contract · workspace-model · stream · memory
  writeback · lifecycle · derived · ingest
  + todo / ai-operation / suggest / activity-window
        │
        ▼
Obsidian Vault (Plain Filesystem = Single Source of Truth)
  topmind.yaml + {NN-Category}/ + memory/ + .topmind/
```

### Comparison: Desktop App vs. Obsidian Plugin

| Feature / Aspect | Topmind Desktop | Topmind Obsidian Plugin |
|------------------|-----------------|-------------------------|
| **Primary Focus** | Standalone rich desktop app | Native embedded view inside Obsidian |
| **Editor Type** | Tiptap rich text & WYSIWYG | Obsidian native Markdown editor |
| **AI Runtime** | Vercel AI SDK v7 | Obsidian `requestUrl` (OpenAI / Anthropic / Gemini compat) |
| **Shared Engine** | Kernel `lib/` 8-Engine | Kernel `lib/` 8-Engine (bundled) |
| **Data Format** | Standard Markdown | Standard Markdown (Same Vault) |

*You can open the exact same Vault in both Topmind Desktop and Obsidian simultaneously without conflicts.*

---

## Security, Privacy & Data Safety

- **Local-First Storage**: All notes and metadata reside in standard Markdown files on your disk.
- **Zero Telemetry**: Topmind does not track, collect, or send your usage data to external servers.
- **API Key Security**: API Keys are stored locally in the plugin's `data.json` inside your vault's `.obsidian` directory.
- **Writeback Protection**: All AI-driven file changes pass through `writeback-engine` (`open`/`locked`). Backups/receipts only for locked overwrite and locked/core delete-archive — not every write.

---

## Development & Building

```bash
# Install dependencies
npm install

# Start esbuild watch mode
npm run dev

# Production build
npm run build

# Run TypeScript type check
npm run typecheck

# Run unit tests
npm test

# Verify package integrity
npm run pack:verify

# Create release ZIP package
npm run pack
```

---

## Requirements

- **Obsidian Version**: Desktop ≥ `v1.5.0` (Mobile currently unsupported; desktop-first design).
- **Node.js**: ≥ `v20.11` (for building from source).

---

## License

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
