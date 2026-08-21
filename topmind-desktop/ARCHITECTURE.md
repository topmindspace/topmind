# topmind Desktop — 架构

> **现状描述 + Target 标注**。约 300 源文件（`src/` ~195 + `electron/` ~104）。  
> **1 RPC · Stores（View / Ai / Action / Plugin / IngestStaging / Task / Todo）· 1 Shell · 5+2 Service · 8 插件槽**  
> UI 真源：`DESIGN.md`。边界：`../PRODUCT-BOUNDARIES.md`。  
> **实施锁**：[`../docs/ARCHITECTURE-RESET.md`](../docs/ARCHITECTURE-RESET.md)（写闸合闸 · 建议副驾 · 导航变薄）。

## 核心心智模型

```
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

- 用户概念 ≤5：记一下 · 动态 · 专题 · 我的情况 · 写出来  
- 文件系统是唯一真源；Desktop 是**富工作台**视图层（非薄壳）  
- 技能纯 Markdown（`SKILL-ARCHITECTURE.md`）  
- **写回**：**Done** 主路径 — WorkspaceService / AI / connectors 耐久 `.md` → Kernel `writeback-engine`（open|locked + auto|confirm；备份/回执仅高影响）；二进制资源（图片等）经 `saveBinary` 写入前检查 `evaluateWritePermission` 保护门，`locked` 文件覆盖前备份；`electron/lib/writeback.mjs` 仅 evidence/日志 helper，非第二闸  

- **UTR 可选**：Tools / doctor；**AI 写回不经 UTR**  
- **notes-index**：投影缓存；`truncated` 时 `total`/`returned` 为投影条数，`scannedTotal` 为全库普查  

### Kernel 接入现状（诚实）

| 能力 | 现状 |
|------|------|
| workspace-model / stream-period | 经 `workspace-model-api` 等动态加载 **Done** |
| `electron/lib/kernel-api.mjs` | **Done** — 动态加载 `lib/kernel-api.mjs` |
| writeback-engine | **Done** — save/edit/updateFrontmatter/delete.md → `kernelDurableWrite/Delete`；AI `actor:"ai"` |
| 建议条 | **Done** — `generateSuggestions` / `applySuggestion` + **`SuggestPopover`**（`ActionStore` + 标题栏 💡）；high-impact 经 `suggestion-gate` 必须 `confirmed:true`；AI 配置后 `ai_summary` 真实 LLM |
| 待确认写入 | **Done** — `pending-writes` + **`SuggestPopover`**（`ActionStore`：事件刷新 + 安全网轮询 + 全文审阅）；轨内 ActionBar 仅为跳转 chip |
| AI 轨事件 | **Done** — `ai-rail-events`（`suggestions:refresh` / `pending-writes:changed`） |
| 设置 UI 同步 | **Done** — `ui-settings-sync` 仅 own-key 应用，防 stale full-ui 盖掉壳宽度 |
| 写出来 shelf | **Done** — `listOutputsEnhanced` 附 `publishedAt`/`title`；OutputsView 已发布/草稿 + HTML 导出 |
| 动态 feed 解析 | **Done** — `stream-period-parse` 软提取结构节条目；CRLF；周期回退列表 |
| 响应式 chrome | **Done** — `ChromeOverflowActions` + TitleBar compact 互斥 + StatusBar 可点 |
| connectors weread/x | **Done** — 共享 `electron/lib/connector-bridge.mjs`（settings+secret · patch 持久 · `writeConnectorNote` 经 kernel 写闸）；ADR `docs/adr/2026-08-02-connector-bridge.md` |
| ingest 路由 | **Done** — Desktop commit 经 `resolveIngestRoute`（Kernel） |
| PrimaryNav 默认 | **Done** — 动态 / 收件箱 / 写出来 / 搜索；selection 默认 `stream`；legacy home→stream；归档不在主锚 |
| 侧栏 thrift | **Done** — ViewSwitcher 主轨 stream/目录/时间；标签/看板「更多」 |
| 关键词搜索诚实 | **Done** — notes-index + grep `truncated`/`scannedTotal`；GlobalSearch 截断提示（无 embedding） |
| 建议可关 | **Done** — `ai.autoPrepareSuggestions`（默认开） |
| 待办自动整理可关 | **Done** — `ai.autoMaintainTodos`（默认关 · 省 Token） |
| 状态栏 AI 忙碌 | **Done** — `deriveStatusBarBusy`：todo/suggest 专用 chip，不与「AI 工作中」双标；Task=`Loader2`、Todo=`ListTodo`（可点开清单）、Suggest 可点开确认面；streaming · TaskStore 走 AI pill |
| memory / lifecycle / contract / derived | 经 kernel-api；derived item-history **Done** 最小；AI provider 纯 **per-call 注入**——`createKernelAiProvider(settings)` 工厂按调用生成（`generateSuggestions` / `applySuggestion` / `runOperation` 等入口逐次传入），无全局单例；topic summary / period digest 用真实 LLM |
| ingest 转换/队列 | Desktop `electron/lib/ingest/*` 本地转换与任务队列（**非路由**；默认 anydoc sidecar，可选 markitdown/pandoc，内置 JS 兜底） |

## 架构全景

```
┌─────────────────────────────────────────────────────────┐
│  Shell (React)                                           │
│  ┌──────────┬───────────────────┬─────────────┐         │
│  │ 侧栏     │  编辑区            │  AI 面板     │         │
│  │ (树导航) │  (Tiptap/预览)     │  (可折叠)    │         │
│  └──────────┴───────────────────┴─────────────┘         │
│                                                          │
│  标题栏: 导航 ← 工作流导航 → ⌘K 命令面板                  │
│  7 个 Store: ViewStore · AiStore · ActionStore · PluginStore · IngestStagingStore · TaskStore · TodoStore  │
│  i18n 架构: i18next 同步打包 + BCP-47 LocaleResolver + UTR / Engine 多语言解耦 │
│  插件槽: DataSource · Sidebar · View · Action · Settings · Overlay · StatusBar · ContextMenu │
│  侧栏视图: ViewSwitcher（动态流/分类/时间线/标签/看板）              │
│  待办: TodoPopover（TitleBar 弹层 · ⌘⇧T · pin/unpin 可拖动 · 默认右侧）                │
├──────────────────── RPC 桥 ─────────────────────────────┤
│  invoke(method, params)   ←  单通道                      │
│  subscribe(event, handler) ←  统一事件总线               │
├─────────────────── 服务层 ──────────────────────────────┤
│  Workspace · Ai · System · Tool · Ingest  (+ Weread / X optional) │
├─────────────────── 文件系统 ────────────────────────────┤
│  动态 {NN-Name}/ 类别 · role:buffer/delivery/system     │
│  解析: engine lib/workspace-model.mjs + topmind.yaml │
└─────────────────────────────────────────────────────────┘
```

## RPC 桥

单 IPC 通道：`rpc:invoke` + 事件订阅。

**preload.cjs**（精简桥）：
```js
contextBridge.exposeInMainWorld('topmind', {
  invoke: (method, params) => ipcRenderer.invoke('rpc:invoke', method, params),
  subscribe: (event, handler) => { /* on + removeListener */ },
  getPathForFile: (file) => webUtils.getPathForFile(file), // DnD 本地路径
});
```

新增操作 = 给某个 Service 加一个方法。无需改 preload/验证器/类型/包装层。

**运行时浅层 shape 校验（dev / `TOPMIND_RPC_SHAPE_CHECK`）**：`electron/lib/rpc-shape.mjs` + renderer `src/services/rpc-shape.ts` 对代表方法返回值做 required-keys 检查（主进程 bridge + `invoke` 包装）；合法路径零行为变化，不替代 TS 类型。主进程迁移 TypeScript = Non-goal。

## 服务层

4 个核心服务 + 知识加工 + 2 个可选 connector（weread / x），均通过同一个 RPC bridge 暴露。

| 服务 | 文件 | 方法数（约） | 职责 |
|------|------|-------------|------|
| WorkspaceService | `workspace-service.mjs` + `lib/workspace-*-ops.mjs` + `notes-index.mjs` | facade 薄 + ops ~35 | path/inbox/archive/scan/fetch；notes-index；CRUD、收件箱、归档、搜索、URL 抓取；`importFile` → Ingest 管道 |
| AiService | `ai-service.mjs` + `ai-prompts.mjs` + `ai-stream.mjs` + `ai-model.mjs` | ~12 | AI 调用（原生工具 → WorkspaceService）、流式、会话、steer/compact、skills catalog |
| SystemService | `system-service.mjs` | ~49 | 设置（safeStorage）、路径、原生操作、工作区切换、Clip Bridge、**插件安装/预览**、**skills-extra**、类别管理、更新检查 |
| ToolService | `tool-service.mjs` + `ai-tools.mjs` | ~6 | Desktop 原生 AI 工具；UTR catalog/run/doctor **软探测**（可选；写回不经 UTR） |
| IngestService | `ingest-service.mjs` + `lib/ingest/*` + `lib/host-bin.mjs` | ~13 | 知识加工队列：探测类型、转换 Markdown、写回 Inbox/专题；默认 anydoc sidecar（userData 热升级，不必重打包）；可选 markitdown/pandoc；内置 JS 兜底 |
| WereadService | `weread-service.mjs` | ~10 | 微信读书 connector（可选） |
| XService | `x-service.mjs` | ~7 | X (Twitter) connector（可选；normalize 在 `lib/x-normalize.mjs`） |

### AI Agent（Desktop 内嵌 · skill-first）

| 模块 | 职责 |
|------|------|
| `ai-model.mjs` | 多 provider 解析（AI SDK v7） |
| `ai-provider-adapter.mjs` | 桥接 Desktop AI SDK → Kernel `AiProvider` 接口（`generate(prompt, context)`）；根据 `context.operation` 动态调整 `maxOutputTokens`（`OP_LIMITS`：topic_summary → 16K、period/digest/todo/memory_organize → 12K、memory_extract/topic_classify → 4K）+ `temperature`（提取类 0.3 / 分析类 0.5）+ `systemPrompt`（结构化输出操作）；瞬态错误（timeout/429/503）自动重试 1 次（800ms 退避）；`suggest-engine` / `derived-builder` 通过此适配器真实调 LLM |
| `ai-prompts.mjs` | **skill-first 协议** + Skills Discovery 目录 + 真实 tool 名 |
| `lib/skills-runtime.mjs` | engine `skills/` + `ai.extraSkillsRoots` / `topmind_SKILLS_EXTRA`（catalog / body / resource） |
| `lib/skills-extra.mjs` | Desktop 管理目录 `skills-extra/` 安装 · 回执 · pack summary |
| `ai-tools.mjs` | Workspace 工具（含 `edit_file` / rename / delete 等）+ `list_skills` / `load_skill` / `load_skill_resource` |
| `ai-stream.mjs` | multi-step（`maxAgentSteps` 默认 **20**，可配 3–50）+ tool-call/result + **prepareStep steer** + **~16ms text/reasoning delta 合流** |
| `lib/stream-delta-coalesce.mjs` | 纯合流缓冲：帧级节流 IPC；非 delta 事件先 flush |
| `ai-service.mjs` `complete` | 行内 one-shot（无 tools）；`sanitizeInlineAiResult` 剥离思考标签/元话术后再返回 |
| `lib/inline-ai-result.mjs` | 行内结果清洗纯函数（主进程 + 单测）；渲染层 `src/lib/inline-ai-result.ts` 镜像 |
| `ai-service.mjs` | invoke 默认 `useTools!==false`；`steerStream` / `queueFollowUp`；skills catalog；**错误标记 `isError` + `usage`/`modelId` 回传渲染层** |
| `lib/ai-tool-evidence.mjs` | 写回回执归一化 + 工具摘要（路径/备份） |
| `lib/ai-session-compact.mjs` | token 估算 + 工具时间线折叠 + 中间摘要（maxMessages 60 / keepRecent 24 / maxChars 240K ≈ 80K tokens — 适配 128K+ 现代模型） |
| `ChatMessage.tsx` | **错误重试按钮**（`isError` → ErrorBlock + `regenerate()`）；**Token 用量徽章**（`usage.promptTokens ↑ / completionTokens ↓`）|

**工作循环（默认）**：Route（对照 catalog）→ Activate（`load_skill`）→ Execute（Workspace 工具）→ Receipt。  
**设置**：`Settings → Skills`（`ai.skillsEnabled` / `enabledSkillIds` / `extraSkillsRoots`；回执与扩展根 summary）。  
**打包**：`pack:prepare` → `resources/topmind-engine/skills/`（与 templates/lib 同源）。

进程纪律：`main.mjs` 设 `app.setName("topmind")`。**macOS Dock 图标**：dev 时 `dev-electron.mjs` 先跑 `patch-electron-icon.mjs` 替换 `Electron.app/.../electron.icns`（`app.dock.setIcon`  alone 不可靠）；打包版用 `build/icon.icns`。非 main 的 `BrowserWindow` 立即 destroy；activate 只 focus 已有窗口。

> connector 服务的 RPC 方法名以 `skills/topmind-weread/SKILL.md` / `skills/topmind-x/SKILL.md` 的「Desktop 集成」段为准。  
> 新 connector 接入：复用 `electron/lib/connector-bridge.mjs`（禁止绕过 `writeConnectorNote` 直接组合 `kernelDurableWriteAbs`+`injectFrontmatter`）。  
> ADR：`docs/adr/2026-07-16-desktop-skill-first-agent.md`。

## 7 个 Store

| Store | 状态 |
|-------|------|
| `ViewStore` | 选区、侧栏、AI 面板、覆盖层、写回模式、编辑器设置、主题 |
| `AiStore` | 会话、消息、流式、上下文胶囊、运行时、模型选择、activeSkillId |
| `ActionStore` | 建议 + 待确认写入（`SuggestPopover` 主确认面 · 会话缓存 · panelOpen）：refresh / accept / reject / dismiss |
| `PluginStore` | 插件生命周期与清单缓存 |
| `IngestStagingStore` | 知识加工待确认批次、降级提示、队列状态 |
| `TaskStore` | AI 后台任务（`reconcile` 确定性整理 · `ai_digest` AI 分析周期）：创建、执行、取消、重试、进度、日志 |
| `TodoStore` | 个人待办（`memory/todo.md`）：加载 / 增删改 / 截止日期 / AI 维护（提取+检测完成+更新状态）/ force 重处理 |

## 持久化真源

| 数据 | 位置 | 说明 |
|------|------|------|
| 应用设置 | `~/topmind/topmind-desktop/state/app-settings.json`（+ `.bak`） | 原子写；密钥 safeStorage；含 `plugins.externalEnabled` · `ai.extraSkillsRoots` |
| 第三方插件 | `~/topmind/topmind-desktop/plugins/` | 每插件一文件夹；卸载进 `plugins/.trash/` |
| Skills 扩展 | `~/topmind/topmind-desktop/skills-extra/` | 可选；回执 `.topmind-skills-extra-install.json`；重装进 `skills-extra/.trash/` |
| UI 布局 | `settings.ui.*` | Shell 防抖 + pagehide 冲刷 |
| 窗口 bounds | `settings.window` | main 进程 close 时写入 |
| AI 会话 | `state/workspaces/<slug>/session-messages/` | 非内容真源 |
| 工作区内容 | 用户 workspace FS | 唯一内容真源 |
| 工作区配置 | `{workspace}/topmind.yaml` | schema v4 类别/视图/写回/记忆 |

设置页 IA：**环境**（通用/工作区）→ **智能体**（AI/Skills/Tools）→ **扩展**（插件/连接器）→ **管理与更新**。

### 更新检查（Manage & Updates）

| 面 | 当前版本来源 | 线上版本来源 | 更新方式 |
|----|--------------|--------------|----------|
| **Desktop** | `app.getVersion()` | Release 资产 `topmind-X.Y.Z-*` | 下载安装包重装 |
| **Skills** | `topmind-engine/skills` + `versions.json` | `topmind-skills-X.Y.Z.*` | 随 Desktop 重装；或 Settings → Skills 装到 `skills-extra/` |
| **剪藏扩展** | 浏览器扩展 / `versions.json` 参考 | `topmind-clip-extension-*` | 浏览器侧装 zip；Desktop **不内嵌** CRX |
| **UTR** | 捆绑于 topmind-engine/utr | Tools 控制台 / doctor | AI 写回仍走 WorkspaceService |

实现：`electron/lib/update-check.mjs`（Electron `net.fetch` 优先 → 系统代理；超时/重试；错误可操作提示）。  
环境：`topmind_UPDATE_REPO` · `topmind_UPDATE_API` · `topmind_UPDATE_TIMEOUT_MS` · `GH_TOKEN`。

## 启动与工作区生命周期

```
App.tsx
├── loading → BootScreen（加载动画）
├── onboarding → OnboardingScreen（工作区选择）
│   ├── 最近工作区（可点击卡片）
│   ├── "选择文件夹 / 新建工作区"（原生选择器 + 初始化）
│   └── "使用默认工作区"（如已配置）
└── ready → Shell

工作区切换 / 启动恢复 / 生命周期:
  TitleBar WorkspaceSwitcher (⌘⇧W) / Settings → api.sys.switchWorkspace(path)
  → classifyWorkspaceRoot（healthy|empty|missing|forbidden）拒绝把 topmind-desktop 运行态当内容区
  → activateWorkspace：ensureWorkspaceStructure + autoRepair（分隔符/必选 role）
  → 写入 settings.workspaceRoot + workspaces.recent（**canonical 去重**，realpath + 大小写折叠）
  → 下次启动 listLaunchCandidates：CLI → 上次 root → recents（lastOpenedAt）
  → normalize/refreshWorkspaceHistory：剪除 missing/forbidden，不去 detect 劫持路径
  → Landing Onboarding：refresh + 健康徽章（可用/空目录/不可用）
  → 默认 ~/topmind/topmind-workspace 仅 recents 中出现才自动进

全局快捷键:
  ⌘⇧N (任意应用) → 显示窗口 + emit overlay:open quick-capture
  ⌘N (窗口内) → openOverlay quick-capture
  ⌘⇧W (窗口内) → toggle WorkspaceSwitcher dropdown
  ⌘K → 命令面板 | ⌘P → 全局搜索 | ⌘, → 设置
```

### 窗口创建防竞态

macOS 上 `activate` 事件可能在 `whenReady` → `initApp()` 期间触发（此时尚未创建窗口），导致 `createWindow` 被调用两次。`main.mjs` 使用 `windowCreating` 守卫标志确保只有一个创建路径胜出。

### 弹窗与导航防护

`createWindow` 中设置了 `webContents.setWindowOpenHandler(() => ({ action: "deny" }))`，拒绝所有弹窗请求。`will-navigate` 事件处理器仅允许同源导航（Vite HMR、`location.reload()`），阻止外部 URL 导航。这防止了 AI 流式响应期间 HMR 重载或渲染错误导致的“多窗口” bug。

### 全局快捷键

`main.mjs` 注册了 `CommandOrControl+Shift+N`（⌘⇧N）全局快捷键，用于从任意应用一键唤起 topmind 窗口并打开 QuickCapture 覆盖层。快捷键通过 `emitToRenderer` 发送 `overlay:open` 事件，渲染进程的 `OverlayHost` 通过本地事件总线接收并打开 QuickCapture。应用退出时自动注销所有快捷键。

### macOS Dock 徽标

AI 流式传输期间，主进程在 `emit` 函数中拦截 `ai:stream` 状态事件，当看到 `preparing` 时设置 dock 徽标为 `●`，当看到 `done` 时清除。`ai-stream.mjs` 的 `finally` 块始终发射 `done` 状态，确保即使出错/中断也能清除徽标。

### 设置同步（关键）

`main.mjs` 的 `appSettings` 变量是窗口尺寸持久化的基准。`SystemService.updateSettings` 保存设置后**必须**调用 `ctx.updateAppSettingsInMemory(next)` 同步内存状态。窗口 bounds `persist` 会先 `loadAppSettings` 再 merge bounds，避免 stale 内存覆盖密钥。

`updateAppSettings` 在 per-file 写队列内 **re-read 磁盘** 作为结构基线，再 overlay 内存中的非空密钥，最后 merge patch——避免窗口 bounds / 设置页 / modelCache / Clip Bridge 并发 patch 互相覆盖。

### 国际化架构 (i18n) — 概览

四体独立 i18n，共享 locale 标识符（`zh-CN` / `en-US`），详见 [UI 层 §国际化](#国际化i18n--四体全景)。

- **Desktop 渲染层**：`src/locales/` i18next 同步打包，10 namespace JSON；`locale-resolver.ts` 实现 `auto → navigator.language → BCP-47 → zh-CN / en-US` 回退链。
- **Desktop 主进程**：`electron/lib/electron-i18n.mjs` 轻量 `t()`，覆盖原生菜单 / 托盘 / 捕获窗文本。
- **Browser Extension**：`_locales/{zh_CN,en_US}/messages.json` + `chrome.i18n.getMessage()`；manifest 用 `__MSG_*__`。
- **UTR**：`utr/core/i18n-strings.mjs` 独立对称双语表，locale 从 config / env 解析。
- **Templates**：`templates/{id}.{locale}.json` overlay 合并。
- **Skills**：双语文档，无程序化 i18n。

1. `mergeAppSettings`：secret 字段 `""` = 保持；`null` = 清除；非空 = 替换  
2. `serializeSettingsForDisk`：加密写入 `secureStorage`；若明文空且未标记清除，**复用磁盘旧密文**  
3. 设置 UI 只发**局部 patch**（勿 `...settings.ai` 整包回写空 manual）

`persist` 函数还从磁盘重新加载最新设置作为防御性双保险，确保不会因为内存状态过期而丢失数据。

## AI 流式传输架构

```
AiService.invoke
  → loadSettingsWithSecrets(ctx)  // 解密 API Key
  → resolveModel(settings, model)  // 路由到正确提供商
  → compactMessagesForModel(...)   // token/轮次预算；保留工具路径 gist
  → buildSystemPrompt(...)         // skill-first + 工具名 + edit/read 策略
  → ToolService.buildAiTools(...)  // Desktop-native tools → WorkspaceService（不依赖 UTR）
  → runStream({ model, messages, tools, emit })
      → streamText (Vercel AI SDK v7)
      → prepareStep: drain steers → 注入「用户中途指示」
      → toUIMessageStream({ sendReasoning, sendStart, sendFinish })
      → 事件循环:
          start        → emit status: thinking
          reasoning-*  → emit reasoning delta（可折叠，不是正文）
          text-*       → ingest 拆 think/CoT 后只 emit 可见正文（text-reset 可回收误发前缀）
          tool-input-* → emit status: calling-tool
          tool-output  → emit tool-result（路径摘要）+ status: writing
          steer-applied→ emit status: steering
          finish       → emit status: done
  → 返回 { text: 可见正文, reasoning, usage, error, followUps, batchEvidence }
```

超时策略：
- 总超时：4 分钟（硬上限，multi-step）
- 空闲超时：120 秒（无 chunk 时触发，足够覆盖工具执行）
- 检查间隔：10 秒

写/读工具：`edit_file`（Kernel `applyUniqueSpan`：精确 → 换行/行尾空白规范化；多处拒绝；失败带 nearby/context；**不写 Archive**）· `save_file` 整文件覆盖（**仅 locked 覆盖备份**；open 不备份）· `delete_path` 跟 `isRecoverableLifecycle`（普通开放笔记无 trash；锁定 / 专题首页 / 写出来 才进归档）· `read_file` 带行号窗口 + `around`/`heading` 中段定位 · `search`=`grepWorkspace`（可 scope、默认可跳过 Archive、行号命中）。  
中途控制：`ai.steerStream` · `ai.queueFollowUp`；打开文件本轮自动带入（无需点挂载）。  
ADR：`docs/adr/2026-07-16-desktop-agent-harness-upgrade.md`。

## Shell 结构

> UI 像素与 IA 真源：`DESIGN.md` §0.0 / §0（**Design System 2.1 · Modern Warm-Neutral**；token 数值真源 `src/styles/tokens.css`——见 `../docs/adr/2026-08-07-desktop-single-entry-dedupe.md` · `../docs/adr/2026-08-07-comprehensive-design-optimization.md`）。本节约架构职责 + **现状/目标**。

### 目标 IA（Product target · **Done** Wave F–G + 2026-08-07 优化）

```
Shell
├── TitleBar
│   ├── 左: 侧栏 + 前进/后退 + WorkspaceSwitcher（⌘⇧W）— 品牌芯片已移除（2026-08-07）
│   ├── 中: PrimaryNav — **动态（默认）** · **收件箱** · **写出来** · **搜索** + ⌘K
│   └── 右: **记一下**（⌘N）+ 建议 + 待办 + 设置 + AI
├── Sidebar — 默认动态流；二级专题树 / 记忆 / 我的情况 / 归档；高级 tags/kanban/plugins
├── EditorArea — 默认动态主表面或 ViewSlot 编辑
├── AiPanel — 副驾：compact ActionBar（跳转）+ 对话区 + Composer
├── SuggestPopover — **全局建议确认面**（标题栏 💡 / strip / openSuggestSurface）
├── StatusBar — 健康即沉默；路径不常驻；AI pill + 命名 busy chip（Task/Todo/Suggest/Inline）；多路径 `multiActive` / `AI ×N`
└── OverlayHost（QuickCapture · ⌘K · Search · Settings）
```

**多路 AI（实现）**：`src/lib/ai-background-lane.ts` 串行后台 prep（suggest · todo maintain）；Agent 流独立；soft 建议 `agent_busy` 让路；策略与像素见 `DESIGN.md` §0.0.3。

### 现状（已收敛 · Phase B Done）

PrimaryNav 文案与默认 selection 为 **动态 · 收件箱 · 写出来 · 搜索**（`selection: stream`）。  
旧「工作台」主锚点已退役（**代码债**清零）；**HomeView 与 `kind:home` 产品类型已删除**（`normalizeSelection` 迁移历史状态 → stream）。归档不在主锚。

```
Shell
├── TitleBar · PrimaryNav（动态 / 收件箱 / 写出来 / 搜索）+ 💡 建议 + 清单
├── Sidebar（ViewSwitcher: stream/category/timeline/tags/kanban）
├── EditorArea（StreamDetailView · 文件编辑）
├── AiPanel（compact ActionBar 仅专注模式 · 对话区 · Composer）
├── SuggestPopover（唯一完整建议确认列表）
├── StatusBar（deriveStatusBarBusy · 建议计数 chip · multi-AI 诚实）
└── OverlayHost …
```

### Stream 主表面（默认着陆 · 与代码一致）

默认 `selection: { kind: "stream" }` → **`StreamDetailView`**（周期本浏览器，非旧 Home 仪表盘）。

**已删除、勿再文档化的 Home 仪表盘能力**：问候 CTA、钉住卡、下一步/进行中/截止、最近专题材料条、连接器条。那些只属于已删 `HomeView`。

**建议 / 审阅**：全局 **`SuggestPopover`**（标题栏 💡 · 状态栏计数 chip 仅 count>0 · 不嵌 Stream 列表；画布顶 `SuggestEntryStrip` 已删）。侧栏 pin 可达「本周动态」「我的情况」。

### StreamDetailView（主编辑区动态流 · 已实现）

`selection: { kind: "stream" }` 或 legacy `home` → 同一组件：

- **数据源**：`api.ws.getStreamContext()` → `api.ws.read(periodRelPath)` + `api.ws.listStreamPeriods()`
- **条目展示**：当前周期本条目按时间倒序卡片；可展开/折叠
- **操作入口**：整理（`reconcileStreamPeriod`）· 捕获（⌘N）· 打开周期文件编辑 · 周期切换
- **自动刷新**：订阅 `workspace:file-changed`，450ms 防抖静默重载
- **AI 整合**：reconcile 失败时可 fallback AI 整理 prompt；有候选条目时提示（非静默高影响写）
- **快捷键**：⌘⇧S / ⌘⇧T 均导航到 `{ kind: "stream" }`
- **入口**：PrimaryNav「动态」· 侧栏 pin · 命令面板 · 快捷键

### 连接器 Hub UI（共享原语）

| 表面 | 入口 | UI 原语（`src/plugins/connector-ui.tsx`） |
|------|------|------------------------------------------|
| WeRead | `{ kind: "connector", id: "weread" }` | `ConnectorHubHeader` · `StatusPill` · `ToastBanner` |
| X | `{ kind: "connector", id: "x" }` | 同上；可选能力关闭用 `badTone="muted"` |
| Ingest | `{ kind: "connector", id: "ingest" }` | `ConnectorHubHeader` + 工具探测 pill |

**禁止**在各 hub 内复制第三套 header/toast 样式。像素规范见 `DESIGN.md`。

### AiPanel

- **面板头部**: 会话下拉 + RuntimeBadge + TaskBadge + 会话控制
- **ContextPills**: 挂载文件以可移除胶囊形式展示
- **EmptyConversation**: 按选区类型显示上下文感知的快捷提示
- **ChatThread**: 消息气泡 + 头像 + 流式光标 + 工具结果卡片（含 `edit_file` diff 内联）
- **ActionBar**: compact 计数 chip → `openSuggestSurface` → **`SuggestPopover`**（完整列表在弹层，≠ 个人清单）
- **ChatInput**: 自适应输入框 + 发送/停止；**模型选择器与技能同排 chip**（非独占 footer）；仅已配置提供商

### TaskPanel（浮动后台任务面板）

与 AiPanel 独立的双面板架构组件，负责确定性引擎任务的后台执行与进度展示：

- **定位**：`position: fixed`，浮动在右下角（`z-floating`），不占三栏布局空间
- **触发**：⌘⇧J 全局快捷键 / TitleBar `ClipboardList` 按钮（与 AiPanel 开关独立）
- **状态管理**：`useTaskStore`（Zustand）— 任务队列、并发控制（maxConcurrent: 3）、取消/重试/清除；支持 `reconcile`（确定性）和 `ai_digest`（AI 驱动）两种任务类型
- **任务类型**：`reconcile`（整理周期本，确定性）+ `ai_digest`（AI 分析周期，真实 LLM）接入真实引擎 API；UI 仅暴露已接线类型。`PendingTaskType`（digest/promote/…）保留类型注释，不渲染入口
- **面板状态**：正常（任务列表）/ 最小化（仅标题栏 + 运行中数量）/ 展开（任务详情 + 日志 + 结果）
- **拖拽**：标题栏 `mousedown` → `document` `mousemove/mouseup`（state-driven，仅拖拽期间注册监听器）

### 持久化 UI 状态

侧栏宽度、侧栏折叠、AI 面板开关、AI 面板宽度持久化到 `settings.ui`（500ms 防抖）。下次启动时从 `settings.ui` 恢复。

## AI 模型解析

`ai-model.mjs` 的 `resolveModel(settings, req)` 负责将用户选择路由到正确的提供商 SDK：

1. **per-call 覆盖**（`req` 参数）：AiPanel 模型选择器使用 `provider/modelId` 格式（如 `openai/gpt-4o-mini`），后端解析后直接路由到对应提供商，不受首选提供商影响。
2. **首选提供商 + 默认模型**：当无 per-call 覆盖时，`settings.ai.defaultModel` 仅应用于首选提供商（`sourcePreference`），其他提供商使用各自默认模型。
3. **自动降级**：按首选优先顺序遍历可用提供商，第一个有 API Key 的即使用。

```
AiPanel 选择器值: "openai/gpt-4o-mini"
                     ↓
resolveModel 解析: provider=openai, modelId=gpt-4o-mini
                     ↓
路由: createOpenAI({ apiKey })("gpt-4o-mini")
```

设置中的 `defaultModel` 不含提供商前缀（如 `"gpt-4o-mini"`），因为它始终绑定到首选提供商。

### AI 设置持久化（关键）

API Key 通过 Electron `safeStorage` 加密存储。**所有读取设置的服务必须使用 `loadAppSettings` + `secretAdapter`**，不能直接 `readJson` 读取设置文件——磁盘文件中 `ai.manual` 的 key 字段是空字符串（加密后清空），实际密钥在 `secureStorage.manual` 中。

```
getSettings()     → loadAppSettings(fp, root, { secretAdapter })  ✓ 解密
updateSettings()  → loadAppSettings → mergeAppSettings → saveAppSettings  ✓ 加密+解密
getRuntimeStatus()→ loadSettingsWithSecrets(ctx)  ✓ 解密（v4.6 修复）
invoke()          → loadSettingsWithSecrets(ctx)  ✓ 解密（v4.6 修复）
discoverModels()  → loadAppSettings(fp, root, { secretAdapter })  ✓
```

### AI 模型选择持久化

Composer 模型列表与设置一致：仅 `runtimeStatus.providers`（已配置 Key/端点）的提供商；选中值写入 `ai.sourcePreference` + `ai.defaultModel`。完整 models.dev 目录仍可在设置里浏览未配置提供商。

AiPanel 模型下拉选择器的 `onChange` 不仅更新内存 store，还同步调用 `api.sys.update({ ai: { sourcePreference, defaultModel } })` 持久化到设置。这确保用户在 AI 面板切换模型后，重启应用仍保持选择。

设置面板修改 AI 配置后，`SettingsDialog` 发射 `ai:settings-changed` 本地事件，`AiPanel` 订阅后重新获取模型列表并同步下拉选择。两端双向同步，不再需要重启。

模型下拉选择器始终可见：AI 离线时显示为禁用状态并提示“AI 离线 — 配置 API Key 后启用”，让用户知道此处有模型选择功能。

### 双源模型目录（官方 list-models + models.dev）

设置 / Composer 的模型列表由 `lib/model-catalog.mjs`（Desktop 打包副本 `electron/lib/model-catalog.mjs`）解析合并：

1. **官方 list-models**（已配置 Key/端点）：OpenAI 兼容 `GET {base}/models`、Google `GET /v1beta/models`、Ollama/Custom 同 OpenAI 形。刷新强制绕过 TTL。
2. **[models.dev](https://models.dev) 社区目录**：无密钥浏览、Anthropic（无公开 list 端点）、能力元数据（toolCall / reasoning / contextLimit / cost）。
3. **精选默认**：仅作回退。失败的官方/社区拉取**不会**写成 live 缓存，也不会用空列表覆盖上次成功的官方列表。

`discoverModels()` 始终按 official > community > curated 合并；`fetchLiveModels()` 只持久化成功的官方条目。供应商 ID 映射：openai / anthropic / google / deepseek / moonshotai→moonshot / zhipuai→zhipu / minimax / xai。

### 支持的 AI 供应商

| 供应商 | source ID | 区域 | 密钥字段 | 备注 |
|--------|-----------|------|----------|------|
| OpenAI | `openai` | 国际 | `openAiKey` | 原生 SDK |
| Anthropic | `anthropic` | 国际 | `anthropicKey` | 原生 SDK |
| Google | `google` | 国际 | `googleKey` | 原生 SDK |
| xAI / Grok | `xai` | 国际 | `xaiKey` | OpenAI-compatible |
| DeepSeek | `deepseek` | 国内 | `deepseekKey` | OpenAI-compatible |
| Moonshot / Kimi | `moonshot` | 国内 | `moonshotKey` | OpenAI-compatible |
| Zhipu GLM | `zhipu` | 国内 | `zhipuKey` | OpenAI-compatible |
| MiniMax | `minimax` | 国内 | `minimaxKey` | OpenAI-compatible |
| Ollama | `ollama` | 本地 | — | 无需密钥；默认 `http://127.0.0.1:11434/v1` |
| Custom | `custom` | 本地 | `customKey` + `customBaseUrl` | 任意 OpenAI-compatible 端点 |

设置面板使用供应商卡片 UI（`ProviderCard` 组件）：按国际/国内/本地三区分组，每个供应商可展开配置密钥和查看模型列表。

### AI 工具暴露策略（全能力 Agent，无 UTR）

`buildDesktopAiTools`（`electron/ai-tools.mjs`）→ **WorkspaceService**。系统提示只列出实际加载的 snake_case 工具名。多步 tool loop：`maxAgentSteps` 默认 **20**（`AGENT_STEPS_DEFAULT` / `DEFAULT_MAX_AGENT_STEPS`，可配 3–50）。Skills 以 playbook + `/slash` 接入，不是第二进程。

| 写回模式 | 暴露的工具 | 说明 |
|----------|-----------|------|
| auto | 读 + 写 + fetch_url + health | 每写一处返回 WritebackEvidence；≥2 路径时回合结束汇总 `batchEvidence` → toast + 回执条 |
| confirm（保存前问我） | 读 + 写工具仍注册 | AI 写经 Kernel pending；`SuggestPopover` 接受/拒绝后落盘 |

读（`AI_TOOL_NAMES_READ`）：`list_skills` · `load_skill` · `load_skill_resource` · `list_categories` · `list_topics` · `list_topic_files` · `get_topic` · `read_file` · `search` · `list_inbox` · `list_outputs` · `fetch_url`（`maxLen` / `render`）· `workspace_health`  
写（`AI_TOOL_NAMES_WRITE`）：`capture_to_inbox` · `save_note` · `save_file`（open 覆盖不备份；locked 覆盖才备份）· `edit_file`（唯一片段，**不写 Archive**）· `create_topic` · `append_topic_memory` · `move_to_topic` · `publish_to_outputs` · `delete_path`（仅 recoverable 进归档）· `rename_path`（重命名不备份）

### 编辑器 Markdown / 预览（1.0.12+）

- TipTap + `tiptap-markdown` + Link / Image；`setEditorMarkdown` **只传 Markdown 字符串**  
  （扩展已 override `setContent` 做 parse；禁止传入已 parse 的 doc，避免双重 parse）  
- **禁止**在 ProseMirror 上使用 `whiteSpace: pre-wrap` / 全文 `nowrap`  
- 预览模式：进入预览时快照 `getHTML()` → 静态 `.v4-tiptap` 表面  
- `editor.contentWidth`：`compact | reading | wide | full`（默认 `reading` ≈ 52rem）  
- `editor.pagePadding` / `editor.paper`：阅读边距与画布纸张色（编辑/预览共用；工具栏 Aa + 设置）  
- 行内 AI：`ai.complete` + `ai.cancelComplete`（`requestId` · `AbortSignal`）；选区浮条 / 工具栏 ✨；无 tools 会话  
  - 取消：前端 ignore 迟到结果 + 主进程 abort `generateText`  
  - 应用：选区替换前校验原文是否漂移  

- Windows：`titleBarStyle: hidden` + `titleBarOverlay`（主窗与快速捕获浮窗）  
- 知识加工队列 UI：`IngestQueuePanel`（Hub + 浮窗共享主进程 jobs）  
- 属性条：`Select variant="chip"` 单层描边  

### 侧栏 / 工作区树（1.0.12+）

- `workspace.listWorkspaceDir` + `file-filter`（`ui.fileFilter`: default | markdown | all）  
- 专题 / 88 / 99 / **memory**：**folder 懒加载**；揭示嵌套文件时展开祖先 folder  
- **记忆区段**：`memory/` 目录（profile / todo / periodic / topics）在类别与输出之间展示
- 展开状态：`localStorage topmind:expanded-nodes:{ws}`；**空数组 = 用户全折叠**  
- softRefresh：debounce 200ms、不切 loading、保留已展开 childrenCache；**listing vs content** 由 `lib/tree-listing-change` 判定——inbox / 输出 / 归档 / 类别根 / add·unlink / ingest 完成走区段重建（空 inbox 变有文件则展开）；专题内部 content-only 带 relativePath 仍定向刷新，避免整树闪烁  
- 手动刷新：`tree-toolbar` 内 `data-sidebar-refresh`（与展开/折叠/排序/筛选同组），强制 `getTree` 含空 inbox；自动感知是主路径，按钮是逃生口  

- Timeline / Tags / Kanban：`load({ silent: true })`  

### 关窗 / AI 会话（1.0.12+）

- `ui.closeBehavior`：`ask` | `hide` | `quit`  
- AI 面板挂载：`loadSessions` 后 **新建空会话**（历史仍在列表）  

### URL 抓取 / 剪藏管线

```text
L1  workspace.fetchUrl
      HTTP + @mozilla/readability + html-to-markdown
      (workspace-fetch-ops / fetch-article)
L2  fetchUrl({ render: true })
      fetch-render.mjs — offscreen BrowserWindow（ephemeral，不占 Dock）
L3+ Browser Extension → POST /v1/clip → clip-bridge.mjs
      页内 Readability → content_html
      → normalizeClipPayload（复用 html-to-markdown）
      → ingestInbox + fetch_method / word_count frontmatter
```

- 默认 L1；`render: true` 或用户点「增强渲染」走 L2  
- Ephemeral 窗：`markEphemeralBrowserWindow` — 不触发 Dock 双图标误杀  
- Clip Bridge：仅 `127.0.0.1`、Bearer token、默认关闭；见 `lib/clip-bridge.mjs` · `lib/clip-payload.mjs`  
- 返回 / 落盘：`method`（readability|heuristic|render|selection|manual）· `truncated` · `likelySpa` · `warning`  
- 分层约定：`../skills/shared/long-url-capture.md` · ADR `../docs/adr/2026-07-13-browser-clip-extension.md`

### 统一捕获 + 知识加工

```text
⌘N overlay | ⌘⇧N float(?surface=capture) | FileDrop | paste
  → QuickCapture（智能分流）
      ├─ text/URL → workspace.ingestInbox
      └─ files    → ingest.enqueue → queue
                      → detect → convert → commitMarkdown
                      → events ingest:job-*

Clipboard: ingest.readClipboard (text/html/file paths)
Float win: utility BrowserWindow (skipTaskbar, not destroyed by dual-dock guard)
```

- 设置：`settings.capture`（globalMode / floatAlwaysOnTop / smartPaste / closeFloatOnSave）  
- 插件 Hub：`src/plugins/topmind-ingest/`  
- 转换：`convert-policy.mjs`（偏好 → 回退）+ `anydoc-sidecar.mjs`（PATH / userData / 可选 bundled）；设置 `ingest.preferredConverter` 默认 `auto`  
- **升级**：anydoc sidecar / 本机 PATH **不必重打包 Desktop**；asar 内应用代码、Electron、内置 JS 转换器需要新版 Desktop  
- 约定：`../skills/shared/document-ingest.md` · ADR `../docs/adr/2026-07-19-knowledge-ingest-pipeline.md`

UI：消息内 **tool timeline**；输入区 Skill 芯片 + Agent 开关；会话首条自动标题。

## 插件系统

> 插件扩展说明真源：`PLUGIN.md`（连接器分层、X MCP vs Desktop API、生命周期）。

### 契约（`src/plugins/types.ts`）

**8 种槽位类型**驱动整个 Shell：

| 槽位 | UI 呈现位置 | 说明 |
|------|------------|------|
| **DataSource** | 侧栏区段 + 树 | 拥有一棵树 + 节点读写语义。内置：类别+专题文件系统 |
| **SidebarSlot** | 侧栏底部插件区 | 两种模式：简单（label+icon+onSelect）或富渲染（render()）。连接器插件用富渲染展示同步控件 |
| **ViewSlot** | 编辑区内容 | `matches(selection)` 返回 true 时渲染。第一个匹配（order 最低）的胜出 |
| **ActionSlot** | 命令面板（⌘K）、上下文菜单、快捷键 | 插件可注册自定义操作 |
| **SettingsSlot** | 设置对话框 Tab | 插件注册自定义设置面板，始终可用（即使插件未启用） |
| **OverlaySlot** | OverlayHost | 插件注册自定义模态层，当 kind 不匹配内置时检查 |
| **StatusBarSlot** | StatusBar | 插件贡献状态栏内容（align: left/right） |
| **ContextMenuSlot** | TreeView 右键菜单 | 插件贡献上下文菜单项，`matches(node)` 决定适用性 |

```ts
interface Plugin {
  manifest: PluginManifest;        // { id, name, version, description, settingsKey? }
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

interface PluginContext {
  rpc;        // invoke(method, params) + subscribe(event, handler)
  workspaceRoot;
  events;     // 本地事件总线，桥接后端事件
  ai;         // invoke, mountFile, unmountFile, runtimeStatus
  settings;   // get, update
  register;   // (slot: Slot) => () => void
  pluginId;   // 插件 ID（由 host 设置）
  openOverlay(kind, context?);  // 便捷方法：打开覆盖层
  navigate(selection);          // 便捷方法：导航到选区
  toast(message);               // 便捷方法：显示 toast
}
```

### 槽位与 UI 的对应关系

| 槽位类型 | UI 呈现位置 | 示例 |
|----------|------------|------|
| DataSource | 侧栏区段 + 树 | "工作区"区段（类别 → 专题 → 文件） |
| SidebarSlot | 侧栏底部插件区 | 微信读书同步控件、X 推文抓取控件 |
| ViewSlot | 编辑区内容 | StreamDetailView, CategoryView, FileEditorView 等 |
| ActionSlot (goto) | 命令面板 → 导航 | 转到 · 动态/收件箱/交付物/归档 |
| ActionSlot (skill) | 命令面板 → 技能 | Capture, Organize, Write, Memory, Loop |
| ActionSlot (sync) | 命令面板 → 同步 | 微信读书同步、X 推文抓取 |
| SettingsSlot | 设置对话框 → 插件 Tab | 微信读书配置、X/Twitter 配置 |
| StatusBarSlot | 状态栏右侧 | 读书同步时间、X 连接状态 |
| ContextMenuSlot | TreeView 右键菜单 | 插件贡献的节点操作 |

### 插件生命周期

```
BUILTIN_PLUGINS (单一注册表)
  ├── { id: "topmind-workspace", load: () => import("./topmind-workspace") }
  ├── { id: "topmind-weread",    load: () => import("./topmind-weread") }
  └── { id: "topmind-x",         load: () => import("./topmind-x") }

activateAll()
  └── for each entry in BUILTIN_PLUGINS:
      └── load() → activatePlugin()
          ├── workspace: 始终全量注册（builtin:true）
          ├── weread:    SettingsSlot 始终注册；交互槽位条件注册
          └── x:         SettingsSlot 始终注册；交互槽位条件注册

togglePlugin(id, wsRoot)
  ├── isPluginBuiltin(id) → return (内置插件不可停用)
  ├── per-plugin lock 防止重入
  ├── deactivatePlugin(id)   — 清理所有槽位
  └── loadPluginById(id)     — 从注册表查找，重新激活
```

- **BUILTIN_PLUGINS 注册表** — 单一真源，activateAll 和 togglePlugin 共用，新增插件只需加一行
- **builtin 保护** — manifest.builtin:true 的插件无法被 deactivatePlugin/togglePlugin 停用
- **SettingsSlot 始终注册** — 用户可以在插件未启用时配置参数
- **交互槽位条件注册** — SidebarSlot/StatusBarSlot/ActionSlot 仅在 `settings[key].enabled === true` 时注册
- **PluginStore** — active / disabled / error  
- **PluginsPanel** — 内置 / 连接器 / 第三方分区；第三方支持预览权限 → 安装、开关、热加载、卸载  

### 如何扩展插件

| 路径 | 做法 | 文档 |
|------|------|------|
| First-party | `src/plugins/<id>/` + `BUILTIN_PLUGINS` 一行 | 本节约定 + `types.ts` |
| Connector | `defineConnectorPlugin` | `connector.ts` · weread/x 样板 |
| 第三方 | `plugins/<id>/topmind-plugin.json` + ESM；UI 安装或手拷 | **`PLUGIN.md`（真源）** |

原则：数据落工作区 FS；`ctx.rpc` / 写回证据；Settings 槽始终可配置；内容真源不进 Desktop state。

### 加载机制

- **BUILTIN_PLUGINS** 单一注册表；`activateAll` → workspace 再 connectors 再 external  
- **builtin 保护** · 连接器 `togglePlugin` 热切换 · 外部 `externalEnabled` + `reloadExternalPlugins`  
- **第三方权限强制** · 安装前 risk preview · 详见 `PLUGIN.md`  
- **Skills 扩展** · `extraSkillsRoots` + env + `skills-extra/` 回执 · 见 `skills/shared/host-loading.md`

### 内置插件

#### `topmind-workspace`（核心，始终全量加载）
- 1 个 DataSource（Category+Topic 文件系统遍历）
- 7 个 ViewSlot（StreamDetail / Category / TopicOverview / FileEditor / Inbox / Outputs / Archive）
- 8 个 ActionSlot（4 个导航 · 动态/收件箱/交付物/归档 + 看板 + 全局搜索 + 设置 + 命令面板）
- 5 个 Skill ActionSlot（Capture / Organize / Write / Memory / Loop）

#### `topmind-weread` / `topmind-x`（connector，`defineConnectorPlugin`）

两者均经 `src/plugins/connector.ts` 激活：Settings 始终注册；交互槽仅 `settings.*.enabled` 时注册。

| 插件 | Settings | 交互槽 |
|------|----------|--------|
| weread | API Key · `syncCategory: auto` · `includeThoughts` · `syncBudgetMinutes`（1–15，默认 4） | Sidebar 同步 / Hub / Action / StatusBar |
| x | Bearer + xurl 探测/安装引导 · `syncCategory: auto` · `autoArchivePosts` · MCP URL（仅 Agent 文档） | Sidebar / Hub 预览勾选归档 / 发帖 / Action / StatusBar |

官方 Gateway：`POST https://i.weread.qq.com/api/agent/gateway`，`Authorization: Bearer wrk-*`，body 为 **flat** `api_name` + `skill_version` + 业务字段（`lastSort` / `synckey`，禁止 `params: {…}` 包裹）。`/user/notebooks` 分页；想法走 `/review/list/mine`。增量：本地条数 / `note_fingerprint` 跳过，**不用** `lastSyncAt` 做时间过滤。`noteCount + reviewCount == 0`（或拉完 bookmarklist+reviews 仍空）不写专题。`upgrade_info` 只展示，不因新 zip 单独硬失败。

X：官方 v2 `GET /2/tweets/search/recent` 与 `GET /2/users/{id}/tweets`（Bearer 或 `xurl /2/…`）；发帖走 `xurl -X POST /2/tweets`。归档 `append` 按 `tweet_ids` 跳过已有推文；不备份（create/update）。Desktop 不内嵌 MCP OAuth。

## UI 层

- **Tailwind 4** 从 `src/styles/tokens.css` 的 `@theme` 块读取设计令牌
- **语义别名**（`src/styles/tailwind-theme.css`）：`bg-card`, `bg-primary`, `text-foreground`, `bg-chrome` 等
- **UI 基础组件**（`src/components/ui/`）：Button, Dialog, Input, Textarea, Select, Card, Tabs, Badge, Separator, Splitter, ContextMenu, view（共享视图原语）
- **图标**: `lucide-react`
- **编辑器**: Tiptap 3（StarterKit + Underline + Typography + Placeholder + CharacterCount + Markdown）
- **无内联样式** — 所有样式通过 Tailwind 类 + 原语组件

### 国际化（i18n）— 四体全景

topmind 四个面（Desktop · Extension · UTR · Skills）各有独立 i18n 机制，只共享 **locale 标识符**（`zh-CN` / `en-US`），无运行时绑定。

```text
┌─────────────────────────────────────────────────────────────────┐
│  Surface          │ i18n 机制                    │ locale 来源   │
├───────────────────┼──────────────────────────────┼──────────────┤
│  Desktop 渲染层   │ i18next + react-i18next       │ settings.ui  │
│  Desktop 主进程   │ electron-i18n.mjs (轻量 t())  │ settings.ui  │
│  Browser Extension│ chrome.i18n + _locales/       │ 浏览器 OS     │
│  UTR              │ i18n-strings.mjs (轻量 t())   │ config / env │
│  Skills           │ 双语文档（无程序化 i18n）      │ N/A          │
│  Templates        │ {id}.{locale}.json overlay    │ settings.ui  │
└─────────────────────────────────────────────────────────────────┘
```

#### Desktop 渲染层

```text
src/locales/
├── index.ts          ← i18next 初始化 + applyLocale() + currentLocale()
├── locale-resolver.ts ← 纯 locale 解析逻辑（无 i18next 依赖，可独立测试）
├── zh-CN/            ← 10 个 namespace JSON（默认语言）
└── en-US/            ← 10 个 namespace JSON
```

- **引擎**：i18next + react-i18next；资源**同步打包**（无异步加载，无 Suspense）
- **支持语言**：`zh-CN`（默认）· `en-US`；`auto` = 跟随 OS（`navigator.language`）
- **10 namespace**：common · shell · settings · editor · ai · workspace · ingest · weread · x · overlays（`check:i18n` 扫描 `src/locales/zh-CN/*.json` 全量，含 weread / x）
- **初始化链**：`main.tsx` import `./locales` → i18next init（lng=zh-CN）→ `App.tsx` `applyLocale(settings.ui.locale)` → `Shell.tsx` 每次 settings 变化时 re-apply
- **非 React 库文件**：直接 `import i18n from "../locales"` 使用 `i18n.t()`（如 `note-meta.ts`、`stream-status.ts`、`writeback-toast.ts`、`skills.ts`、`data-source.ts`、`views.tsx`、`host.ts`、`weread/actions.ts`）
- **插件 manifest i18n**：`PluginManifest` 支持 `nameKey` / `descriptionKey`；`PluginsPanel.tsx` 通过 `t(nameKey)` 解析，fallback 到 `name`；所有内置插件已设置 nameKey / descriptionKey
- **插件 labelKey**：`SidebarSlot` / `SettingsSlot` / `ActionSlot` 支持 `labelKey` / `descriptionKey` 字段，消费端通过 `t(labelKey)` 解析，fallback 到 `label`
- **React 组件**：使用 `useTranslation()` hook + `t()` 函数；所有用户可见文本均走 i18n key，**禁止硬编码中文/英文字符串**
- **日期格式化**：`src/lib/datetime.ts` 使用 `intlLocale()` 获取 BCP-47 tag，相对时间通过 `i18n.t('common:time.*')` 翻译

#### Desktop 主进程（Electron）

```text
electron/lib/electron-i18n.mjs  ← 轻量 t() + setLocale() + getLocale()
```

- 原生菜单、托盘、通知文本翻译；不可用 react-i18next
- locale 从 `settings.ui.locale` → `topmind_LOCALE` env → `app.getLocale()` → 默认 `zh-CN`
- `main.mjs` 启动后调用 `setLocale(settings.ui.locale)` 同步
- **key 覆盖**：menu / tray / capture / workspace / ingest / ai / utr / window 共 8 类，覆盖错误消息、提示、对话框按钮、AI 重写模式提示词等

#### Browser Extension（Chrome MV3）

```text
browser-extension/
├── _locales/
│   ├── zh_CN/messages.json   ← 默认语言（default_locale: "zh_CN"）
│   └── en_US/messages.json
├── lib/i18n.js               ← t() + applyI18n() 辅助模块
└── manifest.json             ← __MSG_*__ + default_locale
```

- **引擎**：Chrome 原生 `chrome.i18n.getMessage()`；manifest 用 `__MSG_key__`
- **locale 来源**：浏览器 OS locale（`chrome.i18n.getUILanguage()`），扩展无法手动切换
- **HTML 翻译**：`data-i18n` / `data-i18n-placeholder` / `data-i18n-title` / `data-i18n-aria-label` 属性 + `applyI18n()` 批量应用
- **内置模板**：`nameKey` 字段 + `getTemplateName()` 解析；用户模板直接用 `name`
- **内容检测正则**（`首页|主页` 等）保持原样，不翻译

#### UTR

```text
utr/core/i18n-strings.mjs  ← t() + setLocale() + setLocaleFromConfig() + resolveLocale()
```

- 独立轻量 i18n（零外部依赖）；`zh-CN` 默认，`en-US` 回退
- locale 从 `topmind.yaml` 的 `workspace.locale` 字段或 `topmind_LOCALE` 环境变量解析
- 覆盖所有错误消息、CLI 输出、MCP 服务器日志、审阅策略标签、工作区审计

#### Templates

```text
templates/
├── stream.json               ← 极简流式（中文，默认）
├── stream.en-US.json         ← 英文 overlay
├── balanced.json             ← 平衡型
├── balanced.en-US.json
├── research.json             ← 研究型
├── research.en-US.json
├── periodic.json             ← 周期型
├── periodic.en-US.json
└── ...
```

- `loadTemplate(engineRoot, id, { locale })` 合并 base + overlay
- 覆盖 name / description / 类别名 / connectorHints / memory.profileFile
- 结构字段（role / required / specialBehavior 等）不被 overlay 覆盖

#### Skills

- 纯 Markdown 文档（AI agent 指令），**双语设计**（中文主体 + 英文触发词）
- 无程序化 i18n；`topmind-pack.json` 已有 `locales.overlay_mechanism` 字段供未来扩展

#### 开发者指南

| 场景 | 做法 |
|------|------|
| Desktop 组件新增文案 | 在对应 namespace JSON 添加 key → 组件用 `const { t } = useTranslation("ns")` → `t("key")` |
| Desktop 非 React 文件 | `import i18n from "../locales"` → `i18n.t("ns:key")` |
| Desktop 主进程新增文案 | 在 `electron-i18n.mjs` 的 `STRINGS` 对象添加 key → `t("key", { var: val })` |
| Extension 新增文案 | 在 `_locales/{zh_CN,en_US}/messages.json` 添加 key → JS 用 `t("key")`，HTML 用 `data-i18n="key"` |
| UTR 新增文案 | 在 `i18n-strings.mjs` 的 `STRINGS` 对象添加 key → `t("key", { var: val })` |
| Template 新增语言 | 在 `templates/` 添加 `{id}.{locale}.json` overlay 文件 |
| 新增 locale | Desktop: 加 `src/locales/{locale}/` + 更新 `locale-resolver.ts`；Extension: 加 `_locales/{locale}/messages.json`；UTR: 在 `STRINGS` 加 locale key |

## 工具层（从 v3 移植，已清理）

- `electron/lib/writeback.mjs` — 备份链 + 结构化日志（打包后额外写入 `logs/main.log`）
- `electron/lib/path-model.mjs` — 工作区路径解析
- `electron/lib/workspace-home.mjs` — Desktop 状态路径
- `electron/lib/engine-root.mjs` — 开发 monorepo vs 打包 `resources/topmind-engine`
- `electron/lib/template-api.mjs` — 模板列表 / connector 类别（**禁止** monorepo `../../lib` 静态导入）
- `electron/lib/fs-utils.mjs` — fs 辅助
- `electron/lib/path-safety.mjs` — 路径遍历防护
- `electron/lib/frontmatter.mjs` — YAML frontmatter
- `electron/lib/x-normalize.mjs` — X 推文 payload 归一化（纯函数，可单测）
- `electron/lib/settings-core.mjs` — 设置纯逻辑（defaults / normalize / merge / secret policy；无 fs）
- `electron/settings.mjs` — 原子 load/save/update + safeStorage 持久化壳（写队列 re-read 合并）
- `electron/lib/suggestion-gate.mjs` — high-impact 建议确认门（纯函数）
- `electron/lib/external-plugins.mjs` · `plugin-install.mjs` — 第三方插件发现/安装
- `src/plugins/connector.ts` — connector 共享 activate（settings 始终 / 交互条件）
- `src/plugins/permissions.ts` — 外部插件 RPC/槽位门控
- `src/lib/local-events.ts` — 渲染层本地事件总线类型真源（`LocalEventMap`；`emitLocal`/`onLocal` 双侧类型检查，新事件先登记）

## 打包与启动

```text
pack:prepare → resources/topmind-engine/{templates,lib,skills}
electron-builder-ci → asar(dist + electron + prod deps) + extraResources
pack:verify → asar 入口 / zod / engine / monorepo-import 禁令
```

- 主进程入口：`electron/main.mjs`；渲染：`dist/index.html`（`base: './'`）
- 打包后引擎：`process.resourcesPath/topmind-engine`（不是 monorepo 相对路径）
- 完整性脚本：`scripts/verify-pack.mjs`；文档：`../docs/PACKAGING.md`

---

版本真源：`package.json`。
