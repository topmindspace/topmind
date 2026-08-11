# AGENTS.md — topmind

topmind 是父工作区下的项目工作区，不是 agent 的个人 home workspace。

> 本文档是 **Agent 行为规范唯一真源**。`CLAUDE.md` 仅为 Claude Code 兼容薄壳。

## Quality Discipline

改 / 删 / 重构前跑质量门；fail 必须当场修。

```bash
# Desktop 完整质量门（deps → typecheck → electron → dead-code → i18n → test → build → pack:verify）
npm run desktop:quality
# 或
npm run --prefix topmind-desktop check:quality

# 快速 dead-code
npm run --prefix topmind-desktop check:dead-code

# 打包完整性（asar / engine / 禁止 monorepo ../../lib 导入）
npm run --prefix topmind-desktop pack:verify
```

**质量门（顺序执行，前一关 fail 即停）**：

1. `deps:packaging` — AI peer（zod）声明  
2. `typecheck` — IPC payload + store + props 类型一致  
3. `check:electron` — 全部 `.mjs` / `.cjs` 语法  
4. `check:dead-code` — `scripts/check-dead-code.mjs` 输出 0  
5. `check:i18n` — zh-CN / en-US locale 键严格对齐  
6. `test` — Desktop 为 `tsx --test --test-force-exit`（Windows 必需，防 tsx 不退出挂起）；root / skills / utr 为 `node --test`  
7. `build` + `build:report` — `vite build`  
8. `pack:verify` — 源码 monorepo 导入禁令 + 已有 release/asar 完整性  

新增 dead pattern：编辑 `topmind-desktop/scripts/check-dead-code.mjs` 的 `DEAD_PATTERNS`（`id` / `description` / `regex` / `scope` / `allowIn`）。

### 报回前 grep 自检

```bash
rg "async savePath" topmind-desktop/electron/
rg "workspace\.savePath" topmind-desktop/src/
rg "api\.ws\.save\b" topmind-desktop/src/
rg "WritebackEvidence" topmind-desktop/src/
```

四者皆有 hit 且语义对齐 = 链路完整。

---

## Current Truth

```text
topmind = Portable Skills  ⊕  Optional Desktop  ⊕  Optional UTR  ⊕  Optional Obsidian
          （四体核心）        + Optional Clip 剪藏分发面（Desktop 捕获 companion，非独立 Kernel 宿主）
```

**北极星**：最低摩擦个人动态流（`docs/ARCHITECTURE-RESET.md`）。  
四体**只共享内容约定与行为契约**，无强制运行时绑定；Clip 为 companion 分发面。边界：`PRODUCT-BOUNDARIES.md`。

