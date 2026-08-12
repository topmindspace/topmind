# topmind Stream for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

[![Obsidian 插件](https://img.shields.io/badge/Obsidian-%E6%8F%92%E4%BB%B6-purple?style=flat-square&logo=obsidian)](https://obsidian.md)
[![开源协议: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![最低 Obsidian 版本](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-informational?style=flat-square)](https://obsidian.md)
[![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-dynamic-green.svg?style=flat-square)](manifest.json)

> **Obsidian 的「主区域流式工作台 + 静默 AI 沉淀副驾」**  
> 随手记下、AI 默认建议、用户确认后再沉淀、文件永远属于本地。

---

## 这是什么？

**topmind Stream** 将 topmind 引擎的核心**低摩擦个人动态流工作流**带入 Obsidian。

传统的笔记软件往往强迫在写作前做出繁琐的分类、标签和结构决策。topmind Stream 用无缝的「捕获-沉淀」闭环替代了这种摩擦：

```text
随手记下  ->  AI 后台默认建议  ->  用户确认后再沉淀  ->  文件永远属于本地
```

- **零负担记录**：突发的随笔想法、网页剪藏、代码片段随意记下，不再为「放在哪里」而犹豫。
- **本地优先与纯标准 Markdown**：无专有数据库锁定，无私有格式。所有数据均存储在 Vault 中（`topmind.yaml` + 编号分类目录）。
- **主动而不打扰的 AI 辅助**：后台自动提取待办事项、建议专题涌现、整理记忆，但**未经用户确认，绝对不会擅自修改本地文件**。

---

## 核心能力

- **极速捕捉**：快捷键 `Cmd/Ctrl + Shift + S` 随时记一条，静默写入本周动态周期本。
- **动态工作台视图**：Obsidian 主区域的独立页签，集成工具栏（快速进入侧边栏/设置/新笔记/画像）、时间轴卡片流与 AI 涌现建议。
- **AI 副驾面板**（侧边栏）：标签式右侧面板统一汇聚全部 AI 能力 — **待办**、**建议**、**对话**、**动态** — 一站式管理。头部显示 AI 状态 + 模型徽章 + 快速设置入口。
- **AI 对话**：与 AI 对话你的笔记、待办和动态。上下文感知 — 自动注入近期动态条目、当前待办和个人画像，让 AI 回答更有针对性。
- **整理本周**：一键 reconcile 周期本、AI 提取待办事项并刷新涌现建议。
- **后台 AI 副驾**：自动提炼待办（`memory/todo.md`）、建议专题涌现、整理个人画像记忆（`memory/profile.md`）。
- **快速设置入口**：侧边栏头部 ⚙ 按钮 + 工作台工具栏 ⚙ 按钮一键进入插件设置。模型徽章实时显示当前 AI 服务商 + 模型。
- **安全写回与备份**：所有写入经由 Kernel `writeback-engine` 闸口，包含保护级别判定（`open`/`locked`）；**仅高影响**（locked 覆盖、删除/归档）写入 `99-归档/` 备份与回执。

---

## 用户核心概念（≤ 5）

topmind Stream 通过 5 个通俗直观的概念降低认知负担：

| 概念 | 含义 | Vault 落点 |
|------|------|------------|
| **记一下** | 随手存一条想法/片段 | 本周动态周期本 / `00-收件箱/` |
| **动态** | 日常流水与时间轴 | `10-动态/`（每周一本） |
| **专题** | 长期主题归档 | `{大类}/{YYYY-主题}/` |
| **我的情况** | 关于稳定的信息与记忆 | `memory/profile.md` |
| **写出来** | 最终输出成品与文章 | `88-输出/` |

---

## 快速开始

### 1. 安装

#### 方式 A：Obsidian 官方社区插件市场（发布审核中）
1. 打开 **Obsidian 设置** → **社区插件**。
2. 关闭安全模式，点击 **浏览**。
3. 搜索 **Topmind Stream**。
4. 点击 **安装**，然后 **启用**。

#### 方式 B：使用 BRAT 插件一键安装
1. 在 Obsidian 社区插件中安装并启用 **BRAT** (TfTHacker / obsidian-42-brat)。
2. 打开 BRAT 设置，点击 **Add Beta plugin**。
3. 输入仓库地址：`topmindspace/topmind`
4. 点击 Add Plugin，启用 **Topmind Stream**。

#### 方式 C：手动解压安装
1. 从 [GitHub Releases](https://github.com/topmindspace/topmind/releases) 下载最新版的 `topmind-obsidian-<ver>.zip`。
2. 解压并将 `topmind-stream` 文件夹放入你的 Obsidian Vault 目录：`<Vault>/.obsidian/plugins/`。
3. 重新打开 Obsidian，在 **设置 → 社区插件** 中开启 **Topmind Stream**。

#### 升级
| 方式 | 操作 |
|------|------|
| 社区市场 / BRAT | 从插件列表更新 / BRAT「检查更新」 |
| 手动 zip | 下载新版 `topmind-obsidian-<ver>.zip`，替换 `plugins/topmind-stream/` 下的文件，重新加载 Obsidian |
| 从源码构建 | `npm run obsidian:pack` → 按上述方式安装 |

你的 Vault 文件（`topmind.yaml`、`10-动态/`、`memory/`）**不会**被插件升级替换。版本真源：[`manifest.json`](./manifest.json)（`npm run versions`）。

---

### 2. 初始化工作区

首次启用时，Topmind Stream 会检查你的 Vault 是否已包含 topmind 工作区结构（`topmind.yaml` 和编号分类目录）。

- **已有工作区**：自动检测，无需设置。
- **全新 Vault**：进入 **设置 → Topmind Stream**，选择模板（`stream`、`balanced`、`research` 或 `periodic`），点击 **初始化工作区**。

---

### 3. 配置 AI 副驾（可选）

进入 **设置 → Topmind Stream → AI 副驾**：

- **多服务商**：一次性配置所有 API 密钥 — OpenAI、Anthropic、Google Gemini、DeepSeek、Moonshot、Zhipu、MiniMax、xAI、Ollama（本地）或自定义端点。
- 设置**默认服务商**偏好，或让插件自动选择第一个已配置的服务商。
- 可选从动态模型列表中挑选**模型**（通过 Obsidian `requestUrl` 从 [models.dev](https://models.dev) 社区目录获取，跨平台兼容，含精选回退默认值）。
- **从 Desktop 导入**：一键导入 topmind Desktop 的 `app-settings.json` 中已配置的 AI 密钥。
- 选择**写回模式**：
  - `confirm`（*保存前问我* — 推荐）：在写入前预览变更。
  - `auto`（*自动保存*）：自动应用 AI 建议，同时自动创建后台备份。

*注：AI 完全是可选的！极速捕捉、时间轴浏览和手动周整理无需 API 密钥即可流畅使用。*

---

### 4. 日常使用

- 命令面板 → **Topmind: 记一下**（在 Obsidian 设置 → 快捷键 中绑定快捷键）。
- `Cmd/Ctrl + P` → **Topmind: 打开动态工作台** 打开时间轴页签。
- 点击左侧 Ribbon 栏的 **波浪图标** 即可打开**记一下**。

产品词汇（与 Desktop 对齐）：**记一下** / Note it · **记下** / Log it · 动态 · 专题 · 我的情况 · 写出来。

---

## 命令面板参考

| 命令 | 说明 |
|------|------|
| `Topmind: 记一下` | 捕捉笔记或片段（默认：本周动态） |
| `Topmind: 打开动态工作台` | 打开主时间轴工作台页签 |
| `Topmind: 打开侧边栏` | 打开侧边栏面板 |
| `Topmind: 整理本周` | 整理周期本并刷新建议 |
| `Topmind: 刷新 AI 建议` | 重新生成 AI 建议卡片 |
| `Topmind: AI 整理待办` | 对近期活动运行 AI 待办提取 |
| `Topmind: 主题分类` | 运行 AI 主题分类 |
| `Topmind: 整理记忆` | 运行 AI 记忆整理（画像 + 周期） |
| `Topmind: 打开我的情况` | 打开 `memory/profile.md` |
| `Topmind: 打开收件箱` | 打开收件箱分类目录 |

---

## 架构与生态

Topmind Stream 是 **Topmind Monorepo 生态**的一个可选表面。它与 Topmind Desktop、UTR CLI 和便携 AI Skills 共享同一套核心 Kernel 引擎和目录契约。

```text
Obsidian 表面 (TypeScript + esbuild)
  ├── ItemView 与侧边栏面板
  ├── 设置页签 (PluginSettingTab)
  └── Vault 桥接与 AI Provider 层
        │
        ▼
Kernel 八引擎 (打包 lib/*.mjs)
  contract · workspace-model · stream · memory
  writeback · lifecycle · derived · ingest
  + todo / ai-operation / suggest / activity-window
        │
        ▼
Obsidian Vault (纯文件系统 = 唯一内容真源)
  topmind.yaml + {NN-分类}/ + memory/ + .topmind/
```

### 对比：Desktop 应用 vs. Obsidian 插件

| 特性 / 维度 | Topmind Desktop | Topmind Obsidian 插件 |
|-------------|-----------------|----------------------|
| **主要定位** | 独立富桌面应用 | Obsidian 内嵌原生视图 |
| **编辑器类型** | Tiptap 富文本 & 所见即所得 | Obsidian 原生 Markdown 编辑器 |
| **AI 运行时** | Vercel AI SDK v7 | Obsidian `requestUrl`（OpenAI / Anthropic / Gemini 兼容） |
| **共享引擎** | Kernel `lib/` 八引擎 | Kernel `lib/` 八引擎（打包内联） |
| **数据格式** | 标准 Markdown | 标准 Markdown（同一 Vault） |

*你可以在 Topmind Desktop 和 Obsidian 中同时打开同一个 Vault，互不冲突。*

---

## 安全、隐私与数据保护

- **本地优先存储**：所有笔记和元数据均以标准 Markdown 文件存储在你的磁盘上。
- **零遥测**：topmind 不追踪、不收集、不向外部服务器发送你的使用数据。
- **API Key 安全**：API 密钥存储在 Vault 的 `.obsidian` 目录下插件的 `data.json` 中。
- **写回保护**：所有 AI 驱动的文件变更通过 `writeback-engine`，强制执行文件保护级别（`open`/`locked`）、软备份创建（`99-归档/backups/`）和路径回执。

---

## 开发与构建

```bash
# 安装依赖
npm install

# 启动 esbuild watch 模式
npm run dev

# 生产构建
npm run build

# TypeScript 类型检查
npm run typecheck

# 运行单元测试
npm test

# 验证打包完整性
npm run pack:verify

# 创建 release ZIP 包
npm run pack
```

---

## 环境要求

- **Obsidian 版本**：桌面端 ≥ `v1.5.0`（暂不支持移动端；桌面优先设计）。
- **Node.js**：≥ `v20.11`（从源码构建需要）。

---

## 协议

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
