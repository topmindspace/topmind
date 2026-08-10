# topmind Obsidian Plugin — 架构

> **用户文档**：[English](README.md) · [简体中文](README.zh-CN.md) · **边界**：`../PRODUCT-BOUNDARIES.md` · **内容约定**：`../PROJECT-MODEL.md`  
> **版本真源**：`obsidian-plugin/manifest.json`

---

## 1. 核心架构决策

### 1.1 Kernel 引擎复用策略

topmind Kernel 引擎（`lib/*.mjs`）使用 Node.js `fs` / `path` / `crypto` 模块。Obsidian 桌面端运行在 Electron 渲染进程中，**可以通过 ESM imports（`import fs from "node:fs"`）访问 Node.js 模块**，esbuild `platform: 'node'` 自动转换为 CJS `require()` 调用（与 Dataview / Templater 等流行插件做法一致）。

```text
┌─────────────────────────────────────────────────────────────┐
│  Obsidian Plugin Surface (TypeScript → esbuild → main.js)    │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ Views       │  │ Settings     │  │ Services          │   │
│  │ (ItemView)  │  │ (SettingTab) │  │ (KernelService)   │   │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────────┘   │
│         │                │                   │               │
│  ┌──────▼───────────────────────────────────▼───────────┐   │
│  │  Bridge Layer                                        │   │
│  │  ├── kernel-loader.ts   (import 引擎 → esbuild 内联)  │   │
│  │   ├── ai-provider.ts     (fetch-based AI + 重试 + 结构化操作 systemPrompt)  │   │
│  │  └── vault-bridge.ts    (Vault ↔ fs 路径映射)         │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │                                   │
├──────────────────────────┼───────────────────────────────────┤
│  Kernel (lib/*.mjs)       │  引擎经 esbuild 打包进 main.js    │
│  contract · workspace     │  使用 require('fs') / require     │
│  stream · memory          │  ('path') — Electron 环境可用     │
│  writeback · lifecycle    │                                   │
│  derived · ingest         │                                   │
│  + todo / ai-operation    │                                   │
│  + suggest / activity     │                                   │
└──────────────────────────┴───────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│  Obsidian Vault (文件系统 = 唯一内容真源)                      │
│  topmind.yaml + {NN-名称}/ + memory/ + .topmind/             │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 与 Desktop 的架构对比

| 维度 | Desktop | Obsidian Plugin |
|------|---------|-----------------|
| 运行环境 | Electron 主进程 | Obsidian Electron 渲染进程 |
| Kernel 加载 | 动态 import from engine root | esbuild 打包进 `main.js` |
| AI Provider | Vercel AI SDK v7 (`generateText`) | `fetch` API 直调（OpenAI-compatible + Anthropic 原生） |
| AI 对话 | Agent 流式（React） | KernelService.chat（fetch + 上下文注入） |
| UI 框架 | React + Tailwind + Tiptap | Obsidian 原生 (ItemView + DOM) |
| 文件系统 | Node.js `fs` | ESM import → esbuild CJS require（Electron 渲染进程） |
| 设置持久化 | `app-settings.json` + safeStorage | Obsidian `loadSettings()` / `saveSettings()` |
| 事件 | Electron IPC | Obsidian `App` 事件 + vault `modify`/`create` |
| i18n | i18next | 轻量 `t()` 双语表（同 UTR 模式） |
| 瞬态重试 | Kernel AI Provider | `fetchWithRetry`（5xx + 网络错误，指数退避） |

### 1.3 设计原则

1. **Surface 不得平行实现业务语义** — 所有写入经 `writeback-engine`；落点/保护/提升/生命周期走 Kernel。capture 使用 `appendToPeriodBody` 而非手动拼接。
2. **Obsidian-native 优先** — 不重建编辑器/文件树/命令面板，复用 Obsidian 原生能力。
3. **桌面端优先** — 使用 Node.js `fs`（ESM import → CJS require；移动端为 Non-goal，与 Desktop 一致）。
4. **Vault 即工作区** — Obsidian Vault 根目录 = topmind 工作区根目录。
5. **用户概念 ≤5** — 记一下 · 动态 · 专题 · 我的情况 · 写出来。

---

## 2. 构建管线

### 2.1 esbuild 打包

```text
src/main.ts  ──┐
                ├── esbuild (bundle + minify) ──→  main.js