核心工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`。  
用户概念 ≤5：`记一下 · 动态 · 专题 · 我的情况 · 写出来`。

### 三平面目录模型
- **内容平面**：`{NN-名称}/`（00-收件箱、10-动态、20-专题、88-输出、99-归档…）
- **语义平面**：`memory/`（profile / periodic / topics）
- **系统平面**：`topmind.yaml` + `.topmind/`（index/loop/logs，可删可重建）

### Kernel 八引擎（唯一领域逻辑）

contract · workspace-model · stream · memory · lifecycle · **writeback（唯一写闸）** · derived · ingest。

> **契约生命周期（全表面共享）**：工作区根 `topmind.yaml` v4 为唯一行为契约。`ensureContract` 缺失创建 / 可修则合并默认重写；损坏不可修 → 结构化 `unrepairable` + `reseedContract`（先备份坏文件，不删内容目录）。Desktop 打开 · Obsidian vault init · UTR `contract.ensure`/`reseed`/`doctor` 均走 Kernel；UI 偏好（Desktop `app-settings.json` 等）不 fork workspace 行为键。

> **workspace-model 拆分（2026-08）**：`lib/workspace-model.mjs` 为稳定门面（导入面不变），实现拆到 `model-core / model-topic / model-stream / model-memory`；外部只 import 门面。见 ADR `docs/adr/2026-08-02-workspace-model-split.md`。  
> **AI provider 注入**：derived/suggest 支持 per-call `aiProvider` + `createKernelContext(…)` 工厂（多工作区安全）；`setAiProvider` 单例仍兼容。见 ADR `docs/adr/2026-08-02-kernel-ai-provider-context.md`。

> **todo-engine**：个人待办清单引擎（`memory/todo.md` 解析/写入/AI 提取），经 writeback-engine 写入，已纳入 Kernel 扩展。  
> **ai-operation-engine**：统一 AI 操作注册框架（`lib/ai-operation-engine.mjs`），自注册 `todo_maintain` · `memory_organize`（profile + periodic）· `topic_classify`（内容大类专题，非 memory），支持 force 重处理、状态追踪（`.topmind/ai-ops.json` 系统平面）、可扩展注册。  
> **activity-window**：`lib/activity-window.mjs` — 建议/待办/AI ops 共用「近期活动窗口」（周期本 ∪ mtime ∪ 增补 parent）。  
> **todo 上下文 / 跳过语义**：`extractTodosFromStream` · `maintainTodos` 对 **budgeted prompt corpus**（周期正文 ∪ 折叠活动材料；截断时**优先保留 extras**）做 `processedHashes`；非仅周期文件 raw。`force` 清除将扫描周期的 processed + hash。折叠 extras **排除** `memory/`（尤其 `memory/todo.md`）。Desktop/Obsidian 只经 Kernel（`force` 透传），无第二套活动语料加载。  
> **Desktop 多路 AI**：用户主路径 Agent 流独立；后台 prep（建议 · 待办 maintain）走 `ai-background-lane` **串行**；soft 建议在 agent streaming 时 `agent_busy` 让路；`autoMaintainTodos` 等 agent/suggest 空闲；StatusBar `multiActive` / `AI ×N` 诚实展示（见 `topmind-desktop/DESIGN.md` §0.0.3）。  
> **Stream 年目录 + 归档（2026-08-09）**：`yearDir` 默认 `true`——周期本按年分组（`10-动态/2026/2026-W30.md`）；`listStreamPeriods` 双模式兼容（年子目录 + 根平铺）。`listStreamYears` 列出年份目录；`archiveStreamYear` 将完整年份原子移到 `99-归档/stream-archive/{year}/`（只允许归档当前年份之前的年份；归档不影响 `memory/periodic/`）。  
> **Memory periodic 语义转变（2026-08-09）**：periodic 记忆从「周期摘要」（事件压缩副本）转为「周期反思」（关于用户的洞察提炼）——episodic memory（Stream 原始事件）vs semantic memory（Memory 提炼认知）。`memory/periodic/` 也按年分组（`memory/periodic/2026/2026-W30.md`），与 stream 年目录对齐。
> **AI 输出语言跟随 UI（2026-08-09）**：所有 Kernel AI 引擎（suggest · todo · ai-operation · derived）接受 `localeOverride` 参数；Desktop 从 `settings.ui.locale` 解析后 per-call 注入。提示词规则从「保持与输入相同语言」改为「按指定语言输出」。`auto` 模式回退到契约 `locale`，再回退 `zh`。活动窗口扩大：21 天 / 30 文件 / 6 周期；todo maintain 深度 3，extract 深度 2。
> **AI 语义深度优化（2026-08-09）**：① todo-engine 废弃关键字过滤（`extractKeySegments`），改用 `smartBudgetCorpus`——保留 frontmatter/段落结构/首尾上下文，AI 看到完整语义而非关键字匹配行。② 活动窗口参数统一：suggest/ai-operation 从 14d/4p/16f→21d/6p/30f（与 AGENTS.md 规格对齐）。③ 语料预算扩大：suggest 10K→16K、todo extract 8K→12K、todo maintain 5K→8K。④ AI 提示词增强：suggest/ai-operation 注入用户画像（`memory/profile.md`）+ 近期周期反思作为上下文，AI 能识别「真正新的」而非复述已有信息。⑤ derived-builder 周期反思提示词深化——增加「模式与洞察」维度，从事件罗列转为语义分析。
> **Todo 上下文全面对齐（2026-08-10）**：① todo-engine `findRecentPeriodNotes` 参数对齐 suggest-engine——`maxFiles` 18→30、`minContentLength` 20→10；活动 extras 预算 6K→8K。② 语料预算再扩：extract 12K→16K（对齐 suggest）、maintain 8K→12K。③ `MAINTAIN_PERIOD_DEPTH` 3→4。④ 提取/维护提示词增强——明确提醒 AI 参考「相关活动材料」中的隐含行动项。⑤ Desktop TodoPopover 增加「打开待办文件」按钮（FileText icon）。⑥ Obsidian 插件 UI/UX 全面优化——按钮标签 `max-width` 70→120px、底部操作栏 `flex-wrap`、Tab 标签小屏不再隐藏、模型选择更显著、key 配置后提醒选模型、设置变更后 Stream/Sidebar 自动刷新。
> **UIUX 深度优化（2026-08-11）**：① Obsidian stream-workbench 卡片智能展开——短内容（≤200 字 / ≤3 行）默认全显示，仅长内容折叠。② URL 检测可视化提示——工作台输入框检测到纯 URL 时显示蓝色提示条（路由到收件箱），与 QuickCaptureModal 对齐。③ 提交反馈完善——成功/失败 Notice + 按钮 loading 状态（spinner 替代 "..."）。④ 建议确认按钮 spinner——用旋转加载指示器替代纯文本 "..."。⑤ 待办 hover 删除——Sidebar 待办项 hover 显示删除按钮，已完成可一键清理。⑥ Desktop SuggestPopover 空态 CTA——autoPrepare 关闭时空态显示「启用」按钮（Zap icon），非纯文字提示。⑦ Stream append 块视觉增强——hover 背景加深、标题前导圆点装饰。⑧ Desktop 动态视图时间列对齐优化——无时间戳条目用小圆点替代空白，flex 右对齐保持与有时间戳条目一致；sidebar stream rail 同步。⑨ Inbox '+' 按钮修复——点击 inbox 区 '+' 先 select inbox 再开 QuickCapture，确保默认落点为收件箱而非动态。⑩ AI 任务完成 toast 通知——reconcile/ai_digest 完成和失败时 emit toast，StatusBar 不需要常驻完成态。

**诚实状态**：引擎在 `lib/`；Desktop / UTR / AI 耐久 `.md` **主写经 writeback-engine**；Memory · 建议条 · 待确认写入 · 待办 · AI 操作框架 · 活动窗口 · 动态条目增补 · 剪藏图片本地化 · i18n 门禁 · **多路 AI 并发策略** · **Stream 年目录 + 归档 + Memory periodic 反思语义** · **UIUX 深度优化（卡片智能展开 / URL 可视化提示 / spinner loading / 待办 hover 删除 / 空态 CTA）** **Done**。备份/回执：**仅高影响**——`locked` 既有文件覆盖、非 `permanent` 的 delete/archive（trash 副本）；常规 open 文件 AI/user 更新不备份不写回执；`permanent` 彻底删除；高影响产物旋转（`BACKUP_KEEP=3` · `RECEIPT_KEEP=50`）。AI Provider：per-operation 动态 temperature/systemPrompt/maxTokens + 瞬态错误重试；会话压缩 240K/60 适配现代模型。仍 **Intentional Partial**：contract 未强制全 Surface UI。embedding / 全库 Ask 等见 Reset Non-goal。

默认模板 4 种：`stream`（默认）· `balanced` · `research` · `periodic`。

### Desktop（富工作台）

- 1 RPC：`invoke` + `subscribe`  
- Stores：ViewStore · AiStore · ActionStore · PluginStore · IngestStagingStore · TaskStore · TodoStore（实现以代码为准）
- Shell：stream-first 导航 + 深度编辑 + AI 副驾 + 待办弹层（见 `topmind-desktop/DESIGN.md`）
- Service：Workspace / Ai / System / Tool / Ingest；可选 Weread / X  
- **不硬依赖 UTR**：AI 工具 → WorkspaceService → Kernel writeback  
- 主动 AI：**建议默认可生成 · 确认后执行 · 可选手动**（Reset D Done）  
- 多路 AI：Agent 独立 · prep lane 串行 · StatusBar 多任务诚实（§0.0.3）  
- 捕获：⌘N / 全局⌘⇧N · 默认周期本 · ingest 队列 · 词汇 **记一下/Note it** · **记下/Log it**

详见 `topmind-desktop/{README,ARCHITECTURE,DESIGN}.md` · `docs/ARCHITECTURE-RESET.md`。

### 版本层

版本数字**只**写在下列真源；文档只链路径。查看：`npm run versions`。

**独立版本策略（v2.1+）**：各表面有独立版本号，不必完全一致。规则：
1. **大版本对齐**：所有表面共享同一大版本号（如 2.x）；breaking change 全体 bump。
2. **小版本独立**：每个表面只在自己有改动时 bump minor/patch；无改动不 bump。
3. **UTR 跟随 Desktop**：UTR 版本与 Desktop 完全一致（同一安装包分发）。
4. **未来表面**（Obsidian Plugin 等）：预留独立真源和版本号，遵循同一策略。
5. **Tag 命名**：`v*` = 全量发布；`{surface}-v*` = 单表面发布；仅 re-package 版本号实际变化的表面。

| 层 | 真源 | 策略 |
|----|------|------|
| Skills Pack | `skills/topmind-pack.json` | 独立 |
| Desktop | `topmind-desktop/package.json` | 独立 |
| Clip Extension | `browser-extension/manifest.json` | 独立 |
| UTR（可选） | `utr/VERSION` | 跟随 Desktop |
| Obsidian Plugin | `obsidian-plugin/manifest.json` | 独立 |

---

## Read First

1. `README.md`（**中文默认**）· `README.en.md`（English）  
2. `docs/ARCHITECTURE-RESET.md` — **决策锁 · Target/Done · 实施阶段**  
3. `PRODUCT-BOUNDARIES.md` — 四体边界  
4. `PROJECT-MODEL.md` — 内容真源最高优先级  
5. `DESIGN.md` — 产品交互 · 用户概念 ≤5  
6. `SKILL-ARCHITECTURE.md` · `TOOLS.md`  
7. `docs/README.md` — 文档索引 · 存活 ADR  

Desktop：`topmind-desktop/{README,ARCHITECTURE,DESIGN}.md`。

---

## Engine / Data Boundary

```text
topmind/            = engine（skills · UTR · Desktop · templates · lib）
topmind-workspace/  = user data
  ├── topmind.yaml    # 工作区行为契约（门面文件）
  ├── 00-收件箱/
  ├── 10-动态/ … 动态类别 …
  ├── 88-输出/
  ├── 99-归档/        # 内容安全层（backups · backups/trash · receipts）
  ├── memory/         # 语义平面（profile/periodic/topics）
  └── .topmind/       # 机器态（index/loop/logs，可删可重建）
