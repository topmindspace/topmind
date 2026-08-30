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
- **语义平面**：`memory/`（profile / periodic / topics；卫星 `todo.md` · 可选 `ledgers/`）
- **系统平面**：`topmind.yaml` + `.topmind/`（index/loop/logs，可删可重建）

### Kernel 八引擎（唯一领域逻辑）

contract · workspace-model · stream · memory · lifecycle · **writeback（唯一写闸）** · derived · ingest。

> **契约生命周期（全表面共享）**：工作区根 `topmind.yaml` v4 为唯一行为契约。`ensureContract` 缺失创建 / 可修则合并默认重写（**保证收敛到 ok**：null section、缺失版本号一次修复盖章；repair 不覆盖盘上用户模板/locale/name）；任何覆盖坏文件的路径（含 legacy v3 迁移、reseed）**先备份**到 `99-*/backups/contract/`（毫秒+随机后缀防冲突）；`writeContract` tmp+rename 原子写。损坏不可修 → 结构化 `unrepairable` + `reseedContract`（对任何状态强制「备份+全新默认」，不删内容目录）。Desktop 打开 · Obsidian vault init · UTR `contract.ensure`/`reseed`/`doctor` 均走 Kernel；UI 偏好（Desktop `app-settings.json` 等）不 fork workspace 行为键。设置写方一律 partial patch（Desktop `AppSettingsPatch`）。见 ADR `docs/adr/2026-08-23-contract-settings-integrity.md`。

> **workspace-model 拆分（2026-08）**：`lib/workspace-model.mjs` 为稳定门面（导入面不变），实现拆到 `model-core / model-topic / model-stream / model-memory`；外部只 import 门面。见 ADR `docs/adr/2026-08-02-workspace-model-split.md`。  
> **AI provider 注入**：derived/suggest 支持 per-call `aiProvider` + `createKernelContext(…)` 工厂（多工作区安全）；`setAiProvider` 单例仍兼容。见 ADR `docs/adr/2026-08-02-kernel-ai-provider-context.md`。

