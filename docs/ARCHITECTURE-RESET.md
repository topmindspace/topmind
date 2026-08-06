# Architecture Reset — 理想架构与实施计划

> **状态**：Accepted · **日期**：2026-07-25 · **基线**：统一产品戳与主线合闸已交付（见 §2 诚实表）  
> **角色**：架构决策锁 + 分阶段实施计划（唯一实施真源）  
> **取代**：`architecture-refactor-proposal-2026-07.md` · `adr/2026-07-24-implementation-progress.md` · 平行 UIUX 提案  
> **内容/边界真源仍为**：`PROJECT-MODEL.md` · `PRODUCT-BOUNDARIES.md`（本文锁「做什么、做到哪、什么时候」）  
> **产品入口**：根 [`README.md`](../README.md) — 本文是**决策与阶段锁**，不是用户手册。

### 读本文前

| 你要… | 去哪 |
|-------|------|
| 产品是什么 / 怎么装 | [`../README.md`](../README.md) |
| 数据怎么摆 / 6 条规约 | [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) |
| Skills / Desktop / UTR 谁做什么 | [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) |
| 当前 Done vs Non-goal | **下文 §2** |

---

## 0. 产品决策锁（2026-07-25）

| # | 议题 | 决策 |
|---|------|------|
| **A** | 产品北极星 | **最低摩擦个人动态流**：记下来尽可能简单；整理与持续维护由 AI **建议**；找回自然。蒸馏/wiki 是增强，不是默认灵魂。 |
| **B** | Desktop 厚度 | **富工作台（Rich Workbench）**：发挥本地编辑、多视图、插件、捕获与阅读优势。**导航与概念面大幅变薄/变清晰**。架构可扩展，扩展不抢主路径。 |
| **C** | Kernel 合闸 | **激进统一**：Desktop / UTR 领域写路径全部经 writeback-engine；平行语义实现删除或降为薄适配。一次性 migration，不为遗留双轨让路。 |
| **D** | 主动 AI | **默认可生成建议 + 用户确认后再自动执行**；另支持纯手动触发。建议与执行均受 protection / writeback 约束。禁止默认静默改 locked 或未经确认的高影响批写。 |

### 对外一句话

> **记下来尽可能简单；系统默默准备建议；你点头后再沉淀；文件永远是你的。**

### 用户概念硬上限（≤5）

| 用户说 | 含义 | 系统落点 |
|--------|------|----------|
| **记一下** | 存下来 | 当前动态周期本 / 收件箱 / 专题 |
| **动态** | 日常流水 | `role:loose-stream`；默认 weekly 周期本 |
| **专题** | 长期主题夹 | `{大类}/{YYYY-主题}/` |
| **我的情况** | 关于我的稳定信息 | `memory/profile.md` |
| **写出来** | 出成品 | `role:delivery`（常为 88-输出） |

UI **不教**：protection、derived、writeback_mode、schema、engine、UTR 命令名。设置用白话（「保存前问我」「重要文件不让 AI 直接改」）。

工作流（不变）：

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

---

## 1. 目标架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Experience（可砍可换）                                         │
│ Desktop 富工作台 · Skills 口语 · Clip · 建议卡片 · 审阅抽屉     │
└────────────────────────────┬─────────────────────────────────┘
                             │ 只准 Kernel 语义 / 契约求值结果
┌────────────────────────────▼─────────────────────────────────┐
│ Kernel（唯一领域运行时 · engine `lib/`）                        │
│ contract · workspace-model · stream · memory ·                 │
│ writeback（唯一写闸）· lifecycle · ingest · derived            │
│ + 可选 index（检索，非真源）                                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│ Workspace（唯一内容真源 · 三平面）                              │
│ 内容 {NN-名称}/ · 语义 memory/ · 系统 topmind.yaml + .topmind/ │
└──────────────────────────────────────────────────────────────┘
```

**铁律**

1. Surface 不得平行实现业务语义（落点、保护、提升、生命周期）。  
2. **所有写操作**过 writeback-engine：保护判定 →（confirm 审阅）→ 备份 → 原子落盘 → 回执。  
3. AI 产物标记 `ai-derived` 或进 `.derived/`；永不冒充用户原文。  
4. 衍生/索引可删可重建；内容安全层 `99-归档/` 不可当垃圾删。  
5. UTR = Kernel 的 CLI/MCP **adapter**，不是第三套业务实现。  
6. Skills = 契约消费方（纯 Markdown）；代码 Surface 强制执行，Markdown 面靠契约 + loop 兜底。

### Desktop 目标形态（B）

| 维度 | 目标 |
|------|------|
| 定位 | 富工作台：浏览 · 深度编辑 · 捕获 · AI 副驾 · 恢复 · 可扩展插件 |
| 导航 | **变薄**：默认「动态」主表面；收件箱 / 写出来 / 我的情况 / 搜索 / 记一下 清晰可达 |
| 概念 | 只暴露 ≤5 用户概念；树/标签/看板/插件为二级或高级 |
| AI | 内生副驾：默认上下文 = 当前文件 + 本周流 + profile 摘要；**建议条 + 审阅抽屉** |
| 扩展 | 8 插件槽保留；扩展不占主 chrome；connector 外围化 |

详细 IA / 像素：`topmind-desktop/DESIGN.md`。产品原则：根 `DESIGN.md`。

### 主动智能（D）

```text
触发：打开工作区 | 定时轻扫 | 用户点「整理本周」/「AI 分析」| Inbox 积压 | 周期结束
  → lifecycle.scan + promotion 候选 + inbox 路由建议（只生成建议，不静默写）
  → inbox_organize：AI 分析收件箱文件 → 建议移入已有专题或新建专题（确认后安全移动）
  → AI 配置后：LLM 分析**活动窗口**（近期周期 ∪ 近期改动 ∪ 增补锚定原文）→ 提取主题/要点/记忆候选（ai_summary 建议）
  → 建议卡片 / 建议条（可忽略）
  → 用户确认 → 才执行（仍过 writeback + protection）
  → stream_digest apply 时：AI 生成真摘要写入 memory/periodic（非占位符）
  → 用户也可随时手动触发同一管线
