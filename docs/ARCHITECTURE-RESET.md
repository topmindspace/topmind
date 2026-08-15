# Architecture Reset — 理想架构与实施计划

> **状态**：Accepted · **日期**：2026-07-25 · **最后更新**：2026-08-15  
> **角色**：架构决策锁 + 实施诚实表（唯一实施真源）  
> **内容/边界真源**：`PROJECT-MODEL.md` · `PRODUCT-BOUNDARIES.md`  
> **产品入口**：根 [`README.md`](../README.md)（English）· [`README.zh-CN.md`](../README.zh-CN.md)（简体中文）

### 读本文前

| 你要… | 去哪 |
|-------|------|
| 产品是什么 / 怎么装 | [`../README.md`](../README.md) · [`../README.zh-CN.md`](../README.zh-CN.md) |
| 数据怎么摆 / 6 条规约 | [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) |
| Skills / Desktop / UTR 谁做什么 | [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) |
| 当前 Done vs Non-goal | **下文 §2** |

---

## 0. 产品决策锁

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

工作流（不变）：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`

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
2. **所有写操作**过 writeback-engine：保护判定 →（confirm 审阅）→（仅高影响）备份 → 原子落盘 →（仅高影响）回执。  
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
  → AI 配置后：LLM 分析活动窗口 → 提取主题/要点/记忆候选（ai_summary 建议）
  → 建议卡片 / 建议条（可忽略）
  → 用户确认 → 才执行（仍过 writeback + protection）
  → stream_digest apply 时：AI 生成周期反思写入 memory/periodic（非占位符）
```

**AI 能力分层（诚实）：**

| 层 | 是否调 LLM | 说明 |
|----|-----------|------|
| AI 会话（`ai.invoke`） | ✅ 真实 LLM | 流式输出 + 工具调用 + skill-first |
| 行内 AI（`ai.complete`） | ✅ 真实 LLM | 选区改写/润色/格式/续写/总结 |
| 建议条 - 规则部分 | ❌ 确定性 | 文件年龄扫描、profile 检查、正则候选 |
| 建议条 - AI 部分（`ai_summary`） | ✅ 真实 LLM | 分析活动窗口语料（21d/6p/30f），注入用户画像+周期反思上下文，识别真正新增/变化 |
| `stream_digest` apply | ✅ 真实 LLM（配置后） | 生成周期反思写入 memory/periodic |
| `reconcile` 任务 | ❌ 确定性 | 去重/完成检测/候选提取（无 LLM） |
| derived-builder | ✅ 真实 LLM（配置后） | per-call `aiProvider` 注入；周期反思含「模式与洞察」维度；无 AI 时回退占位 |
| todo-engine extract | ✅ 真实 LLM（配置后） | 语义级提取（不再关键字过滤），`smartBudgetCorpus` 保留结构完整性 |
| todo-engine maintain | ✅ 真实 LLM（配置后） | 语义级新增/完成/更新，Jaccard 语义去重 |
| ai-operation-engine | ✅ 真实 LLM（配置后） | `memory_organize`/`topic_classify` 注入画像上下文，识别新信息 |

设置白话：**自动准备建议**（默认开） · **自动 AI 整理待办**（默认关） · **保存前问我**（confirm） · **手动整理**（始终可用）

---

## 2. Target vs Done 诚实清单

状态：**Done** = 代码+产品可用且符合目标 · **Partial** = 有骨架/单路径 · **Target** = 计划中未闭环

### 2.1 已做对（Done — 保持）

| 能力 | 证据 |
|------|------|
| 文件即真源 · POSIX · Markdown | 工作区模型 |
| 三平面目录约定 | PROJECT-MODEL · 模板 |
| 类别自发现 + 数字前缀 | workspace-model |
| stream packing（周期本）+ 年目录 + 归档 | stream-period · model-stream · capture |
| 写回伦理理念（备份/回执） | writeback-engine（**仅高影响**备份+回执：locked 覆盖 · 锁定/核心笔记 delete/archive；普通开放笔记无 trash；`BACKUP_KEEP=3` · `RECEIPT_KEEP=50`） |
| Skills 纯 Markdown + 三级降级 | skills/ |
| skill-first Desktop agent | ai-prompts · skills-runtime（AI SDK v7；会话压缩 240K/60；默认模型 gpt-4o-mini / gemini-3.6-flash / claude-sonnet-5 / grok-3-mini） |
| 捕获 / Clip / 文档 ingest 队列 | Desktop + extension（默认 anydoc sidecar；可选 markitdown/pandoc；内置 JS 兜底；升级矩阵见 document-ingest） |
| 质量门 · pack 纪律 | scripts · CI |
| 拒 coding-agent 内核（Pi） | ADR 2026-07-21 |