```

- 用户数据不进 engine  
- Desktop runtime state 不是内容真源  
- 新工作默认 `{大类}/{YYYY-主题}/`；单篇可在大类根  
- 专题目录名 = 专题名 = `topic.md` title = frontmatter `topic`  
- 类别自发现：`{NN-Name}/`  
- 类型由物理大类位置表达（frontmatter 用 `category`，不用 `project_type`）  

---

## Skill Boundary

唯一日常入口：`topmind`。包内 9 个模块：

- router：`topmind`  
- action：`capture` · `organize` · `write` · `memory` · `maintain` · `loop`  
- connector（可选）：`weread` · `x`  

不新增并列前台入口。Desktop Skills Dock：Capture / Organize / Write / Memory / Loop。  
Frontmatter schema：`SKILL-ARCHITECTURE.md`。

---

## Tool Boundary

UTR **可选**。域：`workspace-read` · `write` · `transform` · `maintain` · `memory` · `lifecycle` · `contract` · `derived`。  
MCP 默认 **19**；注册表 **28**（8 域 / 28 命令）。见 `TOOLS.md`。  
写回：`writeback_mode: auto | confirm`，受保护级别（open/locked）判定约束。  
Desktop AI 写回走 WorkspaceService，不经 UTR `executeTool`。

---

## 6 条核心规约

详见 `PROJECT-MODEL.md` §2。

1. **大类不重叠**  
2. **专题自然涌现**  
3. **动态类特殊**（默认平铺，强主题才专题化；模板 `specialBehavior: flat-default`）  
4. **定期清理兜底类**（约 30 天）  
5. **参考资料定位明确**  
6. **大类命名稳定**（改名走 migration）  

---

## Commands

Root scripts from repo root（Node `>=20.11`）:

```bash
npm run validate              # secrets + docs + tests + desktop validate
npm run docs:guard            # redesign 契约 / 文档一致性
npm run versions              # print surface versions from truth sources only
npm run secrets:scan
npm test                      # 聚合四套件：root + skills + utr + desktop（较重，含 Desktop tsx）
npm run root:test             # 仅根 tests/*.test.mjs
npm run skills:test
npm run utr:test
npm run utr:doctor
npm run utr:doctor:engine
npm run utr:list
npm run desktop:dev
npm run desktop:validate
npm run desktop:quality
npm run obsidian:dev        # Obsidian plugin dev (esbuild watch)
npm run obsidian:validate  # typecheck + test + build + pack:verify
npm run obsidian:pack      # dist/topmind-obsidian-<ver>.zip
npm run pack:skills           # dist/topmind-skills-<ver>.*
npm run skills:install        # add owner/repo or path → host skills (see skills/INSTALL.md)
npm run skills:update         # re-install from dest receipt
npm run skills:list           # preview pack entries without writing
npm run pack:extension        # dist/topmind-clip-extension-<ver>.zip
npm run pack:all              # skills + extension + obsidian (not Desktop)
npm run desktop:pack:dir      # optional installers: pack:mac / pack:linux / pack:linux:arm64 / pack:win
# Desktop artifacts: topmind-<ver>-<os>-<arch>.{dmg,exe,AppImage,deb}
```

```bash
node utr/bin/topmind-cli.mjs doctor --json --mcp
node utr/bin/topmind-cli.mjs tool list
```

### 单个测试文件

```bash
node --test tests/foo.test.mjs                                             # root
node --test skills/tests/foo.test.mjs                                      # skills
node --test utr/tests/unit/foo.test.mjs                                    # utr
cd topmind-desktop && npx tsx --test --test-force-exit tests/foo.test.mjs  # Desktop（Windows 必须 --test-force-exit）
```

---

## Target Architecture

### Skills

`skills/` · 日常入口 `topmind` · pack 可 `npm run pack` 独立分发。

### UTR

Contract-first Node 底座；命令面见 `TOOLS.md`。依赖 engine 根 `lib/` + `templates/`。

### Workspace

```text
{workspace-root}/
├── topmind.yaml         # 工作区门面契约
├── memory/              # 语义平面：profile / periodic/{YYYY}/ / topics
├── .topmind/            # 机器态：index/loop/logs
├── 00-收件箱/
├── 10-动态/             # yearDir: true → 10-动态/{YYYY}/2026-W30.md
│   └── {YYYY}/           # 往年可归档到 99-归档/stream-archive/
├── 20-专题/ … 60-参考资料/
├── 88-输出/             # 扁平 YYYY-MM-DD-描述.ext
├── 99-归档/             # backups / stream-archive / trash / receipts
└── .obsidian/           # 可选外部工具

