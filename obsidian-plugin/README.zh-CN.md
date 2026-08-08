# topmind Stream for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

[![Obsidian 插件](https://img.shields.io/badge/Obsidian-%E6%8F%92%E4%BB%B6-purple?style=flat-square&logo=obsidian)](https://obsidian.md)
[![开源协议: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![最低 Obsidian 版本](https://img.shields.io/badge/Obsidian-%E2%89%A51.5.0-informational?style=flat-square)](https://obsidian.md)
[![版本](https://img.shields.io/badge/%E7%89%88%E6%9C%AC-2.2.0-green.svg?style=flat-square)](manifest.json)

> **Obsidian 的「主区域流式工作台 + 静默 AI 沉淀副驾」**  
> 随手记下、AI 默认建议、你确认后再沉淀、文件永远属于你。

---

## 💡 这是什么？

**topmind Stream** 将 topmind 引擎的核心**低摩擦个人动态流工作流**带入 Obsidian。

传统的笔记软件往往强迫你在写作前做出繁琐的分类、标签和结构决策。topmind Stream 用无缝的「捕获-沉淀」闭环替代了这种摩擦：

```text
随手记下  ➔  AI 后台默认建议  ➔  你点头确认后再沉淀  ➔  文件永远属于你
```

- **零负担记录**：突发的随笔想法、网页剪藏、代码片段随意记下，不再为「放在哪里」而犹豫。
- **本地优先与纯标准 Markdown**：无专有数据库锁定，无私有格式。所有数据均存储在你的 Vault 中（`topmind.yaml` + 编号分类目录）。
- **主动而不打扰的 AI 辅助**：后台自动提取待办事项、建议专题涌现、整理记忆，但**未经你确认，绝对不会擅自修改你的本地文件**。

---

## ✨ 核心能力

- ⚡ **极速捕捉**：快捷键 `Cmd/Ctrl + Shift + S` 随时记一条，静默写入本周动态周期本。
- 🌊 **动态工作台视图**：Obsidian 主区域的独立页签，集成时间轴卡片流与 AI 涌现建议。
- 🔄 **整理本周**：一键 reconcile 周期本、AI 提取待办事项并刷新涌现建议。
- 🤖 **后台 AI 副驾**：自动提炼待办（`memory/todo.md`）、建议专题涌现、整理个人画像记忆（`memory/profile.md`）。
- 📋 **侧边栏小组件**：侧栏集成今日待办快捷勾选与最近动态速览。
- 🛡️ **安全写回与备份**：所有写入经由 Kernel `writeback-engine` 闸口，包含保护级别判定（`open`/`locked`）；**仅高影响**（locked 覆盖、删除/归档）写入 `99-归档/` 备份与回执。

---

## 🧩 用户核心概念（≤ 5）

topmind Stream 通过 5 个通俗直观的概念降低认知负担：

| 概念 | 含义 | Vault 落点 |
|------|------|------------|
| **记一下** | 随手存一条想法/片段 | 本周动态周期本 / `00-收件箱/` |
| **动态** | 日常流水与时间轴 | `10-动态/`（每周一本） |
| **专题** | 长期主题归档 | `{大类}/{YYYY-主题}/` |
| **我的情况** | 关于你的稳定信息与记忆 | `memory/profile.md` |
| **写出来** | 最终输出成品与文章 | `88-输出/` |

---

## 🚀 快速开始

### 1. 安装

#### 方式 A：Obsidian 社区插件市场（上架后推荐）
1. 打开 **Obsidian 设置** ➔ **第三方插件**。
2. 关闭安全模式，点击 **浏览**。
3. 搜索 **Topmind Stream**。
4. 点击 **安装** 并 **启用**。

#### 方式 B：Obsidian BRAT（测试版本推荐）
1. 安装 [Obsidian BRAT](https://github.com/obsidian-tools/obsidian-brat) 插件。
2. 进入 **BRAT 设置** ➔ **Add Plugin**。
3. 输入仓库地址：`https://github.com/topmindspace/topmind`
4. 启用 **Topmind Stream**。

#### 方式 C：手动解压安装
1. 从 [Releases](https://github.com/topmindspace/topmind/releases) 下载 `topmind-obsidian-<version>.zip`（完整产品标签 `v*` 与表面标签 `obsidian-v*` 都会产出该产物）。
2. 将解压后的 `main.js`、`manifest.json`、`styles.css` 及 `templates/` 目录放入：
   `<你的 Vault>/.obsidian/plugins/topmind-stream/`
3. 重载 Obsidian，进入 **设置 ➔ 第三方插件**，启用 **Topmind Stream**。

#### 升级
| 方式 | 操作 |
|------|------|
| 社区市场 / BRAT | 在插件列表 / BRAT「检查更新」中升级 |
| 手动 zip | 下载新版 `topmind-obsidian-<ver>.zip`，覆盖 `plugins/topmind-stream/` 后重载 |
| 源码打包 | `npm run obsidian:pack` → 按手动安装步骤替换 |

插件升级**不会**改动 Vault 内容（`topmind.yaml`、`10-动态/`、`memory/` 等）。版本真源：[`manifest.json`](./manifest.json)（`npm run versions`）。

---

### 2. 初始化工作区

插件首次启用时，会自动检测当前 Vault 是否已有 topmind 工作区结构（`topmind.yaml` + 编号大类目录）。

- **已有工作区**：自动识别，无需额外套件操作。
- **新 Vault**：进入 **设置 ➔ Topmind Stream**，选择初始化模板（`stream` / `balanced` / `research` / `periodic`），点击 **初始化工作区** 即可生成标准三平面结构。

---

### 3. 配置 AI 副驾（可选）

进入 **设置 ➔ Topmind Stream ➔ AI 副驾**：

- 选择 AI 服务商：**DeepSeek**、**OpenAI**、**Anthropic**、**Ollama**（本地）或 **Custom Endpoint**。
- 填入 **API Key** 与模型名称（如 `deepseek-chat`、`gpt-4o`、`claude-3-5-sonnet`）。
- 选择 **写回模式**：
  - `confirm`（*保存前问我* — 推荐）：在 Suggestion Popover 审阅面板中预览变更，接受后再写入。
  - `auto`（*自动保存*）：自动应用 AI 建议，后台自动保留历史软备份。

> ℹ️ *不配置 AI 也完全可以使用！随手记、查看动态时间轴、手动整理等功能均可流畅运行。AI 是增强，不是必需。*

---

### 4. 日常使用

- 命令面板 ➔ **Topmind: 记一下**（*可在 Obsidian 设置 ➔ 快捷键 中绑定*）。
- `Cmd/Ctrl + P` ➔ 运行 **Topmind: 打开动态工作台** 打开主界面。
- 点击左侧 Ribbon 栏的 **波浪图标** 随时 **记一下**。

产品词汇（与 Desktop 对齐）：**记一下** / Note it · **记下** / Log it · **动态** · **专题** · **我的情况** · **写出来**。

---

## ⌨️ 命令面板参考

| 命令名称 | 说明 |
|----------|------|
| `Topmind: 打开动态工作台` | 在主区域打开动态时间轴工作台页签 |
| `Topmind: 记一下` | 弹出速记弹窗（默认写入本周动态） |
| `Topmind: 整理本周` | 整理当前周动态并刷新建议 |
| `Topmind: AI 整理待办` | 针对近期活动窗口运行 AI 待办提取 |

---

## 🏗️ 架构与生态对比

Topmind Stream 是 **Topmind Monorepo 生态** 的可选表面之一。它与 Topmind Desktop 富工作台、UTR CLI 及 Portable AI Skills 共享完全相同的 Kernel 底层引擎与目录契约。

```text
Obsidian 插件表面 (TypeScript + esbuild)
  ├── 视图 (ItemView & 侧栏小组件)
  ├── 设置页 (PluginSettingTab)
  └── Vault Bridge & AI Provider 适配层
        │
        ▼
Kernel 八引擎 (打包内联 lib/*.mjs)
  contract · workspace-model · stream · memory
  writeback · lifecycle · derived · ingest
  + todo / ai-operation / suggest / activity-window
        │
        ▼
Obsidian Vault (文件系统 = 唯一内容真源)
  topmind.yaml + {NN-名称}/ + memory/ + .topmind/
```

### 桌面端 Desktop vs. Obsidian 插件

| 维度 | Topmind Desktop | Topmind Obsidian 插件 |
|------|-----------------|-----------------------|
| **产品定位** | 独立本地富工作台 | 嵌入在 Obsidian 中的原生视图 |
| **编辑器** | Tiptap 富文本 / 所见即所得 | Obsidian 原生 Markdown 编辑器 |
| **AI 运行时** | Vercel AI SDK v7 | Direct fetch API (兼容 OpenAI / Anthropic) |
| **共享引擎** | Kernel `lib/` 八引擎 | Kernel `lib/` 八引擎 (打包内联) |
| **数据格式** | 标准 Markdown | 标准 Markdown (同一 Vault 完全通用) |

*同一个 Vault 可以同时在 Topmind Desktop 和 Obsidian 中打开使用，互无冲突。*

---

## 🔒 数据安全、隐私与防护

- **本地优先**：所有笔记和元数据均以标准 Markdown 形式保存在本地磁盘上。
- **零遥测**：Topmind 绝对不会收集、追踪或传输你的任何个人数据。
- **API Key 本地安全存储**：API Key 仅保存在 Vault 内 `.obsidian/plugins/topmind-stream/data.json` 本地配置文件中。
- **写回防护与软备份**：所有由 AI 驱动的文件变更均通过 `writeback-engine` 写入，受保护级别判定（`open`/`locked`）、软备份机制（`99-归档/backups/`）及路径回执保护。

---

## 🛠️ 开发与构建

```bash
# 安装依赖
npm install

# 启动 esbuild 监听开发模式
npm run dev

# 编译生产包
npm run build

# TypeScript 类型检查
npm run typecheck

# 运行单元测试
npm test

# 打包完整性校验
npm run pack:verify

# 生成发布 zip 压缩包
npm run pack
```

---

## 📋 环境要求

- **Obsidian 版本**：桌面端 ≥ `v1.5.0`（移动端暂不支持，桌面优先设计）。
- **Node.js**：≥ `v20.11`（从源码构建时需要）。

---

## 📄 开源协议

[MIT License](LICENSE) © [TopMindSpace](https://github.com/topmindspace)