```

**AI 能力分层（诚实）：**

| 层 | 是否调 LLM | 说明 |
|----|-----------|------|
| AI 会话（`ai.invoke`） | ✅ 真实 LLM | 流式输出 + 工具调用 + skill-first |
| 行内 AI（`ai.complete`） | ✅ 真实 LLM | 选区改写/润色/格式/续写/总结；`documentText` 对齐整篇 Markdown 结构 |
| 建议条 - 规则部分 | ❌ 确定性 | 文件年龄扫描、profile 检查、正则候选 |
| 建议条 - AI 部分（`ai_summary`） | ✅ 真实 LLM | 分析周期笔记，提取主题/要点/记忆候选 |
| `stream_digest` apply | ✅ 真实 LLM（配置后） | 生成周期摘要写入 memory/periodic |
| `reconcile` 任务 | ❌ 确定性 | 去重/完成检测/候选提取（无 LLM） |
| `ai_digest` 任务 | ✅ 真实 LLM | 后台触发 AI 分析 → 刷新建议条 |
| derived-builder（topic summary / period digest） | ✅ 真实 LLM（配置后） | per-call `aiProvider` 注入（`createKernelContext` 或参数）；`setAiProvider` 单例仍兼容；无 AI 时回退占位 |

设置白话：

- **自动准备建议**（默认开 · 可关）：后台可扫、可生成候选；**不自动落盘高影响变更**  
- **自动 AI 整理待办**（默认**关**）：可选从动态维护 `memory/todo.md`；关则仅手动，避免后台耗 Token  

- **保存前问我**（confirm）：单次写回审阅  
- **手动整理**：始终可用

---

## 2. Target vs Done 诚实清单

状态：**Done** = 代码+产品可用且符合目标 · **Partial** = 有骨架/单路径 · **Target** = 计划中未闭环

### 2.1 已做对（Done — 保持）

| 能力 | 证据 |
|------|------|
| 文件即真源 · POSIX · Markdown | 工作区模型 |
| 三平面目录约定 | PROJECT-MODEL · 模板 |
| 类别自发现 + 数字前缀 | workspace-model |
| stream packing（周期本） | stream-period · capture |
| 写回伦理理念（备份/回执） | 部分路径 + 文档 |
| Skills 纯 Markdown + 三级降级 | skills/ |
| skill-first Desktop agent | ai-prompts · skills-runtime |
| 捕获 / Clip / 文档 ingest 队列 | Desktop + extension |
| 质量门 · pack 纪律 | scripts · CI |
| 拒 coding-agent 内核（Pi） | ADR 2026-07-21 |

### 2.2 Partial → 本目标已推进

| 能力 | 状态（2026-07-25 实施） |
|------|--------------------------|
| Kernel 八引擎文件 | **Done**（`lib/`；workspace-model 已拆 facade + model-core/topic/stream/memory，ADR 2026-08-02） |
| workspace-model / stream | **Done**（Desktop 动态加载） |
| `lib/kernel-api.mjs` + Desktop `electron/lib/kernel-api.mjs` | **Done**（含 `createKernelContext` per-workspace 工厂，ADR 2026-08-02） |
| writeback-engine 唯一写闸 | **Done**（Desktop 耐久 .md：save/edit/fm/delete/saveNote/memory/capture/reconcile/duplicate/rename-body/publish/restore/ingest-commit；UTR create-topic/capture/append-*/save-output/update-topic；AI `actor:"ai"`；memory-engine 全经 executeWrite；todo-engine `syncTodoToStream` 经 executeWrite skipBackup。非 .md 二进制 copy 可仍直写） |
| batch writeback mode | **Done**（UTR executor/MCP 仅 auto\|confirm；显式 `batch`/未知模式 **拒绝**，无 silent batch→auto） |
| Memory 产品入口 | **Done**（侧栏「我的情况」钉 + ensureCoreProfile） |
| 建议条 generate / confirm apply | **Done**（`suggest-engine` + AiPanel `ActionBar` / `ActionStore` + RPC；旧 `SuggestionStrip` 已删除） |
| **AI 驱动建议与摘要** | **Done**（`suggest-engine` 接受 `aiProvider`；`ai_summary` 建议真实调 LLM 分析活动窗口；`stream_digest` apply 用 AI 生成真摘要；**失败/无 AI 诚实不写**（`lib/ai-content-sanitize.mjs` 剥离 thinking/占位）；`promote_memory` 只提真实候选、profile 段内去重；`writePeriodDigest` 同 period 更新不堆叠；`lastAnalyzedHash` 变更检测；Desktop `ai-provider-adapter.mjs` 桥接；UTR `memory.digest` 为确定性 adapter 非产品 AI 路径） |
| 动态主表面 PrimaryNav | **Done**（默认 selection=stream；文案 动态/写出来） |
| confirm 写闸 pending | **Done**（settings 覆盖 gate；AI 写工具仍注册；pending 带 `previewContent` 全量正文入队；append_* / save / edit 均可接受/拒绝） |
| memory-engine 内部 append | **Done**（appendProfile/Topic/digest/promote 源标记均 `executeWrite`） |
| lifecycle 全量产品卡片 | **Done**（scan→建议条；inbox/stale/catch_all 确认后 `executeArchive` 经写闸；`inbox_organize` AI 分析收件箱→移入已有/新建专题，确认后安全移动；非独立归档产品栈） |
| ingest 路由下沉 | **Done**（Desktop commit 经 `resolveIngestRoute`；转换器仍本地） |
| 备份全覆盖 | **Done**（优化策略：用户保存跳过备份；AI 写入旋转备份 `BACKUP_KEEP=3`；删除/归档支持 `permanent` 彻底删除；`editPath` 故意 `skipBackup` 减噪，仍过 protection gate） |
| connector weread/x 笔记写 | **Done**（`kernelDurableWriteAbs`） |
| confirm 审阅条 | **Done**（`pending-writes` 队列 + AiPanel `ActionBar` 统一「待确认写入」接受/拒绝） |
| 设置白话 | **Done**（自动保存 / 保存前问我 / 自动准备建议 / 自动 AI 整理待办默认关） |
| HomeView 组件删除 | **Done**（源文件删除；`kind:home` 已从 Selection 类型移除；`normalizeSelection` 迁移残留） |
| Clip 扩展 buffer 解析 | **Done**（优先 `topmind.yaml` / `00-*`，legacy `.topmind-config.json` 兜底） |
| derived item-history | **Done**（`.derived/item-history.md` 确定性清单；summary/digest 在 AI 配置后用真实 LLM 生成） |
| 关键词搜索截断诚实 | **Done**（notes-index `truncated`/`scannedTotal`；grep/search `truncated`；GlobalSearch UI 提示） |
| contract 求值贯穿 | **Intentional Partial**（写闸 / model / suggest / lifecycle 加载 contract；无第二套 permission；不强制所有 Surface 重写契约 UI） |
| stream reconcile 产品 | **Done**（StreamDetailView + TaskPanel reconcile；非独立 Task 类型栈） |
| **AI 任务类型** | **Done**（`ai_digest` 后台任务：真实 LLM 分析周期笔记 → 建议条刷新 → AI 面板打开） |
| **个人待办清单** | **Done**（`todo-engine` + `TodoPopover` TitleBar 弹层 + `TodoStore`；`memory/todo.md` 语义平面存储；AI 维护（提取+检测完成+更新状态）；截止日期 `📅 YYYY-MM-DD`；pin/unpin 可拖动浮动面板；经 writeback-engine 写入；⌘⇧T 快捷入口；**force 重处理支持**） |
| **统一 AI 操作引擎** | **Done**（`ai-operation-engine.mjs`：`todo_maintain` 启用；`memory_organize` 启用 → **profile + periodic only**（confirm）；`topic_classify` 启用 → **内容大类 `create_topic`**（confirm，不进 `memory/topics`）；状态 `.topmind/ai-ops.json`；force；Desktop RPC + ActionStore `runActivityOps` 合入建议条） |
| **活动窗口 Activity Window** | **Done**（`lib/activity-window.mjs`：近期周期 ∪ mtime 变更 ∪ 增补 parent；suggest / todo / AI ops / stream_digest apply 共用；Desktop 条目增补 + 标题栏 💡 / strip → **`SuggestPopover`** 确认） |

### 2.2.1 非内容写路径清单（允许不经 writeback · 2026-07-25）

| 路径 | 原因 |
|------|------|
| Desktop `settings.mjs` / plugin-install / skills-extra | runtime 状态，非工作区笔记 |
| `ai-service` session JSON | 会话态，非内容真源 |
| `system-service` topmind.yaml seed | 契约门面写（contract 层） |
| `workspace-home` seed yaml | 初始化契约 |
| UTR `writeReceipt` JSON | 机器回执文件 |
| `duplicatePath` 非 .md / `saveBinary` / clip-images | 二进制资源 |
| clipboard.writeText | 剪贴板 |
| Desktop `electron/lib/writeback.mjs` | **仅**日志 + 备份 helper + evidence 形状；**非**第二套 permission/gate（耐久 .md 仍走 Kernel） |
| derived-builder 写 `.derived/` | 可删可重建衍生层；标记 `source_type: ai-derived` |

### 2.3 Target（明确未做 · Phase C/D · embedding 不做）

| 能力 | 说明 |
|------|------|
| 可选本地**语义**索引 / embedding | **Non-goal 本阶段**（`.topmind/index/` 向量库不做） |
| Search **关键词**诚实 + UI 截断提示 | **Done**（§2.2；非 embedding） |
| Ask 自然语言全库问答 | **Target 延后**（无向量；可依赖现有 AI 工具 + 关键词） |

### 2.4 完成度分数卡（诚实 · 2026-07-29 · ship-ready M）

> **2026-08-06 增量**：全量重构 Phase 0–G 完成——workspace-model 拆 4 模块 + facade（ADR 2026-08-02）· `createKernelContext` / `validateAiOutput` 集中化 · connector-bridge · Design System 2.0 · 组件拆分（SelectionAiBar 294 / QuickCapture 210 / SettingsDialog 119 / Shell 229 + hooks 外提）· `src/lib/local-events.ts` 事件类型化 · action-store refresh 单队列 · rpc-bridge `resolveRpcTarget` 校验 · Desktop `wireKernelAiProvider` 删除 · 测试 `--test-force-exit`；全质量门绿（ADR `adr/2026-08-06-phase-d-desktop-hardening.md`）。

| 维度 | 完成度 | 说明 |
|------|--------|------|
| **产品决策锁 A/B/C/D** | **~99%** | 北极星、富工作台、Kernel 合闸、主动 AI 已锁；Non-goals 清晰 |
| **文档体系完整性** | **~99%** | 单一实施真源 = 本文；DESIGN / ARCHITECTURE 与 Wave F–M 实现对齐 |
| **Phase A 合闸** | **~98% Done** | 写闸主路径 Done；备份策略优化（用户保存跳过、AI 旋转备份、permanent 删除）；edit skipBackup 为 **Intentional Partial** |
| **Phase B 记忆/建议/导航** | **~99% Done** | Memory · 建议条 · high-impact gate · confirm 审阅 · PrimaryNav · 设置白话 · AI 轨事件刷新 · **AI 驱动建议与摘要已接入** · **个人待办引擎已接入** |
| **Desktop IA 落地** | **~99%** | 动态默认 / 删 Home / 侧栏 thrift / shared.* / TaskDock / 搜索截断 / 写出来 published + 导出 / **TodoPopover 弹层** **Done** |
| **Desktop UI/UX 深度** | **~99%** | Wave F–M（整理本周闭环 · 建议确认 · 发布打开交付 · 任务假类型清理 · AI Markdown 渲染 · AI 按钮视觉体系 · SelectionAiBar 拖动 · i18n 门禁） |
| **Kernel 八引擎贯穿** | **~98%** | 主写 Done；derived item-history Done + AI provider 接入；备份优化 Done；**todo-engine 扩展已接入**；contract/edit-backup **Intentional Partial** |
| **Phase C 找回（无 embedding）** | **~55%** | 关键词投影诚实 + 搜索分组 UI **Done**；Ask / 语义索引 **Non-goal 本阶段** |
| **Phase D 互操作** | **0%** | 明确未来 |
| **可交付质量门** | **~99%** | `check:quality` + root `validate` + pack:verify；dead-code 含 settings-core / suggestion-gate / todo-strip 护栏；**i18n parity 门禁** |

**总览**：决策与近阶实现（A+B+E+F+G+H+I+J+K+L+M + 关键词 C 子集）**已合闸可交付**。embedding / 全量 Ask / 移动端 / Phase D **明确不做本阶段**。本文后续进度只更新本表与阶段表，不再堆 progress ADR。

### 2.5 Wave E — 合闸后打磨（A/B 后 · C 前 · 2026-07-26 起）

在进 Phase C 语义检索之前，先收口体验与外围膨胀：

| # | 产出 | 验收 |
|---|------|------|
| E1 | PrimaryNav 动态语义（图标/文案无 Home 误读） | **Done** — 动态 = Radio，非 Home 壳 |
| E2 | 设置「自动准备建议」可关；建议条受控 | **Done** — `ai.autoPrepareSuggestions`；关后不自动扫 |
| E2b | 设置「自动 AI 整理待办」默认关 | **Done** — `ai.autoMaintainTodos`；Shell 每会话一次门控 |
| E3 | 侧栏 ViewSwitcher：标签/看板降级「更多」 | **Done** — 主轨 stream/目录/时间 |
| E4 | DESIGN / ARCHITECTURE 残余 legacy 措辞清理 | **Done**（持续） |
| E5 | 文档分数卡与 PRODUCT-BOUNDARIES 诚实表同步 | **Done** |

### 2.6 Wave F — UI/UX 深度（E 后 · 2026-07-26）

| # | 产出 | 验收 |
|---|------|------|
| F0 | 语言与心智对齐（Landing / 写出来 / 空态） | **Done** |
| F1 | 动态主表面：按日分组 · 周期浏览器 · 整理不灌 AI · 角标安静 | **Done** |
| F2 | 记一下：落点 chip · 保存回动态 · progressive disclosure | **Done** |
| F3 | AI 轨消肿 · Pending 展开审阅 · Task 入口 thrift | **Done** |
| F4 | 状态栏白话 · 归档恢复 · 侧栏密度 · 搜索分组 | **Done** |
| F5 | 视觉安静 feed · 测试 · 分数卡 | **Done** |
| F6 | 条目定位 heading · Pending 审阅对话框 · Task 从 AI 轨可达 | **Done** |
| F7 | 侧栏 focusHeading · 定位失败 toast · ⌘K 整理/任务/AI | **Done** |
| F8 | 废弃清理：双 goto.home · 死 locale · StreamDetail 状态机 · DS 眉头 thrift · dead-code 护栏 | **Done** |
| F9 | shared.* 命名空间 · 侧栏安静流 · AI TaskDock + 共享 TaskListBody | **Done** |
| F10 | 审查回合：`workspace:editor` 文案补全 · DESIGN/Reset 诚实对齐 · 编辑器可用性 | **Done** |

### 2.7 Wave G — 可交付硬化（F 后 · 2026-07-26）

| # | 产出 | 验收 |
|---|------|------|
| G0 | AI 轨事件 · high-impact `suggestion-gate` · UI↔settings live sync · TaskDock/store | **Done** — 纯模块 + 真实单测 |
| G1 | settings 纯逻辑外提 `settings-core.mjs`；持久化壳 `settings.mjs` 保持原子写 | **Done** — 密钥 empty-string 不覆盖 |
| G2 | AiPanel 拆 `SuggestionStrip` / `PendingWriteStrip` | **Done** |
| G3 | 写出来 Outputs：`publishedAt` frontmatter 诚实标记 | **Done** |
| G4 | `detectUserWorkspaceRoot` sibling 跳转收窄（禁 /tmp 误命中） | **Done** |
| G5 | dead-code 护栏扩展 · 文档分数卡 · CI 与本地 quality 对齐核实 | **Done** |

### 2.8 Wave H — 工作流闭环（任务 · 建议 · 写出来 · 2026-07-27）

| # | 产出 | 验收 |
|---|------|------|
| H1 | 整理本周全链路：`organize:week` → reconcile 任务 + AI 轨 + 建议刷新 | **Done** — `runOrganizeWeek` |
| H2 | 任务完成后有候选 → 自动开 AI 轨（不自动 apply） | **Done** |
| H3 | 发布后打开交付副本；Outputs 复制正文 / 导出 HTML（仅 88-输出） | **Done** |
| H4 | 清理假任务类型 locale（digest/promote 不进 TaskPanel 假按钮） | **Done** |
| H5 | DESIGN / ARCHITECTURE IA Partial→Done 诚实 | **Done** |

### 2.9 Wave I — 动态内容 + 响应式 Chrome + StatusBar（2026-07-27）

| # | 产出 | 验收 |
|---|------|------|
| I1 | 动态解析：结构节（记录/进行中）内条目不丢；CRLF frontmatter；无周期时回退列表最新本 | **Done** |
| I2 | 响应式操作轨 `ChromeOverflowActions`（优先可见 + ⋯ 溢出，互斥） | **Done** — Stream 头 + 可复用 |
| I3 | TitleBar 主锚文案 ≥900px 显示；窄宽 tooltip/aria | **Done** |
| I4 | StatusBar 可点：路径 reveal、选区跳转、AI 就绪/工作中、后台任务、待办整理（不双标）、准备建议、会话开面板；busy chip 附带 `v4-ai-progress-dot` 脉动指示器 + tooltip 含预期时长 | **Done** |
| I5 | 整理本周按钮走 `runOrganizeWeek` 任务+AI 轨 | **Done** |
| I6 | 编辑器右侧操作 `ChromeOverflowActions`（发布/AI/专注）+ 更多三级菜单 | **Done** |
| I7 | PrimaryNav 文案按窗口宽度显示；侧栏 pin aria + 窄宽 profile 图标 | **Done** |
| I8 | 启动恢复上次工作区：normalize 不再 detect 劫持路径；CLI 优先本路径 probe | **Done** |
| I9 | 最近列表 canonical 去重；禁止 runtime 目录入 recents；Onboarding 健康徽章 + refresh | **Done** |

**Intentional Partial（保留，非未完成）**：`editPath` skipBackup（减噪设计）；contract UI 非全 Surface；embedding / Ask / Phase D = Non-goal。备份策略已优化（Wave L）：用户保存跳过、AI 旋转备份、permanent 删除可选。

### 2.10 Wave J — 防御加固 + 契约清理（2026-07-27）

| # | 产出 | 验收 |
|---|------|------|
| J1 | RPC 返回浅层 shape 校验（dev / 可强制） | **Done** — `rpc-shape` 纯模块 + bridge/`invoke` 接线 + 单测 |
| J2 | AI stream text/reasoning delta ~16ms 合流 | **Done** — `stream-delta-coalesce` + `ai-stream` 接线 + 单测 |
| J3 | UTR `writebackMode: batch` 硬拒绝（无 silent→auto） | **Done** — `utr/core/writeback-mode.mjs` + executor/MCP + 单测 |
| J4 | Desktop 包根误种工作区垃圾清理 + gitignore | **Done** — 删 `{NN-}/`·`memory/`·`topmind.yaml`；`.gitignore` 防护 |
| J5 | 诚实表 / Non-goals 对齐审查报告克制项 | **Done** — 本文 §2.2 / §7；M2 建议原因 = 既有 `summary` |
| J6 | 发布前卫生（v1.1.4） | **Done** — `appId`/`AppUserModelId` 对齐 `com.topmindspace.topmind`；clip UA / deb maintainer 去 topminispace 残留；PACKAGING artifact action 文档对齐 CI |
| J7 | v1.2.0 清洁基线 | **Done** — 行内 AI 结果清洗（思考标签/元话术）；截图全量刷新压缩；依赖补丁升级；GHA actions@v5；文档截图索引同步；仓库历史重写为单提交 + 唯一 tag `v1.2.0` |

### 2.11 Wave K — AI 体验优化 + 建议机制完善（2026-07-28）

| # | 产出 | 验收 |
|---|------|------|
| K1 | 建议条 dismiss 后不重复（session 级记忆） | **Done** — `dismissedIds` Set + `appliedIds` 过滤；手动刷新清除记忆 |
| K2 | 建议刷新节流（3s 内不重复拉取） | **Done** — `lastRefreshAt` 节流；安全轮询 8s→15s |
| K3 | 行内 AI 菜单防干扰（debounce 500ms + 最小选区 2 字符） | **Done** — `SelectionAiBar` debounce 350→500ms；`to - from < 2` 跳过 |
| K4 | 底部对话框简化（移除冗余键盘提示） | **Done** — 移除 footer 键盘提示行；skills 按钮改 icon-only |
| K5 | AI 面板 chrome 视觉层次增强 | **Done** — `v4-ai-chrome` 底部渐变 accent 线 |
| K6 | 思考过程默认折叠（流式时展开，完成后折叠） | **Done** — `ReasoningBlock` `defaultOpen={liveReasoning}` 已有 |

### 2.12 Wave L — 备份策略优化 + AI 建议精准化 + 抓取图片本地化（2026-07-28）

| # | 产出 | 验收 |
|---|------|------|
| L1 | 备份策略优化：用户保存跳过备份；AI 写入旋转备份（`BACKUP_KEEP=3`） | **Done** — `writeback-engine.mjs` `executeWrite` 按 `actor` 区分；`pruneOldBackups` 保留最近 3 份 |
| L2 | 彻底删除选项（`permanent` flag） | **Done** — `executeDelete`/`executeArchive` 支持 `permanent:true`；Desktop 删除对话框复选框；API `del` 传递 `permanent` |
| L3 | AI 建议变更检测（避免重复 LLM 调用） | **Done** — `suggest-engine.mjs` `lastAnalyzedHash` Map；内容 SHA-1 未变则跳过 |
| L4 | `promote_memory` 真实 AI 提取（非占位符） | **Done** — `buildMemoryExtractionPrompt` 提取稳定信息；无 AI 时回退规则提示 |
| L5 | 抓取网页图片本地化 | **Done** — `workspace-inbox-ops.mjs` `localizeImagesForCapture`；capture 时下载远程图片到 `{targetDir}/images/{slug}/` |
| L6 | 任务看板系统验证完整 | **Done** — `KanbanView` 拖拽看板 + `ViewSwitcher` 多视图 + `TaskPanel` AI 任务 + `task-store` 生命周期 + 手动触发 |

### 2.13 Wave M — 个人待办引擎 + AI Markdown 渲染 + UI/UX 深度打磨（2026-07-29）

| # | 产出 | 验收 |
|---|------|------|
| M1 | **个人待办清单引擎**（`todo-engine.mjs`） | **Done** — `memory/todo.md` 语义平面存储；parse/write/add/toggle/update/delete/clearCompleted/health/cleanup；截止日期 `📅 YYYY-MM-DD`；processed_periods + dismissed 防重复提取；经 writeback-engine 写入；完整单测 22 用例 |
| M2 | **TodoPopover 浮动面板** | **Done** — TitleBar 图标 + badge 活跃计数；`⌘⇧T` 快捷键；pin/unpin 可拖动；未 pin 右侧浮层（点击外部/**面板外**滚动/Esc 关闭；**面板内滚动不关** · `scroll-dismiss`）；AI 维护按钮（Sparkles）；内联添加/双击编辑/悬停删除/截止日期 picker；已完成折叠+清除；AI 来源 ✨ 标记；stale/overdue 健康提示 |
| M3 | **AI 消息 Markdown 渲染** | **Done** — `ChatMessage` 结构化渲染：代码块/标题/有序无序列表/引用/段落；`BlockFormatted` + `InlineFormatted` 组合；轻量内联解析器（非 full remark） |
| M4 | **AI 按钮视觉体系** | **Done** — `v4-ai-btn` / `v4-ai-btn-solid` / `v4-ai-btn-ghost` / `v4-ai-btn-gradient` / `v4-ai-chip-gradient`；紫色渐变 AI 身份；`ChromeOverflowActions` 支持 `aiAction` 样式 |
| M5 | **ActionBar 建议 toggle + 图标分类** | **Done** — `toggleAutoPrepare` 持久化到 settings；`SuggestionIcon` 按 kind 分类（inbox/archive/brain/lightbulb/file/clock）；暂停态空态文案 |
| M6 | **SelectionAiBar 拖动 + 智能定位** | **Done** — 用户可拖动面板到任意位置；`dragPos` 覆盖自动定位；智能上下翻转（计算 spaceAbove/spaceBelow）；入场动画 `v4-ai-panel-enter` |
| M7 | **StreamView 集成待办 + 看板入口** | **Done** — AI 维护待办按钮（带活跃计数 badge）；任务看板入口按钮；`ICON_STROKE.chrome` 统一图标粗细 |
| M8 | **Watcher 改进** | **Done** — Windows 自动 polling + `awaitWriteFinish` 稳定写入突发；监听目录 add/unlink 事件；侧栏刷新 450ms→200ms |
| M9 | **i18n 一致性门禁** | **Done** — `check-i18n-parity.mjs` 脚本集成到 `validate` 质量门；zh-CN / en-US 键严格对齐 |
| M10 | **CSS 清理 + 动画体系** | **Done** — 移除废弃 `v4-dash-hero` / `v4-text-link` / `v4-dash-stat`；新增 `v4-ai-progress-slide` / `v4-reasoning-expand` / `v4-todo-popover-enter` |
| M11 | **统一 AI 操作引擎 + force 重处理** | **Done** — 初版 todo_maintain + force；**Wave S\*** 后 `memory_organize` / `topic_classify` **已启用**（confirm；memory=profile+periodic；topic=内容大类） |
| **S\*** | **Stream-first 合闸** | **Done** — activity-window · 条目增补 · 安静建议 chip · organize 跑 activity ops 合入 ActionBar · 文档诚实 · 见 `docs/stream-first-optimization-scheme.md` |

---

## 3. 分阶段实施计划（代码后续执行；本文锁范围）

> **Phase A + B 核心项已于 2026-07-25 代码落地**（见 §2.2）。**Wave E** 见 §2.5。下列表更新验收状态。

### Phase A — 诚实合闸 · 激进

| # | 产出 | 状态 |
|---|------|------|
| A1 | Desktop + UTR 耐久写经 writeback-engine | **Done**（主路径） |
| A2 | `kernel-api` 门面 | **Done** |
| A3 | 无第二套 evaluateWritePermission | **Done** |
| A4 | ingest 路由 Kernel | **Done** |
| A5 | Skills v4 / 无 batch | **Done**（文档+UTR；`batch` 硬拒绝，非兼容映射） |
| A6 | Memory 最小 UI + 建议入口 | **Done** |
| A7 | protection frontmatter 求值 | **Done**（peek + gate） |

### Phase B — 持续记忆闭环

| # | 产出 | 状态 |
|---|------|------|
| B1 | digest / promote 建议 + 确认 | **Done**（建议条；digest/promote apply） |
| B2 | lifecycle → 建议条 | **Done**（scan 驱动） |
| B3 | 动态默认主表面 | **Done**（PrimaryNav + default selection） |
| B4 | confirm 写闸 | **Done**（settings 覆盖 gate + pending 队列 + 审阅条） |
| B5 | 设置白话 | **Done**（自动保存 / 保存前问我 + 建议说明） |

### Wave E — 合闸后打磨（见 §2.5）

| # | 产出 | 状态 |
|---|------|------|
| E1 | PrimaryNav 动态 = Radio 图标 | **Done** |
| E2 | `ai.autoPrepareSuggestions` + 建议条受控 | **Done** |
| E2b | `ai.autoMaintainTodos` 默认关 + 状态栏忙碌 | **Done** |
| E3 | ViewSwitcher 标签/看板 →「更多」 | **Done** |
| E4–E5 | DESIGN / 分数卡 / BOUNDARIES 同步 | **Done**（持续小修） |

### Phase C — 找回与主动完善（embedding **不做**）

| # | 产出 | 状态 |
|---|------|------|
| C1a | 关键词搜索 + 投影截断诚实（notes-index / grep / GlobalSearch） | **Done** |
| C1b | embedding / 语义向量索引 | **Non-goal 本阶段** |
| C1c | Ask 自然语言全库 | **Target 延后**（无向量基础） |
| C2 | 打开工作区轻量 proactive 建议（可关） | **Partial→Done 轻量**（AI 面板 auto-prepare；非强制弹窗） |
| C3 | notes-index 截断/scannedTotal 硬化 + 测试 | **Done** |
| C4 | 插件/连接器严格外围；主 chrome 不膨胀 | **Done**（E3 侧栏 thrift） |

### Phase D — 面向未来

| # | 产出 |
|---|------|
| D1 | 工作区作为标准 Agent 记忆介质（MCP/Skills 互操作文档） |
| D2 | 外部 agent host 一等文档（不内嵌第二 runtime） |
| D3 | 多工作区体验硬化（若有需求） |

---

## 4. Desktop IA / AI 产品目标（摘要）

完整像素与组件：`topmind-desktop/DESIGN.md`。

### 4.1 主 chrome（变薄）

```text
标题栏：动态（默认） · 收件箱 · 写出来 · 搜索 · 记一下 · AI
侧栏默认：本周动态时间线 / 周期本（非完整文件树）
二级：专题树 · 我的情况 · 归档
高级（折叠/⌘K）：标签 · 看板 · 插件 · Tools/UTR
待办：TitleBar 弹层（⌘⇧T · pin/unpin 可拖动）
```

### 4.2 AI 副驾（内生）

- 默认上下文：当前文件 + 本周流摘要 + profile 短摘  
- 顶部 **建议条**：可提升 / Inbox 待整理 / 陈旧专题（确认后执行）  
- 工具结果 → 统一路径回执 Toast + 打开/恢复  
- skill-first 保持；不引入默认 bash agent  

### 4.3 扩展性

- Kernel 动词稳定 → Surface 可换  
- 插件 8 槽保留；新能力先问是否属 Kernel 动词再问 UI 槽  
- 模板 4 Profile 不变；用户扩展类走 contract + FS  

---

## 5. 文档治理（本目标内完成）

| 动作 | 说明 |
|------|------|
| 本文为实施真源 | 后续进度更新本文状态表，不再堆 progress ADR |
| 删除过时提案 | 架构重构提案 · UIUX 提案 · 过时 progress ADR |
| 保留绑定 ADR | 压缩为决策表 + 保留仍生效的 Accepted ADR |
| 真源诚实 | Done / Partial / Target 写入 PRODUCT-BOUNDARIES / ARCHITECTURE / README |
| 用户概念 ≤5 | DESIGN / PROJECT-MODEL 用户词表强制 |

---

## 6. 现行绑定决策表（自 ADR 收敛）

| 决策 | 状态 | 说明 |
|------|------|------|
| Desktop AI = AI SDK + 领域工具，不内嵌 Pi/coding-agent | **Accepted** | 见 `adr/2026-07-21-pi-agent-base-decision.md` |
| skill-first + 捆绑 Skills runtime | **Accepted** | `adr/2026-07-16-desktop-skill-first-agent.md` |
| harness：edit / compact / steer | **Accepted** | `adr/2026-07-16-desktop-agent-harness-upgrade.md` |
| stream packing + memory 语义平面 | **Accepted**（产品面 **Done** · §2.2） | `adr/2026-07-22-stream-packing-and-core-memory.md` |
| Clip Bridge / 扩展 | **Accepted** | `adr/2026-07-13-browser-clip-extension.md` |
| 知识加工管道 | **Accepted**（Kernel 路由 **Done** · 转换器本地） | `adr/2026-07-19-knowledge-ingest-pipeline.md` |
| Desktop 捆绑 UTR 仅 Tools/doctor | **Accepted** | `adr/2026-07-17-desktop-utr-bundle-tools-console.md` |
| 公开更新 / pack 根 | **Accepted** | `adr/2026-07-16-public-update-and-pack-root.md` |
| config v3 WorkspaceModel | **Superseded** | 由 contract v4 + 本文 + PROJECT-MODEL 取代 |
| v4「八引擎全部合闸」过度宣称 | **Superseded / 纠正** | 引擎文件 Done；主写/Memory/建议条/lifecycle 归档卡/备份全覆盖 §2.2 **Done**；仍 Intentional Partial：`edit` skipBackup、contract 非全 Surface UI |

---

## 7. 明确不做（Non-goals · 本重置与近阶）

- 换 Desktop 为薄聊天壳  
- 内嵌通用 coding agent / 默认 shell 工具链  
- 云端独占真源  
- 强制 UTR 才能编辑  
- 把用户数据放进 engine 仓库  
- 本阶段实现语义索引或全量 UI 重写代码（文档锁目标即可）  
- **移动端 / 原生响应式 App**（Desktop 为唯一富工作台）  
- **多用户协作 · 实时云同步**（本地优先；文件系统即协作层）  
- **主进程迁移 TypeScript**（JSDoc + 运行时浅层 RPC shape 校验足够；收益不对等）  
- **GraphQL**（单通道 `invoke`/`subscribe` 已够简洁）  
- **AI 推理 UtilityProcess / worker 拆分**（仅当实测主进程事件循环延迟可证时再评估；当前以 16ms delta 合流背压为防御）  
- **插件沙箱 / 插件市场**（当前 Trusted-by-install + 内置槽位）  
- **embedding / 向量语义搜索 · 全库自然语言 Ask**（关键词诚实 + AI 工具即可）  
- **完整 coach-mark 产品导览**（已有工作区 OnboardingScreen；建议条触发上下文已由 `summary` 承担，不另加 `reason` 字段）  
- **并行「架构提案」文档**（真源仍为本文件 + PRODUCT-BOUNDARIES / PROJECT-MODEL / DESIGN）

---

## 8. 成功判据（产品）

用户两周使用后，不读架构文档也能感到：

1. **记一下**永远顺手  
2. 打开 Desktop = **本周动态 + 建议数 + 一个主 CTA**  
3. **我的情况**找得到；整理后会**问我**是否沉淀  
4. AI 改错了能从 **99-归档** 找回  
5. 文件夹拷走换工具仍可读  

---

## 9. 相关真源

| 文档 | 职责 |
|------|------|
| `PRODUCT-BOUNDARIES.md` | 三体边界 + 能力诚实状态 |
| `PROJECT-MODEL.md` | 三平面 · 规约 · contract |
| `DESIGN.md` | 产品交互原则 · 用户词表 |
| `topmind-desktop/DESIGN.md` | Desktop IA / 像素 / 副驾 |
| `topmind-desktop/ARCHITECTURE.md` | Desktop 实现结构（现状 + Target 标注） |
| `SKILL-ARCHITECTURE.md` · `TOOLS.md` | Skills / UTR |
| `AGENTS.md` | Agent 工作纪律 |
