# AGENTS.md — topmind

topmind 是父工作区下的项目工作区，不是 agent 的个人 home workspace。

> 本文档是 **Agent 行为规范唯一真源**。`CLAUDE.md` 仅为 Claude Code 兼容薄壳。

## Quality Discipline

改 / 删 / 重构前跑质量门；fail 必须当场修。

```bash
# Desktop 完整质量门（deps → typecheck → electron → dead-code → test → build → pack:verify）
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
topmind = Portable Skills  ⊕  Optional Desktop  ⊕  Optional UTR
```

**北极星**：最低摩擦个人动态流（`docs/ARCHITECTURE-RESET.md`）。  
三者**只共享内容约定与行为契约**，无强制运行时绑定。边界：`PRODUCT-BOUNDARIES.md`。

核心工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`。  
用户概念 ≤5：`记一下 · 动态 · 专题 · 我的情况 · 写出来`。

### 三平面目录模型
- **内容平面**：`{NN-名称}/`（00-收件箱、10-动态、20-专题、88-输出、99-归档…）
- **语义平面**：`memory/`（profile / periodic / topics）
- **系统平面**：`topmind.yaml` + `.topmind/`（index/loop/logs，可删可重建）

### Kernel 八引擎（唯一领域逻辑）

contract · workspace-model · stream · memory · lifecycle · **writeback（唯一写闸）** · derived · ingest。

> **workspace-model 拆分（2026-08）**：`lib/workspace-model.mjs` 为稳定门面（导入面不变），实现拆到 `model-core / model-topic / model-stream / model-memory`；外部只 import 门面。见 ADR `docs/adr/2026-08-02-workspace-model-split.md`。  
> **AI provider 注入**：derived/suggest 支持 per-call `aiProvider` + `createKernelContext(…)` 工厂（多工作区安全）；`setAiProvider` 单例仍兼容。见 ADR `docs/adr/2026-08-02-kernel-ai-provider-context.md`。

> **todo-engine**：个人待办清单引擎（`memory/todo.md` 解析/写入/AI 提取），经 writeback-engine 写入，已纳入 Kernel 扩展。  
> **ai-operation-engine**：统一 AI 操作注册框架（`lib/ai-operation-engine.mjs`），自注册 `todo_maintain` · `memory_organize`（profile + periodic）· `topic_classify`（内容大类专题，非 memory），支持 force 重处理、状态追踪（`.topmind/ai-ops.json` 系统平面）、可扩展注册。  
> **activity-window**：`lib/activity-window.mjs` — 建议/待办/AI ops 共用「近期活动窗口」（周期本 ∪ mtime ∪ 增补 parent）。

**诚实状态**：引擎在 `lib/`；Desktop / UTR / AI 耐久 `.md` **主写经 writeback-engine**；Memory · 建议条 · 待确认写入 · 待办 · AI 操作框架 · 活动窗口 · 动态条目增补 · 剪藏图片本地化 · i18n 门禁 **Done**。备份：用户保存可跳过、AI 旋转备份（`BACKUP_KEEP=3`）、`permanent` 彻底删除。仍 **Intentional Partial**：`edit` skipBackup（减噪）、contract 未强制全 Surface UI。embedding / 全库 Ask 等见 Reset Non-goal。

默认模板 4 种：`stream`（默认）· `balanced` · `research` · `periodic`。

### Desktop（富工作台）

- 1 RPC：`invoke` + `subscribe`  
- Stores：ViewStore · AiStore · ActionStore · PluginStore · IngestStagingStore · TaskStore · TodoStore（实现以代码为准）
- Shell：stream-first 导航 + 深度编辑 + AI 副驾 + 待办弹层（见 `topmind-desktop/DESIGN.md`）
- Service：Workspace / Ai / System / Tool / Ingest；可选 Weread / X  
- **不硬依赖 UTR**：AI 工具 → WorkspaceService → Kernel writeback  
- 主动 AI：**建议默认可生成 · 确认后执行 · 可选手动**（Reset D Done）  
- 捕获：⌘N / 全局⌘⇧N · 默认周期本 · ingest 队列  

详见 `topmind-desktop/{README,ARCHITECTURE,DESIGN}.md` · `docs/ARCHITECTURE-RESET.md`。

### 版本层

版本数字**只**写在下列真源；文档只链路径。查看：`npm run versions`。

| 层 | 真源 |
|----|------|
| Skills Pack | `skills/topmind-pack.json` |
| Desktop | `topmind-desktop/package.json` |
| Clip Extension | `browser-extension/manifest.json` |
| UTR（可选） | `utr/VERSION` |

---

## Read First

1. `README.md`（**中文默认**）· `README.en.md`（English）  
2. `docs/ARCHITECTURE-RESET.md` — **决策锁 · Target/Done · 实施阶段**  
3. `PRODUCT-BOUNDARIES.md` — 三体边界  
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
MCP 默认 **17**；注册表 **25**（8 域 / 25 命令）。见 `TOOLS.md`。  
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

Root scripts from repo root:

```bash
npm run validate              # secrets + docs + tests + desktop validate
npm run versions              # print surface versions from truth sources only
npm run secrets:scan
npm test
npm run skills:test
npm run utr:test
npm run utr:doctor
npm run utr:doctor:engine
npm run utr:list
npm run desktop:dev
npm run desktop:validate
npm run desktop:quality
npm run pack:skills           # dist/topmind-skills-<ver>.*
npm run skills:install        # add owner/repo or path → host skills (see skills/INSTALL.md)
npm run skills:update         # re-install from dest receipt
npm run skills:list           # preview pack entries without writing
npm run pack:extension        # dist/topmind-clip-extension-<ver>.zip
npm run pack:all              # skills + extension (not Desktop)
npm run desktop:pack:dir      # optional installers: pack:mac / pack:linux / pack:linux:arm64 / pack:win
# Desktop artifacts: topmind-<ver>-<os>-<arch>.{dmg,exe,AppImage,deb}
```

```bash
node utr/bin/topmind-cli.mjs doctor --json --mcp
node utr/bin/topmind-cli.mjs tool list
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
├── memory/              # 语义平面：profile/periodic/topics
├── .topmind/            # 机器态：index/loop/logs
├── 00-收件箱/
├── 10-动态/ … 60-参考资料/
├── 88-输出/             # 扁平 YYYY-MM-DD-描述.ext
├── 99-归档/             # backups / trash / receipts
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