{类别}/{YYYY-主题}/
├── topic.md             # 专题首页
├── *.md
├── images/              # 可选
└── .derived/            # 可选：AI 衍生（摘要/历史）
```

- 交付物只进 `88-输出/`，不在专题内建 `outputs/`  
- 不默认创建 `outline.md` / `setting.md` / `style.md`  
- 笔记在专题根，不建强制 `notes/`  

### Desktop

可选；永非内容真源。

```text
Quick Capture / Clip Extension → Category / Topic / File → Editor → AI/Save → Receipt/Recovery
```

网页抓取：扩展页内 Readability → Bridge `content_html` → Desktop `html-to-markdown`（不维护第二套转换器）。

---

## Hard Rules

- 不把用户数据放进 `topmind/`  
- 不让 Desktop runtime 成为内容真源  
- 遵守三平面约定：`topmind.yaml` 根契约、`memory/` 固化目录、`.topmind/` 机器态  
- 遵守 protection 两档保护级别：open / locked  
- 不建平行 truth store  
- 写入必须返回 path receipt + affected-files  
- `auto` / `confirm` 写回语义；危险动作可逆（`99-归档/`）  
- 替换实现后立即删除废弃代码、测试、脚本、文档  
- 不新增全局 `references/` · `sources/` · `library/` 根  
- 不用 `YYYY-类型-项目名`；用 `{类别}/{YYYY-主题}/`  
- 不要求 `project_type` frontmatter  
- 不默认创建 outline/setting/style 锚点、专题内 outputs/notes  
- 代码用 Topic* / Category*，不用 Project*  
- 专题首页必须是 `topic.md`，不能是 `project.md`  
- 类别解析统一走 `workspace-model` 引擎（禁止固定白名单否定用户扩展类）  
- 工作区 ensure 只补 required roles（buffer / delivery / system），不复活用户已删可选类  
- 隐藏类 / 视图开关 / connector 默认写在 `topmind.yaml`；重命名走 `renameCategory`（含 frontmatter）  

## Implementation Order

1. 对齐顶层约定文档  
2. 同步改 skills / UTR / Desktop  
3. 补行为测试  
4. 删废弃物  
5. 跑 `npm run validate`  

## Parent Workspace Reminder

下列属于 parent workspace，不属于 engine：

- persona / 用户画像  
- heartbeat 规则  
- 助手长期记忆  
- 机器级笔记  
