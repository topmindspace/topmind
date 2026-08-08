# Topmind Stream for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

[![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-purple?style=flat-square&logo=obsidian)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Minimum Obsidian Version](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-informational?style=flat-square)](https://obsidian.md)
[![Version](https://img.shields.io/badge/version-2.2.0-green.svg?style=flat-square)](manifest.json)

> **Main-area Stream Workbench + Background AI Copilot for Obsidian**  
> Capture thoughts instantly, let AI propose organized updates in the background, review & confirm before saving — your Markdown files always remain yours.

---

## 💡 What is Topmind Stream?

**Topmind Stream** brings the core low-friction **Personal Stream Workflow** of the Topmind engine directly into your Obsidian Vault. 

Traditional note-taking often forces you to make frustrating upfront decisions about folders, tags, and structure before writing. Topmind Stream replaces that friction with a seamless capture-and-settle workflow:

```text
Capture Instantly  ➔  AI Proposes in Background  ➔  You Review & Confirm  ➔  Markdown Files Stay Yours
```

- **Zero Friction Capture**: Jot down ideas, links, or quick snippets without worrying about placement.
- **Local-First & Standard Markdown**: No custom databases or proprietary locking. Everything is stored as plain Markdown in your Vault (`topmind.yaml` + folder categories).
- **Proactive Yet Unobtrusive AI**: AI extracts action items, suggests topic emergence, and organizes memory, but **never mutates your vault without your confirmation**.

---

## ✨ Key Features

- ⚡ **Instant Quick Capture**: Press `Cmd/Ctrl + Shift + S` anytime to log a rapid thought straight into this week's periodic log.
- 🌊 **Stream Workbench View**: A full-featured tab in your Obsidian main workspace featuring a timeline stream of cards and emergent AI suggestions.
- 🔄 **Weekly Reconciliation**: Reconcile your weekly logs, extract pending action items, and refresh suggestions with one click.
- 🤖 **Background AI Copilot**: Automatically extract todos (`memory/todo.md`), suggest emergent topics, and maintain your personal context profile (`memory/profile.md`).
- 📋 **Sidebar Quick Widget**: Keep track of daily todos and quick stream previews from Obsidian's right sidebar.
- 🛡️ **Writeback Protection & Backups**: Every AI modification goes through the Kernel `writeback-engine`, complete with protection levels (`open`/`locked`), automatic backups (`99-归档/backups/`), and path receipts.

---

## 🧩 User Core Concepts (≤ 5)

Topmind Stream reduces mental overhead by focusing on 5 plain-language concepts:

| Concept | Meaning | Vault Location |
|---------|---------|----------------|
| **Capture** (*记一下*) | Save a quick thought / snippet | Weekly Stream Log / `00-收件箱/` |
| **Stream** (*动态*) | Daily activity & timeline | `10-动态/` (weekly file per log) |
| **Topic** (*专题*) | Long-term subject folder | `{Category}/{YYYY-Topic}/` |
| **My Profile** (*我的情况*) | Stable facts & personal memory | `memory/profile.md` |
| **Deliverables** (*写出来*) | Final outputs & published work | `88-输出/` |

---

## 🚀 Quick Start

### 1. Installation

#### Option A: Obsidian Community Plugins (Recommended once listed)
1. Open **Obsidian Settings** ➔ **Community plugins**.
2. Turn off Safe Mode and click **Browse**.
3. Search for **Topmind Stream**.
4. Click **Install** and then **Enable**.

#### Option B: Obsidian BRAT (Beta Builds)
1. Install the [Obsidian BRAT](https://github.com/obsidian-tools/obsidian-brat) plugin.
2. Go to **BRAT Settings** ➔ **Add Plugin**.
3. Enter repository URL: `https://github.com/topmindspace/topmind`
4. Enable **Topmind Stream**.

#### Option C: Manual Installation
1. Download `topmind-obsidian-<version>.zip` from [Releases](https://github.com/topmindspace/topmind/releases) (full `v*` product tags and `obsidian-v*` surface tags both ship this artifact).
2. Extract `main.js`, `manifest.json`, `styles.css`, and `templates/` to:
   `<your-vault>/.obsidian/plugins/topmind-stream/`
3. Reload Obsidian, navigate to **Settings ➔ Community plugins**, and enable **Topmind Stream**.

#### Upgrade
| Method | How |
|--------|-----|
| Community / BRAT | Update from the plugin list / BRAT “Check for updates” |
| Manual zip | Download the newer `topmind-obsidian-<ver>.zip`, replace files under `plugins/topmind-stream/`, reload Obsidian |
| From source | `npm run obsidian:pack` → install zip as above |

Your vault files (`topmind.yaml`, `10-动态/`, `memory/`) are **not** replaced by the plugin upgrade. Version truth: [`manifest.json`](./manifest.json) (`npm run versions`).

---

### 2. Workspace Initialization

When first enabled, Topmind Stream checks if your vault already contains a Topmind workspace structure (`topmind.yaml` and standard numbered folders).

- **Existing Workspace**: Automatically detected; no setup needed.
- **New Vault**: Go to **Settings ➔ Topmind Stream**, select a template (`stream`, `balanced`, `research`, or `periodic`), and click **Initialize Workspace**.

---

### 3. Configure AI Copilot (Optional)

Navigate to **Settings ➔ Topmind Stream ➔ AI Copilot**:

- Select your provider: **DeepSeek**, **OpenAI**, **Anthropic**, **Ollama** (local), or **Custom Endpoint**.
- Input your **API Key** and model name (e.g. `deepseek-chat`, `gpt-4o`, `claude-3-5-sonnet`).
- Choose **Writeback Mode**:
  - `confirm` (*Ask before saving* — Recommended): Preview changes in the Suggestion Popover before writing.
  - `auto` (*Auto Save*): Automatically apply AI suggestions with automatic background backups.

> ℹ️ *AI is completely optional! Quick capture, timeline browsing, and manual weekly reconciliation work seamlessly without an API key.*

---

### 4. Daily Usage

- Command palette ➔ **Topmind: Note it** (*bind a hotkey in Obsidian Settings ➔ Hotkeys*).
- `Cmd/Ctrl + P` ➔ **Topmind: Open Stream Workbench** to open the timeline tab.
- Click the **Waves icon** in the left ribbon to open **Note it** instantly.

Product vocabulary (aligned with Desktop): **Note it** / 记一下 · **Log it** / 记下 · stream · topic · My profile · write out.

---

## ⌨️ Command Palette Reference

| Command Name | Description |
|--------------|-------------|
| `Topmind: Open Stream Workbench` | Open the main timeline workbench tab |
| `Topmind: Note it` | Capture a note or snippet (default: this week’s stream) |
| `Topmind: Organize This Week` | Reconcile weekly log & refresh suggestions |
| `Topmind: AI Maintain Todos` | Run AI todo extraction on recent activities |

---

## 🏗️ Architecture & Ecosystem

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
| **AI Runtime** | Vercel AI SDK v7 | Direct fetch API (OpenAI / Anthropic compat) |
| **Shared Engine** | Kernel `lib/` 8-Engine | Kernel `lib/` 8-Engine (bundled) |
| **Data Format** | Standard Markdown | Standard Markdown (Same Vault) |

*You can open the exact same Vault in both Topmind Desktop and Obsidian simultaneously without conflicts.*

---

## 🔒 Security, Privacy & Data Safety

- **Local-First Storage**: All notes and metadata reside in standard Markdown files on your disk.
- **Zero Telemetry**: Topmind does not track, collect, or send your usage data to external servers.
- **API Key Security**: API Keys are stored locally in the plugin's `data.json` inside your vault's `.obsidian` directory.
- **Writeback Protection**: All AI-driven file changes pass through `writeback-engine` which enforces file protection levels (`open`/`locked`), soft backup creation (`99-归档/backups/`), and path receipts.

---

## 🛠️ Development & Building

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

## 📋 Requirements

- **Obsidian Version**: Desktop ≥ `v1.5.0` (Mobile currently unsupported; desktop-first design).
- **Node.js**: ≥ `v20.11` (for building from source).

---

## 📄 License

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