> **todo-engine**：个人待办清单引擎（`memory/todo.md` 解析/写入/AI 提取），经 writeback-engine 写入。`extractTodosFromStream` · `maintainTodos` 对 budgeted prompt corpus 做 `processedHashes`；`force` 清除扫描周期的 processed + hash。活动 extras 排除 `memory/`。Desktop/Obsidian 只经 Kernel（`force` 透传）。  
> **ledger-engine**：可选记账卫星（`{memory.dir}/ledgers/` + `catalog.md`；默认 Personal/自己）。经 writeback-engine 写入。空工作区不种子 ClassFund/Giggs/Mom。**不是第九引擎，也不是第六个用户概念。** Desktop 仅启用后作为 Apps 菜单 mini-app（看板 / 流水 / 分类 / 快捷记账）。Skills 可选 `topmind-ledger`；日常入口仍只 `topmind`。Obsidian 不发 mini-app。UTR 无独立 ledger 域。  
> **ai-operation-engine**：统一 AI 操作注册框架（`lib/ai-operation-engine.mjs`），自注册 `todo_maintain` · `memory_organize` · `topic_classify`，支持 force 重处理、状态追踪（`.topmind/ai-ops.json`）。  
> **Memory 整合（2026-08-16）**：profile 事实生命周期——`appendProfileEntry`（追加）· `retireProfileEntry`（归档到 `## 历史记录`，加日期前缀，不删内容）· `updateProfileEntry`（原位更新）；`memory_organize` 产出 `retire_profile` 建议条，确认后经 `applySuggestion` 执行。无自动遗忘、无向量索引（ADR `docs/adr/2026-08-16-memory-consolidation.md`）。  
> **activity-window**：`lib/activity-window.mjs` — 建议/待办/AI ops 共用「近期活动窗口」（21 天 / 30 文件 / 6 周期）。语料预算：suggest 16K · todo extract 16K · maintain 12K。`smartBudgetCorpus` 保留 frontmatter/段落结构/首尾上下文。  
> **Desktop 多路 AI**：Agent 流独立 · 后台 prep lane 串行 · soft 建议在 agent streaming 时让路 · StatusBar `multiActive` 诚实展示（见 `topmind-desktop/DESIGN.md` §0.0.3）。  
> **Stream 年目录 + 归档**：`yearDir` 默认 `true`（`{streamDir}/{YYYY}/2026-W30.md`），Desktop 工作区设置可切换（写契约 `stream.year_dir`）。**周期路径粘滞（双向）**：既有平铺周期本（pre-yearDir 旧工作区）继续在原位置追加，不生成年目录孪生；切关 `year_dir` 后生于 `{年}/` 的当前周期同样粘在年目录文件，仅新周期走平铺；periodic 反思同理。`archiveStreamYear` 将完整年份（年目录 + 平铺 `{年}-*` 文件）移到 `{systemDir}/stream-archive/{year}/`（只归档当前年份之前）。legacy v3 迁移成功后 `.topmind-config.json` 改名 `.migrated`（一次性，防过期快照再迁移）。  
> **Memory periodic 语义**：periodic 记忆为「周期反思」（洞察提炼），非事件压缩副本。`memory/periodic/` 按年分组，与 stream 年目录对齐。**Memory 路径单真相**：所有引擎（memory / suggest / ai-operation / todo）与两宿主打开入口的 memory 平面路径一律经契约解析（`memory.dir` + `memory.layers.global.file`），无硬编码 `memory/profile.md` 第二套路径；skip 回执与建议条 `digestPath` 与写入侧同源（含平铺粘滞）。见 ADR `2026-08-23-contract-settings-integrity.md` D12 / D14。  
> **AI 输出语言**：改写打开的笔记 / Agent 写入正文：用户本轮明确要求 → 原文 → 工作区 locale。**建议条 · AI 待办 · memory_organize / topic_classify**：用户本轮明确要求 → **当前宿主 UI 语言**（Desktop `settings.ui.locale`，或 Obsidian `localeOverride` / 应用语言；`auto` 不算）→ 工作区 locale。Desktop 与 Obsidian 是交替宿主，不叠成一条链。解析：`lib/ai-output-locale.mjs`。  
> **工作区围栏**：写/移/删/归档不得落到当前工作区根之外（`isPathInsideWorkspace`）。区外本地读须 `evaluateOutsideRead` 显式授权；`fetch_url` 仅 http(s)，不读 `file://`。  
> **类别按角色发现**：buffer/stream/delivery/system 用现场契约与 `{NN-…}` 目录，不用写死 `00-收件箱` / `99-归档`。英文或用户改名（`00-Inbox` · `99-Archive`）仍按 role 跳过/归档。  
> **Obsidian AI Key 双层保护**：`saveSettings()` 同时备份密钥到 `.topmind/ai-keys-backup.json`；`loadSettings()` 缺密钥时自动恢复。  
> **Companion 下载验证**：`crypto.createHash('sha256')` 流式哈希，零外部依赖；安装失败回退 bundled 版本。  
> **精确中段改稿**：`lib/precise-edit.mjs`（`applyUniqueSpan`）+ `lib/file-window.mjs`（行号窗口 / `heading` / `around`）。Desktop `edit_file`/`read_file` 与 Obsidian chat 工具环共用匹配/拒绝/诊断；写回仍走 `executeWrite`。不是第九引擎。  
> **思考折叠**：`splitAssistantVisible` / ingest 把 `<think>` / 思考围栏 / 未标注 CoT 从正文拆出，不当回复正文。  
> **Agent 步数**：默认 **20**（可配 3–50）。  
> **删除诚实**：普通开放笔记 delete 无 trash；用户文案不得声称「每次删除都进 99-归档」。

**诚实状态**：引擎在 `lib/`；Desktop / UTR / AI 耐久 `.md` **主写经 writeback-engine**；Memory · 建议条 · 待办 · 可选记账（ledger-engine 卫星）· AI 操作框架 · 活动窗口 · 动态增补 · 剪藏图片本地化 · i18n 门禁 · 多路 AI 并发 · Stream 年目录+归档 · UIUX 深度优化 **Done**。备份/回执：**仅高影响**——`locked` 覆盖，以及锁定/核心笔记的非 `permanent` **delete**（trash+回执）。`executeArchive` 把内容迁入现场 **system** 目录当新家（不是备份）。普通开放笔记 **delete** 无 trash；create/update/move/rename/连接器同步不备份不写回执；`permanent` 彻底删除；产物旋转（`BACKUP_KEEP=3` · `RECEIPT_KEEP=50`）；Desktop 支持日志 `logs/main.log` 大小上限轮转（默认单文件 2 MB × 保留 3 份归档，`topmind_LOG_MAX_BYTES` / `topmind_LOG_KEEP` 可调，见 ADR `docs/adr/2026-08-27-desktop-log-rotation.md`）。AI Provider：per-operation 动态 temperature/systemPrompt/maxTokens + 瞬态错误重试；会话压缩 240K/60。仍 **Intentional Partial**：contract 未强制全 Surface UI。embedding / 全库 Ask 等见 Reset Non-goal。