### 2.2 Partial → 本目标已推进（核心能力 · **Done**）

| 能力 | 状态 |
|------|------|
| Kernel 八引擎文件 | **Done**（`lib/`；workspace-model 拆 facade + model-core/topic/stream/memory） |
| `kernel-api` 门面 + `createKernelContext` | **Done**（per-workspace 工厂） |
| writeback-engine 唯一写闸 | **Done**（Desktop 耐久 .md 全路径；UTR；AI `actor:"ai"`；memory/todo 全经 executeWrite） |
| batch writeback mode | **Done**（仅 auto\|confirm；`batch` 硬拒绝） |
| Memory 产品入口 | **Done**（侧栏「我的情况」钉） |
| 建议条 generate / confirm apply | **Done**（suggest-engine + ActionBar + SuggestPopover） |
| AI 驱动建议与摘要 | **Done**（ai_summary 真实 LLM；失败诚实不写；变更检测；sanitize；per-operation 动态 temperature/systemPrompt/maxTokens；瞬态错误自动重试） |
| 动态主表面 PrimaryNav | **Done**（默认 stream） |
| confirm 写闸 pending | **Done**（settings gate + pending 队列 + 审阅） |
| lifecycle 全量产品卡片 | **Done**（scan→建议；inbox_organize AI 分析→确认移动） |
| 备份/回执（高影响 only） | **Done**（open 常规写/移动/重命名不备份不回执；locked 覆盖 + 锁定/核心 **delete** 有 trash+回执；**archive** 迁入 99-归档 当新家；普通开放笔记 delete 无 trash；`BACKUP_KEEP=3` · `RECEIPT_KEEP=50`） |
| 个人待办清单 | **Done**（todo-engine + TodoPopover + AI 维护 + ⌘⇧T；complete/update 用 `matchTodoMaintainText` 防单 token 误完成） |
| 统一 AI 操作引擎 | **Done**（todo_maintain · memory_organize · topic_classify；force；状态追踪） |
| 活动窗口 Activity Window | **Done**（`lib/activity-window.mjs`；suggest/todo/ai-ops 共用） |
| Todo 上下文 / 跳过 | **Done**（2026-08-08：skip hash = prompt corpus＝周期∪活动 extras；force 清 period+hash；extras 排除 memory/todo；Desktop/Obsidian 仅 Kernel） |
| connector weread/x | **Done**（`kernelDurableWriteAbs`） |
| 关键词搜索截断诚实 | **Done**（notes-index/grep `truncated`；GlobalSearch UI 提示） |
| derived item-history | **Done**（确定性清单 + AI 配置后真实 LLM） |
| contract-engine 清洁化 | **Done**（2026-08-13：`loadContract()` 只读 `topmind.yaml`；v3 JSON 仅 `ensureContract` 一次迁移落盘；`saveWorkspaceConfig` 经 `writeContract`；Desktop 不再 `projectConfigAliases`） |
| Todo 手动 progressive force | **Done**（2026-08-08：`all-periods-processed` 后再点 ✨ → force；auto 仍尊重 skip） |
| 多路 AI 并发策略 | **Done**（2026-08-08：background lane 串行 suggest/todo；agent 独立；soft suggest `agent_busy`；auto-todo 让路；StatusBar multiActive/`AI ×N`） |
| 表面 UX 诚实（Desktop / Obsidian / Clip） | **Done**（2026-08-13：主锚 动态/收件箱/写出来/搜索；Obsidian 用户文案 动态≠工作台、记下≠记一下、整理我的情况；Clip 选项不教第二套 lite 转换器） |
| Stream / 编辑器 / AI 展示诚实 | **Done**（2026-08-13：预览=静态 HTML + 共享阅读偏好；动态多行剥首行 chrome；Obsidian 增补并入卡片并剥 append 注释；AI invoke 不带 view-store writebackMode） |
| 精确中段改稿 / 思考折叠 | **Done**（2026-08-15：Kernel `applyUniqueSpan` + `formatReadWindow`；Desktop `edit_file`/`read_file` 与 Obsidian chat 工具环共用匹配/写闸，不是第九引擎；`<think>` / CoT 折进可展开思考过程） |
| 删除文案诚实 | **Done**（2026-08-15：用户文案跟 `isRecoverableLifecycle`——普通开放笔记删除无 trash；锁定 / 专题首页 / 写出来 才进归档；toast 只在 `backupPath` 时提备份） |