lib/*.mjs   ──┘                                   (单文件输出)

解析策略:
  • node:fs → require('fs')     (Electron 环境可用)
  • node:path → require('path')
  • node:crypto → require('crypto')
  • node:module → require('module')
  • ./yaml-bridge.mjs → yaml-bridge-shim (esbuild plugin)
  • yaml (npm) → 打包进 bundle
  • import.meta.url → require("url").pathToFileURL(__filename).href
```

esbuild 插件 (`kernelShims`) 处理三个兼容性问题：
1. **yaml-bridge.mjs** — 将动态 `createRequire` 替换为静态 `import`，使 `yaml` npm 包可被 esbuild 打包。
2. **contract-engine.mjs** — 移除 `createRequire` 动态 require，替换为静态 import。
3. **import.meta.url** — 在 CJS 输出中替换为 `require("url").pathToFileURL(__filename).href`。

### 2.2 开发流

```bash
# 开发：esbuild watch + Obsidian 手动重载插件
npm run dev

# 构建：打包 main.js
npm run build

# 类型检查
npm run typecheck

# 测试
npm test

# 打包验证
npm run pack:verify
```

### 2.3 打包发布

```bash
# 生成 release zip (main.js + manifest.json + styles.css + templates/)
npm run pack

# 或从 repo root
npm run obsidian:pack
```

输出：`release/topmind-obsidian-<version>.zip`，用户手动安装或通过 BRAT / Obsidian 社区插件市场。

---

## 3. 模块结构

```text
obsidian-plugin/
├── manifest.json              # Obsidian 插件清单（版本真源）
├── package.json               # 依赖与脚本
├── tsconfig.json              # TypeScript 配置
├── esbuild.config.mjs         # 构建配置（含 kernel shims）
├── styles.css                 # 插件样式
├── .gitignore                 # 忽略 node_modules / dist-types / release
├── README.md                  # 用户文档
├── ARCHITECTURE.md            # 本文件
├── DESIGN.md                  # UI/UX 设计
├── src/
│   ├── main.ts                # 插件入口（extends Plugin）
│   ├── types.ts               # 共享类型定义 + DEFAULT_SETTINGS
│   ├── constants.ts           # 常量（视图 ID、命令 ID、AI 预设）
│   ├── utils.ts               # 共享纯函数（extractTags / parseStreamEntries / 路径过滤）
│   ├── bridge/
│   │   ├── kernel-loader.ts   # 加载 Kernel 引擎（esbuild 内联）+ 类型面
│  │   ├── ai-provider.ts     # fetch-based AI Provider（OpenAI-compat + Anthropic + Google Gemini + 重试 + 结构化 systemPrompt）
│   │   └── vault-bridge.ts    # Vault 路径 ↔ 工作区路径映射
│   ├── settings/
│   │   └── settings-tab.ts    # PluginSettingTab 实现
│   ├── views/
│   │   ├── stream-workbench-view.ts  # 主工作台 ItemView
│   │   ├── sidebar-dock-view.ts      # 侧边栏小组件
│   │   └── quick-capture-modal.ts    # 极速捕捉弹窗
│   ├── services/
│   │   ├── kernel-service.ts         # Kernel 操作封装（capture / suggest / ops / todo / chat）
│   │   ├── kernel-workspace-ops.ts   # 纯 Kernel 写路径操作（无 Obsidian 依赖，可测试）
│   │   ├── ai-task-manager.ts        # AI 任务管理器（多任务队列、进度追踪、中止）
│   │   └── models-dev.ts             # models.dev 社区模型目录集成
│   └── i18n/
│       ├── index.ts           # t() 函数
│       └── locales/
│           ├── zh-CN.ts        # 中文（默认）
│           └── en-US.ts        # 英文
├── scripts/
│   ├── pack-plugin.mjs        # 打包 release zip
│   └── verify-pack.mjs        # 打包完整性验证
└── tests/
    ├── plugin.test.mjs              # 单元测试（i18n / 解析 / 设置迁移 / 构建产物 / 写路径契约）
    └── kernel-integration.test.mjs   # Kernel 集成测试（真实 Kernel + temp workspace）
```

---

## 4. Bridge 层设计

### 4.1 Kernel Loader (`bridge/kernel-loader.ts`)

打包后 Kernel 引擎已内联在 `main.js` 中。通过 esbuild 的静态 import 获取 Kernel API，附带手动类型面（`KernelApi` interface）确保类型安全。

`KernelApi` 接口手动声明了插件使用的所有 Kernel 函数签名，包括：
- `loadContract` / `buildDefaultContract` — 契约加载
- `resolveWorkspaceModel` / `ensureRequiredStructure` — 工作区模型
- `resolveStreamTarget` / `findStreamCategory` / `appendToPeriodBody` / `reconcilePeriodBody` — 动态流
- `listStreamPeriods` — 周期本列表
- `executeWrite` — 写回引擎（唯一写闸）
- `ensureTodoFile` / `readTodoList` / `toggleTodoItem` — 待办
- `createKernelContext` — 每工作区安全上下文

`KernelContext` 接口声明了上下文方法面：
- `generateSuggestions` — 返回 `Suggestion[]`（同步，直接数组，非 `{ suggestions: [] }` 包装）
- `applySuggestion` — 接受完整 suggestion 对象（含 `targetPath`，用于 inbox/stale/catch_all 归档类建议）
- `runOperation` — 异步返回 `OperationResult`（含 `ok` / `summary` / `suggestions` / `reason`）

```typescript
import * as kernelApi from "../../../lib/kernel-api.mjs";
// @ts-expect-error — .mjs has no .d.ts; esbuild bundles at build time

const api = kernelApi as unknown as KernelApi;

export function getKernel(): KernelApi { return api; }

export function createKernelContext(
  vaultPath: string,
  engineRoot: string,
  aiProvider?: AiProvider | null,
): KernelContext {
  return api.createKernelContext({ workspaceRoot: vaultPath, engineRoot, aiProvider });
}
```

### 4.2 AI Provider (`bridge/ai-provider.ts`)

不依赖 Vercel AI SDK，直接用 `fetch` 调用 AI API。支持两种协议：

- **OpenAI-compatible**（OpenAI / DeepSeek / Ollama / Custom）：`/chat/completions`
- **Anthropic 原生**：`/v1/messages`（不同 header `x-api-key`，不同响应格式）
- **Google Gemini**：`/v1beta/models/{model}:generateContent`

包含瞬态错误重试（5xx + 网络错误，指数退避，最多 2 次重试），与 Kernel AI Provider 的瞬态重试策略对齐。

```typescript
interface AiProvider {
  generate(prompt: string, context?: unknown): Promise<string>;
}

// context 可携带 operation / systemPrompt — 由 Kernel suggest/ops 引擎传入
// max_tokens 和 temperature 按 operation 类型动态调整（与 Desktop adapter 对齐）

// resolveAiEndpoint(settings) — 解析当前生效的 provider + model + apiKey
// 用于侧边栏/工具栏的模型徽章显示
```

### 4.2.1 AI Chat (`KernelService.chat`)

侧边栏「对话」标签通过 `KernelService.chat()` 与 AI 对话：

```text
用户输入
→ KernelService.chat(userMessage, history)
→ 构建上下文：
1. 近期动态条目（当前周期本最近 20 条）
2. 当前待办（未完成的前 10 条）
3. 用户画像（memory/profile.md 前 3000 字符）
4. 近期周期反思（memory/periodic/ 最新文件前 2000 字符）
→ 组装 systemPrompt + conversation prompt
  → AiProvider.generate(prompt, { operation: "chat", systemPrompt, ... })
  → 返回 AI 回复（Markdown 渲染）
```

**上下文自动注入**：用户无需手动选择上下文 — 系统自动从工作区数据构建。对话历史保留最近 10 轮。

**Locale 感知**：System prompt 跟随 UI locale（`settings.localeOverride`）— 中文模式使用中文 prompt，英文模式使用英文 prompt。留空时跟随 Obsidian 语言。

### 4.2.2 AI Task Manager (`services/ai-task-manager.ts`)

AI 操作的任务管理器，提供多任务队列、进度追踪和中止能力：

```text
用户触发 AI 操作（侧边栏底部按钮 / 命令面板）
  → aiTaskManager.enqueue(operation, label, executor)
  → 串行队列（一次只执行一个 AI 操作，与 Desktop background lane 对齐）
  → 进度追踪：pending → running → done/error/aborted
  → 事件通知：subscribe(listener) → UI 实时更新
  → 历史记录：最近 20 条任务结果
  → 中止能力：abortController.abort()
```

**设计原则**：
- **串行队列**：一次只执行一个 AI 操作，避免并发 API 调用导致速率限制
- **进度徽章**：工作台工具栏 + 侧边栏头部实时显示当前任务
- **任务历史标签**：侧边栏新增「任务历史」标签页，展示所有 AI 操作状态
- **去重**：`isOperationActive(operation)` 防止同一操作重复排队
- **可中止**：用户可随时取消正在运行的 AI 操作

**UI 集成**：
- 工作台工具栏：AI 任务进度徽章 + 中止按钮
- 侧边栏头部：AI 任务进度徽章
- 侧边栏标签页：待办 | 建议 | 对话 | 动态 | **任务历史**
- 底部操作：AI 操作按钮经任务管理器入队

### 4.3 Pure Ops Layer (`services/kernel-workspace-ops.ts`)

纯 Kernel 写路径操作，无 Obsidian 依赖。`KernelService` UI 层调用这些函数，单元/集成测试用真实 Kernel + temp workspace 直接调用。

导出函数：
- `captureToWorkspace` — 经 `appendToPeriodBody` + `executeWrite` 写入周期本
- `listStreamPeriodsForWorkspace` — 异步 `listStreamPeriods` + 映射为 `StreamPeriod[]`
- `reconcilePeriodNote` — `reconcilePeriodBody(body, opts)` → `.changed` 判定
- `readTodosFromWorkspace` — 读取待办 + `mapKernelTodoItem` 字段映射
- `initWorkspaceStructure` — 首次模板种子 + `ensureRequiredStructure`
- `reseedWorkspaceContract` — 备份坏契约 + 重写默认 v4 契约
- `seedFullTemplateIfEmpty` — 首次创建全量大类目录

### 4.4 Vault Bridge (`bridge/vault-bridge.ts`)

Obsidian Vault 根 = topmind 工作区根。所有 Kernel 引擎通过 Node.js `fs`（ESM import → CJS require）直接操作文件系统，与 Obsidian 的 `Vault` API 操作同一物理路径。

```typescript
export function getVaultBasePath(app: App): string {
  // @ts-expect-error — getBasePath is internal but stable on desktop
  return app.vault.adapter.getBasePath?.();
}

export function getEngineRoot(plugin: { manifest: { dir?: string } }): string {
  return plugin.manifest.dir || "";  // 插件目录 = engineRoot（templates/ 在此）
}
```

---

## 5. 写回链路

```text
用户操作 (capture / AI suggest apply / reconcile)
  → KernelService
  → kernel.appendToPeriodBody  (Kernel 的 stream-period 引擎)
  → kernel.executeWrite
  → writeback-engine:
      1. evaluateWritePermission (protection + confirm)
      2. backup (only high-impact: locked overwrite / delete-archive; BACKUP_KEEP from settings)
      3. atomic write (fs.writeFileSync)
      4. receipt (99-归档/receipts/)
  → Obsidian Vault 感知文件变更 (metadataCache refresh)
  → UI 刷新 (vault.on("modify") 事件 + 防抖)
```

**关键**：writeback-engine 使用 Node.js `fs` 写入文件。Obsidian 的 `Vault.adapter` 会通过 FSEvents / fs.watch 感知变更并自动刷新 `metadataCache` 和文件树。无需手动通知 Obsidian。

**capture 链路**：`KernelService.capture()` → `kernel.resolveStreamTarget()` 定位周期本 → `kernel.appendToPeriodBody()` 构造追加块（处理 day heading、seed 等）→ `kernel.executeWrite()` 经写闸写入。

**reconcile 链路**：`KernelService.reconcilePeriod()` → `kernel.reconcilePeriodBody()` 合并散落条目、修复 day heading → `kernel.executeWrite()` 经写闸写回。

**设置接入**：`backupKeep` 通过 `process.env.BACKUP_KEEP` 接入 Kernel；`writebackMode` 通过 `writebackModeOverride` 透传。

**Todo 字段对齐**：Kernel `todo-engine` 的 TodoItem 字段为 `done`（非 `completed`）。插件 `mapKernelTodoItem` / UI 过滤必须读 `done`，与 Desktop `todo-store` 一致。

### 5.1 与 Obsidian 官方「优先 Vault API」的关系（intentional divergence）

[Obsidian Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) 建议插件本地文件操作优先用 Vault API 而非 Adapter/raw FS。本表面**有意**走 Node `fs` + Kernel `writeback-engine`：

| 点 | 选择 | 原因 |
|----|------|------|
| 内容写入 | Kernel `executeWrite` → `fs` | 四体共享唯一写闸（保护级别、confirm、高影响备份/回执）；Surface 不得平行实现业务写语义 |
| Vault 根路径 | `vault.adapter.getBasePath()` | 仅解析工作区根；不用于内容写 |
| AI HTTP | `fetch`（非 `requestUrl`） | `isDesktopOnly: true`；Electron 渲染进程可用 fetch；与 Kernel AiProvider 接口一致 |
| 移动端 | 不支持 | 与 Desktop 一致 Non-goal；`manifest.isDesktopOnly: true` |

**不要**为了满足「Vault API 优先」而把 capture/reconcile/todo 改成 `vault.modify` 绕过 writeback。

---

## 6. 视图架构

### 6.1 Stream Workbench View (主工作台)

```typescript
export class StreamWorkbenchView extends ItemView {
  getViewType(): string { return VIEW_TYPE_STREAM_WORKBENCH; }
  getDisplayText(): string { return t('stream_workbench_title'); }
  getIcon(): string { return 'waves'; }

  async onOpen() {
    // 渲染：工具栏 + 极速输入框 + 周期本条目卡片流 + AI 涌现建议区
    // 工具栏：AI 状态 + 模型徽章 + [侧边栏] [设置] [收件箱] [画像]
    // 监听 vault.on("modify" / "create") 事件 → 450ms 防抖刷新（仅刷新动态流）
    // AI 建议刷新仅在初始加载和用户显式操作时触发（避免频繁 AI 调用）
  }

  async refreshStream() {
    // kernelService.getStreamContext() → 读取周期本
    // kernelService.readPeriodNote() → 解析条目 → 渲染卡片
    // 卡片默认折叠 2 行，点击展开，✏ 打开编辑器
  }

  async refreshSuggestions() {
    // kernelService.generateSuggestions() → 渲染涌现建议卡片
    // 建议类型覆盖 Kernel suggest-engine + ai-operation-engine 全部 kind
    // 每种 kind 有专属图标和左边条颜色
  }
}
```

### 6.2 Sidebar Dock View (AI 副驾面板 — 标签式)

```typescript
export class SidebarDockView extends ItemView {
  // 标签式布局：待办 | 建议 | 对话 | 动态
  // 头部：AI 状态 + 模型徽章 + [⚙ 设置]
  // 底部：[⚡记一下] [🔄整理] [📋待办] [🏷️分类] [🧠记忆] [🖥工作台]
  // 
  // 对话标签（新增）：
  //   - 上下文感知：自动注入近期动态 + 当前待办 + 用户画像
  //   - Markdown 渲染 AI 回复
//   - 对话历史（持久化到 .topmind/chat-history.json，重载不丢失）
//   - kernelService.chat(userMessage, history) → AI Provider
  //
  // 事件驱动刷新：vault.on("modify" / "create") → 450ms 防抖
  // 路径过滤：isStreamOrTodoPath() 只关注动态目录 + memory/todo.md
}
```

### 6.3 Quick Capture Modal (极速捕捉弹窗)

```typescript
export class QuickCaptureModal extends Modal {
  onOpen() {
    // 单行/多行输入 → Enter 提交 → Kernel capture → 关闭
    // 目标选择：本周动态（默认）/ 收件箱
  }
}
```

---

## 7. 设置体系

### 7.1 设置结构

```typescript
interface TopmindSettings {
  // Stream 工作台
  autoOpenWorkbench: boolean;
  timelineOrder: 'desc' | 'asc';
  autoTag: boolean;
  localeOverride: string;  // "" = auto, "zh-CN" / "en-US" = override

  // AI 副驾（多服务商模型 — 与 Desktop 对齐）
  ai: {
    sourcePreference: string;  // "" = auto, provider id = preferred
    defaultModel: string;       // "" = provider default
    manual: {                   // 全量密钥同时存储
      openAiKey: string;
      anthropicKey: string;
      googleKey: string;
      deepseekKey: string;
      moonshotKey: string;
      zhipuKey: string;
      minimaxKey: string;
      xaiKey: string;
      customBaseUrl: string;
      customKey: string;
      ollamaBaseUrl: string;
    };
  };
  writebackMode: 'auto' | 'confirm';
  autoSuggest: boolean;
  autoMaintainTodos: boolean;

  // 安全与归档
  backupKeep: number;       // → process.env.BACKUP_KEEP 接入 Kernel
  receiptKeep: number;      // → process.env.RECEIPT_KEEP 接入 Kernel 回执轮转
}
```

> **设计决策**：
> - 所有服务商密钥同时存储于 `ai.manual`，用户通过 `sourcePreference` 切换优先服务商。设置面板按「国际/国内/本地」分组展示。
> - **从 Desktop 导入**：设置面板支持从 `~/topmind/topmind-desktop/state/app-settings.json` 导入已配置的密钥（加密密钥不可导入）。
> - 所有设置项均有实际作用，无装饰性开关。

### 7.2 设置与 Kernel 的接入

| 设置项 | 接入方式 |
|--------|----------|
| `writebackMode` | `writebackModeOverride` 透传给 `executeWrite` |
| `backupKeep` | `process.env.BACKUP_KEEP` 写入，Kernel `writeback-engine` 读取 |
| `receiptKeep` | `process.env.RECEIPT_KEEP` 写入，Kernel 回执轮转读取 |
| `ai.manual` (多服务商密钥) + `ai.sourcePreference` | `createAiProvider()` 解析 → `createKernelContext()` 注入 |
| `autoSuggest` | 控制 `generateSuggestions()` 是否调用 |
| `autoMaintainTodos` | 控制 `todo_maintain` 操作是否自动运行 |
| `localeOverride` | `setLocale()` 覆盖 Obsidian 自动检测的语言 |

### 7.3 设置 Tab

使用 Obsidian `PluginSettingTab` + `Setting` 组件构建，分四个区域：
1. 📂 工作区与契约（工作区状态卡片 + 模板选择 + 初始化工作区按钮 + 契约诊断/重建）
2. 🌊 工作台（自动打开、时间轴排序、标签、语言）
3. 🤖 AI 副驾与写回策略（多服务商密钥 + 偏好选择 + 模型 + 从 Desktop 导入 + 测试连接 + 写回模式 + 自动建议/待办）
4. 🛡️ 安全与归档（备份份数 + 回执份数）

> **快速进入设置**：侧边栏头部 ⚙ 按钮 / 工作台工具栏 ⚙ 按钮 / Obsidian Settings → Community plugins → Topmind Stream
>
> **模型徽章**：侧边栏头部 + 工作台工具栏实时显示当前 AI 服务商 + 模型（如 "DeepSeek · deepseek-chat"），通过 `kernelService.getActiveModelLabel()` 获取。
>
> **模型选择**：只要配置了任意一个 AI 服务商，模型选择下拉框就会显示。从 [models.dev](https://models.dev) 社区目录获取最新模型列表。下拉框旁还提供自定义模型文本输入框，可直接输入任意模型 ID。auto 模式（服务商偏好留空）时模型选择仍可用。
>
> **工作区状态卡片**：显示当前工作区是否就绪、大类数量、契约是否有效。提供「诊断契约」和「重建契约」按钮。
>
> **测试连接**：点击后用当前配置发送一条测试消息到 AI API，验证连通性。
>
> **API Key 安全**：API Key 存储在 Obsidian 插件 `data.json`（明文），与大多数 Obsidian 插件一致。

---

## 8. i18n

轻量 `t()` 双语表，同 UTR 模式（`zh-CN` 默认，`en-US` 回退）。locale 从 Obsidian `app.locale` 解析。测试覆盖键集对齐验证。

---

## 9. 质量门

```bash
# 类型检查
npm run typecheck

# 测试
npm test

# 构建
npm run build

# 打包验证
npm run pack:verify
```

测试覆盖两个文件：
- `tests/plugin.test.mjs` — 纯逻辑单元测试（i18n 键对齐 / stream 解析 / 标签提取 / 设置迁移 / AI 预设 / 瞬态错误 / 构建产物 / 写路径结构契约）
- `tests/kernel-integration.test.mjs` — Kernel 集成测试（真实 Kernel API + temp workspace：init / resolveStreamTarget / capture / listPeriods / reconcile / mergeCaptureTags / mapApplySuggestionResult）

集成到 root `npm run validate` 和 `npm test` 中：

```bash
npm run obsidian:validate  # typecheck + test + build + pack:verify
npm run obsidian:test      # 仅测试
```

---

## 10. 版本管理

版本真源：`obsidian-plugin/manifest.json` 的 `version` 字段。

独立版本策略（遵循 `AGENTS.md` §版本层）：
- 大版本对齐（与其他表面共享 2.x）
- 小版本独立（仅插件有改动时 bump）
- Tag 命名：`obsidian-v*`

---

## 11. 边界约束

- ❌ 不把用户数据放进 `obsidian-plugin/` 源码目录
- ❌ 不让插件 runtime state 成为内容真源
- ❌ 不平行实现 Kernel 业务语义（落点/保护/提升/生命周期/流追加）
- ❌ 不重建 Obsidian 已有的能力（编辑器、文件树、命令面板）
- ❌ 不默认创建 outline/setting/style 锚点
- ✅ 所有写入经 `writeback-engine`（唯一写闸）
- ✅ capture 使用 Kernel `appendToPeriodBody`（不手动拼接 bullet）
- ✅ 遵循三平面约定（`topmind.yaml` + `memory/` + `.topmind/`）
- ✅ 用户概念 ≤5；UI 白话
- ✅ 代码用 Topic* / Category*，不用 Project*
- ✅ AI Provider 支持 OpenAI-compatible + Anthropic 原生 + 瞬态重试

---

## 12. 未来适配策略

### 12.1 Kernel API 变更适配

插件通过 `kernel-loader.ts` 的 `KernelApi` 类型面与 Kernel 交互。当 Kernel API 变更时：

| 变更类型 | 适配方式 |
|----------|----------|
| 函数签名扩展（新增可选参数） | 无需修改 — 扩展参数是可选的 |
| 函数签名变更（参数重命名/移除） | 更新 `KernelApi` 类型面 + 调用处 |
| 新增 Kernel 能力 | 在 `KernelApi` 添加类型 + `KernelService` 封装 |
| 函数移除 | 移除 `KernelApi` 条目 + `KernelService` 调用 |

### 12.2 底层规约更新影响

| 规约变更 | 对插件的影响 |
|----------|-------------|
| `topmind.yaml` schema 升级 | Kernel `contract-engine` 处理迁移；插件无感 |
| 三平面目录模型调整 | Kernel `workspace-model` 处理；插件通过 `resolveWorkspaceModel` 自动适配 |
| 新增模板 | `esbuild.config.mjs` 的 `copyTemplates()` 自动复制；无需代码改动 |
| writeback 行为变更 | 插件通过 `executeWrite` 调用；`writebackModeOverride` 透传 |
| AI Provider 接口扩展 | `ai-provider.ts` 的 `generate()` 适配；`context` 参数透传 |

### 12.3 适配原则

1. **类型面优先** — `KernelApi` interface 是插件与 Kernel 之间的契约。变更先反映在类型面，编译时即可发现不兼容。
2. **不平行实现** — 任何新的 Kernel 能力都应通过 `KernelService` 封装后暴露给 View，不在 View 中直接调 Kernel。
3. **esbuild shim 随引擎演进** — 若 Kernel 新增 `createRequire` 模式，需在 `esbuild.config.mjs` 添加对应 shim。
4. **测试覆盖** — 每次适配变更需更新 `tests/plugin.test.mjs` 中的对应测试。