默认模板 4 种：`stream`（默认）· `balanced` · `research` · `periodic`。

### Desktop（富工作台）

- 1 RPC：`invoke` + `subscribe`  
- Stores：ViewStore · AiStore · ActionStore · PluginStore · IngestStagingStore · TaskStore · TodoStore（实现以代码为准）
- Shell：stream-first 导航 + 深度编辑 + AI 副驾 + 待办弹层 + 我的情况记忆浏览（见 `topmind-desktop/DESIGN.md`）
- Service：Workspace / Ai / System / Tool / Ingest；可选 Weread / X  
- **不硬依赖 UTR**：AI 工具 → WorkspaceService → Kernel writeback  
- 主动 AI：**建议默认可生成 · 确认后执行 · 可选手动**（Reset D Done）  
- 多路 AI：Agent 独立 · prep lane 串行 · StatusBar 多任务诚实（§0.0.3）  
- 捕获：⌘N / 全局⌘⇧N · 默认周期本 · ingest 队列 · 词汇 **记一下/Note it** · **记下/Log it**

详见 `topmind-desktop/{README,ARCHITECTURE,DESIGN}.md` · `docs/ARCHITECTURE-RESET.md`。

### 版本层

版本数字**只**写在下列真源；文档只链路径。查看：`npm run versions`。

**独立版本策略（v2.1+）**：各表面有独立版本号，不必完全一致。规则：
1. **大版本对齐**：所有表面共享同一大版本号（如 3.x）；breaking change 全体 bump。
2. **小版本独立**：每个表面只在自己有改动时 bump minor/patch；无改动不 bump。
3. **UTR 跟随 Desktop**：UTR 版本与 Desktop 完全一致（同一安装包分发）。
4. **其他表面**（Obsidian Plugin、后续宿主）：各自独立真源和版本号，遵循同一策略。
5. **Tag 命名**：日常只打一个产品 tag `v*`（号跟 Desktop）= **一个** GitHub Release（Latest）。有更新的表面现场打包，未更新的复用上一份 Latest 产物。`{surface}-v*` 仅作单表面热修逃生口，不标 Latest，且不要和 `v*` 一起推。

| 层 | 真源 | 策略 |
|----|------|------|
| Skills Pack | `skills/topmind-pack.json` | 独立 |
| Desktop | `topmind-desktop/package.json` | 独立 |
| Clip Extension | `browser-extension/manifest.json` | 独立 |
| UTR（可选） | `utr/VERSION` | 跟随 Desktop |
| Obsidian Plugin | `obsidian-plugin/manifest.json` | 独立 |

---

## Read First

1. `README.md`（**English default**）· `README.zh-CN.md`（简体中文）  
   各模块 README 同此约定：`README.md` = English；`README.zh-CN.md` = 简体中文。
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
  ├── memory/         # 语义平面（profile/periodic/topics；卫星 todo.md · 可选 ledgers/）
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

唯一日常入口：`topmind`。包内 7 核心 + 2 可选连接器 + 1 可选记账（共 10 目录）：

- router：`topmind`  
- action：`capture` · `organize` · `write` · `memory` · `maintain` · `loop`  
- connector（可选）：`weread` · `x`  
- memory 卫星（可选）：`ledger`（记账；不是并列前台）  

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

详见 `PROJECT-MODEL.md` §3。

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
npm run validate              # secrets + docs + tests + desktop + utr-engine + obsidian
npm run docs:guard            # redesign 契约 / 文档一致性
npm run versions              # print surface versions from truth sources only
npm run secrets:scan
npm test                      # 聚合五套件：root + skills + utr + desktop + obsidian（较重，含 Desktop tsx）
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
├── memory/              # 语义平面：profile / periodic/{YYYY}/ / topics / todo.md / 可选 ledgers/
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