**Intentional Partial（保留，非未完成）**：contract UI 非全 Surface；非 `.md` 二进制可仍直写。

### 2.2.1 非内容写路径清单（允许不经 writeback）

| 路径 | 原因 |
|------|------|
| Desktop `settings.mjs` / plugin-install / skills-extra | runtime 状态 |
| `ai-service` session JSON | 会话态 |
| `system-service` topmind.yaml seed | 契约门面写 |
| UTR `writeReceipt` JSON | 机器回执 |
| `duplicatePath` 非 .md / `saveBinary` / clip-images | 二进制资源 |
| clipboard.writeText | 剪贴板 |
| derived-builder 写 `.derived/` | 可删可重建衍生层 |

### 2.3 已合闸里程碑

所有波次（E–M + S\* + Phase D 硬化 + 引擎硬化 + v2.1 + Stream 年目录/归档/记忆重设计）均已 **Done**。详细决策见各 ADR；产品真理见 `docs/stream-first-optimization-scheme.md`。

### 2.4 完成度分数卡

| 维度 | 完成度 | 说明 |
|------|--------|------|
| **产品决策锁 A/B/C/D** | **~99%** | 北极星、富工作台、Kernel 合闸、主动 AI 已锁 |
| **文档体系完整性** | **~99%** | 单一实施真源 = 本文；DESIGN / ARCHITECTURE 对齐 |
| **Phase A 合闸** | **~98%** | 写闸主路径 Done；高影响 only 备份/回执 Done |
| **Phase B 记忆/建议/导航** | **~99%** | Memory · 建议条 · confirm 审阅 · PrimaryNav · 待办引擎 · **周期反思语义 + 年目录** |
| **Desktop IA / UIUX** | **~99%** | 动态默认 · 侧栏 thrift · 整理闭环 · AI Markdown · i18n 门禁 · 2026-08-07 设计优化 |
| **Kernel 八引擎贯穿** | **~99%** | 主写 Done；todo-engine 扩展；**stream 年目录 + 归档**；**AI 语义深度优化**（关键字过滤→语义预算、画像注入、语料扩容）；contract/edit-backup Intentional Partial |
| **Phase C 找回（无 embedding）** | **~55%** | 关键词投影诚实 + 搜索分组 Done；Ask / 语义索引 Non-goal |
| **Phase D 互操作** | **0%** | 明确未来 |
| **可交付质量门** | **~99%** | check:quality + validate + pack:verify + i18n parity |

### 2.5 Target（明确未做）

| 能力 | 说明 |
|------|------|
| 可选本地**语义**索引 / embedding | **Non-goal 本阶段** |
| Ask 自然语言全库问答 | **Target 延后**（无向量基础） |

---

## 3. Desktop IA / AI 产品目标（摘要）

完整像素与组件：`topmind-desktop/DESIGN.md`。

### 3.1 主 chrome（变薄）

```text
标题栏：动态（默认） · 收件箱 · 写出来 · 搜索 · 记一下 · AI
侧栏默认：本周动态时间线 / 周期本（非完整文件树）
二级：专题树 · 我的情况 · 归档
高级（折叠/⌘K）：标签 · 看板 · 插件 · Tools/UTR
待办：TitleBar 弹层（⌘⇧T · pin/unpin 可拖动）
```

### 3.2 AI 副驾（内生）

- 默认上下文：当前文件 + 本周流摘要 + profile 短摘  
- 顶部 **建议条**：可提升 / Inbox 待整理 / 陈旧专题（确认后执行）  
- 工具结果 → 统一路径回执 Toast + 打开/恢复  
- skill-first 保持；不引入默认 bash agent  

### 3.3 扩展性

- Kernel 动词稳定 → Surface 可换  
- 插件 8 槽保留；新能力先问是否属 Kernel 动词再问 UI 槽  
- 模板 4 Profile 不变；用户扩展类走 contract + FS  

---

## 4. 文档治理

| 动作 | 说明 |
|------|------|
| 本文为实施真源 | 后续进度更新本文状态表，不再堆 progress ADR |
| 删除过时提案 | 架构重构提案 · UIUX 提案 · 过时 progress ADR |
| 保留绑定 ADR | 压缩为决策表 + 保留仍生效的 Accepted ADR |
| 真源诚实 | Done / Partial / Target 写入 PRODUCT-BOUNDARIES / ARCHITECTURE / README |
| 用户概念 ≤5 | DESIGN / PROJECT-MODEL 用户词表强制 |

---

## 5. 现行绑定决策表（自 ADR 收敛）

| 决策 | 状态 | 说明 |
|------|------|------|
| Desktop AI = AI SDK + 领域工具，不内嵌 Pi/coding-agent | **Accepted** | `adr/2026-07-21-pi-agent-base-decision.md` |
| skill-first + 捆绑 Skills runtime | **Accepted** | `adr/2026-07-16-desktop-skill-first-agent.md` |
| harness：edit / compact / steer | **Accepted** | `adr/2026-07-16-desktop-agent-harness-upgrade.md` |
| stream packing + memory 语义平面 | **Accepted**（**Done**） | `adr/2026-07-22-stream-packing-and-core-memory.md` |
| Clip Bridge / 扩展 | **Accepted** | `adr/2026-07-13-browser-clip-extension.md` |
| 知识加工管道 | **Accepted**（**Done**） | `adr/2026-07-19-knowledge-ingest-pipeline.md` |
| Desktop 捆绑 UTR 仅 Tools/doctor | **Accepted** | `adr/2026-07-17-desktop-utr-bundle-tools-console.md` |
| 公开更新 / pack 根 | **Accepted** | `adr/2026-07-16-public-update-and-pack-root.md` |
| Design System 2.0 纸感 | **Superseded** | 2.1 Modern Warm-Neutral 取代 |
| config v3 WorkspaceModel | **Superseded** | 由 contract v4 + 本文 + PROJECT-MODEL 取代 |
| v4「八引擎全部合闸」过度宣称 | **Superseded / 纠正** | 引擎文件 Done；主写/Memory/建议条/高影响备份 §2.2 Done；contract UI = Intentional Partial |

---

## 6. 明确不做（Non-goals）

- 换 Desktop 为薄聊天壳  
- 内嵌通用 coding agent / 默认 shell 工具链  
- 云端独占真源  
- 强制 UTR 才能编辑  
- 把用户数据放进 engine 仓库  
- 本阶段实现语义索引或全量 UI 重写代码  
- **移动端 / 原生响应式 App**（Desktop 为唯一富工作台）  
- **多用户协作 · 实时云同步**（本地优先；文件系统即协作层）  
- **主进程迁移 TypeScript**（JSDoc + 运行时浅层 RPC shape 校验足够）  
- **GraphQL**（单通道 `invoke`/`subscribe` 已够简洁）  
- **AI 推理 UtilityProcess / worker 拆分**（仅当实测主进程事件循环延迟可证时再评估）  
- **插件沙箱 / 插件市场**（当前 Trusted-by-install + 内置槽位）  
- **embedding / 向量语义搜索 · 全库自然语言 Ask**（关键词诚实 + AI 工具即可）  
- **完整 coach-mark 产品导览**（已有 OnboardingScreen）  
- **并行「架构提案」文档**（真源仍为本文件 + PRODUCT-BOUNDARIES / PROJECT-MODEL / DESIGN）

---

## 7. 成功判据（产品）

用户两周使用后，不读架构文档也能感到：

1. **记一下**永远顺手  
2. 打开 Desktop = **本周动态 + 建议数 + 一个主 CTA**  
3. **我的情况**找得到；整理后会**问我**是否沉淀  
4. AI 改错了能从 **99-归档** 找回  
5. 文件夹拷走换工具仍可读  

---

## 8. 相关真源

| 文档 | 职责 |
|------|------|
| `PRODUCT-BOUNDARIES.md` | 四体边界 + 能力诚实状态 |
| `PROJECT-MODEL.md` | 三平面 · 规约 · contract |
| `DESIGN.md` | 产品交互原则 · 用户词表 |
| `topmind-desktop/DESIGN.md` | Desktop IA / 像素 / 副驾 |
| `topmind-desktop/ARCHITECTURE.md` | Desktop 实现结构 |
| `SKILL-ARCHITECTURE.md` · `TOOLS.md` | Skills / UTR |
| `AGENTS.md` | Agent 工作纪律 |
