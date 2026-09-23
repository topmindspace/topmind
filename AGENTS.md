# AGENTS.md — topmind

topmind 是父工作区下的项目工作区，不是 agent 的个人 home workspace。

> 本文档是 **Agent 行为规范唯一真源**。`CLAUDE.md` 仅为 Claude Code 兼容薄壳。

## Quality Discipline

改 / 删 / 重构前跑质量门；fail 必须当场修。

```bash
# Desktop 完整质量门（deps → typecheck → electron → undeclared → dead-code → i18n → test → build → pack:verify）
npm run desktop:quality
# 或
npm run --prefix topmind-desktop check:quality

# 快速 dead-code
npm run --prefix topmind-desktop check:dead-code

# 未声明标识符（ESM 严格模式下即 ReferenceError）
npm run --prefix topmind-desktop check:undeclared

# 打包完整性（asar / engine / 禁止 monorepo ../../lib 导入）
npm run --prefix topmind-desktop pack:verify
```

**质量门（顺序执行，前一关 fail 即停）**：

1. `deps:packaging` — AI peer（zod）声明  
2. `typecheck` — IPC payload + store + props 类型一致  
3. `check:electron` — 全部 `.mjs` / `.cjs` 语法  
4. `check:undeclared` — 真实 scope 分析：赋值/自增的裸标识符必须有声明（`.mjs` 无类型检查，只能靠这一关）  
5. `check:dead-code` — `scripts/check-dead-code.mjs` 输出 0  
6. `check:i18n` — zh-CN / en-US locale 键严格对齐  
7. `test` — Desktop 为 `tsx --test --test-force-exit`（Windows 必需，防 tsx 不退出挂起）；root / skills / utr 为 `node --test`  
8. `build` + `build:report` — `vite build`  
9. `pack:prepare` — stage engine resources（Obsidian dist / Clip stamp 对齐）  
10. `pack:verify` — 源码 monorepo 导入禁令 + 已有 release/asar 完整性  

新增 dead pattern：编辑 `topmind-desktop/scripts/check-dead-code.mjs` 的 `DEAD_PATTERNS`（`id` / `description` / `regex` / `scope` / `allowIn`）。

### UI 配色纪律（改 token / 组件颜色前必读）

配色事故的特点是**不报错**：Tailwind v4 对未定义的 `--color-*` 一条规则都不输出，元素保留继承色——界面只是「悄悄变错」。角标隐形、链接字不够黑，都不会让任何一关变红。

- **真源**：`topmind-desktop/src/styles/tokens.css`。改色改 token，不在组件里硬编码 hex。
- **禁止**写未定义的语义工具类（`bg-skill-loop` / `text-accent` 那类**幽灵引用**）。全量扫描已固化为测试。
- **禁止**在语义色文字上加透明度修饰符（`text-accent-color/70`）——停止位已按 AA 调好，`/70` 会把它拉回 3.3:1。要更弱的语气请用 `text-text-tertiary`。
- **禁止**用透明度表达严重度梯度；用 token 阶梯（`text-text-tertiary → text-warning → text-error`）。
- 状态色通常坐在**自己的 `-bg` 淡底**上，故核算对比度必须按「字 @ 自身淡底 @ 最苛刻表面」，只算白底会漏（深色 error 就是这么漏掉的）。
- 新增 / 移动 token 后，**同一次改动**里更新 `tests/ui-token-compliance.test.mjs` 断言与 `DESIGN.md` §5.0.1 基线表。

```bash
# 三条守护：幽灵引用 / 零引用 token / 语义色透明度
cd topmind-desktop && node --test --test-force-exit tests/ui-token-compliance.test.mjs
```

工具：技能 `ui-color-token-audit`（`scan-tokens.py` 双向审计 · `contrast.py` 对比度批量核验，支持 alpha 叠加与三段 `fg=bg=surface`）。

### 跨平台文案纪律（写快捷键 / 平台文案前必读）

和配色一样，**平台适配写错了不会报错，只会对一半用户说错话**：macOS 用户看到 `Ctrl+Shift+I`、Windows 用户看到 `⌘⇧I`，构建与测试全绿。

- **chord 只声明一次，用 macOS 规范字形**（`⌘⇧I`）。显示时一律过 `src/lib/chord.ts` 的 `formatChord()`：① 标记里的字面量；② i18next `chord` 后处理器（`src/locales/index.ts`）——**所有译文里的 `⌘` 都会被自动改写，所以语言包只写规范形，不写 `Ctrl`**；③ 菜单 accelerator 走 Electron 自己的 `CmdOrCtrl`。
- **禁止**在渲染层硬编码 `⌘` / `⌥` / `⇧` 到面向用户的文案里（`<kbd>`、tooltip、设置项、toast 都算）。裸渲染 `WORKBENCH_SHORTCUTS[].display` 属于同一类错误——那个字段是规范形，不是显示形。
- **OS 窗口外壳**真源 `electron/lib/window-shell.mjs`；**原生菜单模板**真源 `electron/lib/menu-spec.mjs`（纯函数）。新增平台差异改这两个文件，不在组件里分支。
- **`role` 项自带 accelerator 且会真注册**：加 role 前先与 `WORKBENCH_SHORTCUTS` 交叉查重（`toggleDevTools` 曾与 Inbox 撞 `Ctrl+Shift+I`）。非 mac 用 `registerAccelerator: false` 只显示不注册。
- **对话框按钮顺序**：DOM 恒为「取消在前」；Windows 只在 CSS 里 `flex-direction: row-reverse` 翻转（`html[data-platform="win"] [data-dialog-footer]`）。**不得**为平台改 DOM 顺序——Tab 序与「危险对话框 Enter 落在取消」的保证都挂在 DOM 序上。

```bash
# 三条守护：渲染层 chord 硬编码 / 菜单 accelerator 撞键 / 平台分支真源
cd topmind-desktop && node --test --test-force-exit tests/chord-format.test.mjs tests/app-menu.test.mjs tests/window-shell.test.mjs
```

### AI 契约纪律（改提示词 / 工具 / 语言解析前必读）

- **工具名唯一真源** `electron/lib/ai-tool-names.mjs`。提示词（`ai-prompts.mjs`）与注册表（`ai-tools.mjs`）由 `tests/ai-tools-inventory.test.mjs` 双向断言（双语对称）——提示词里写一个没注册的工具名，AI 会稳定地调用一个不存在的工具。
- **输出语言必须显式传**：`buildSystemPrompt` 的生产调用点必须给 `locale` + `outputLocale`；`tests/ai-locale-prompts.test.mjs` 锁死这一点，缺参数时 AI 会退回模型默认语言（通常是英文）。
- **输出语言解析**：`lib/ai-output-locale.mjs`。`auto` **不算**已定语言；规则见下方 «AI 输出语言»。

```bash
cd topmind-desktop && node --test --test-force-exit tests/ai-tools-inventory.test.mjs tests/ai-locale-prompts.test.mjs
```

### 启动完整性纪律（改 Electron 主进程 / 仓库脚本前必读）

**绿构建不等于能启动。** 主进程 `.mjs` 无类型检查；未声明赋值只在运行时 `ReferenceError`。

- **`.mjs` 没有任何类型检查**：`tsc --noEmit` 不读它。`check:undeclared` 做真 scope 分析。
- **禁止用文本断言代替执行**：行为断言必须 `import` 真模块并调用它。
- **主进程有 boot 冒烟**：`tests/electron-module-load.test.mjs` 在 stub Electron 下加载全部模块并排空 `whenReady`。
- **boot 失败不是异常**：`showBootError` 只记日志 + 弹原生错误框；冒烟断言的是 `showErrorBox` 调用，不是退出码。
- **stub 必须写成真模块**（`tests/helpers/electron-stub.mjs`）。
- **`scripts/` 也在扫描范围内**：无法解析会报成扫描空洞。

```bash
cd topmind-desktop && npm run check:undeclared
cd topmind-desktop && node --test --test-force-exit tests/electron-module-load.test.mjs
# 真实启动冒烟（沙箱里必须摘掉该变量，否则跑的是纯 Node）
cd topmind-desktop && env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron .
```

细节：ADR `docs/adr/2026-09-15-boot-integrity-and-undeclared-identifiers.md`。

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
用户概念 ≤5：`记一下 · 动态 · 专题 · 我的情况 · 交付`。

### 三平面目录模型
- **内容平面**：`{NN-名称}/`（00-Inbox、10-动态、20-专题、88-交付、99-归档…）
- **语义平面**：`memory/`（profile / periodic / topics；卫星 `todo.md` · 可选 `ledgers/`）
- **系统平面**：`topmind.yaml` + `.topmind/`（index/loop/logs，可删可重建）

### Kernel 八引擎（唯一领域逻辑）

contract · workspace-model · stream · memory · lifecycle · **writeback（唯一写闸）** · derived · ingest。

> 文件名映射：`contract-engine.mjs` · `workspace-model.mjs`（门面，实现拆 `model-core/topic/stream/memory`）· `stream-period.mjs` · `memory-engine.mjs` · `lifecycle-engine.mjs` · `writeback-engine.mjs` · `derived-builder.mjs` · `ingest-pipeline.mjs`。

**卫星（非第九引擎）**：`todo-engine`（`memory/todo.md`）· `ledger-engine`（可选 `{memory.dir}/ledgers/`，**不是第九引擎**，也不是第六个用户概念）· `ai-operation-engine`（todo_maintain / memory_organize / topic_classify）· `suggest-engine`（建议生成/应用编排；**不是第九引擎**，写回仍经 writeback）。

### 现行策略（细节见 PROJECT-MODEL / TOOLS / 对应 ADR）

| 主题 | 规则 | 真源 |
|------|------|------|
| 契约 | 根 `topmind.yaml` v4 唯一；`ensureContract` 收敛到 ok；覆盖前备份；`writeContract` 原子写；UI 不 fork 行为键 | ADR 2026-08-23 |
| 写回授权 | **分级 confirm**：内容直接落盘；仅删/归档 pending。`locked`=重要内容可编辑（任务级首写快照）；可恢复删/归档 auto 允许；永久删 locked/core 仅用户 | ADR 2026-09-17b/c · TOOLS.md |
| 围栏 | `isPathInsideWorkspace` 解析 symlink；策略路径名大小写不敏感；契约/system/memory 根不可 lifecycle；媒体仅在写闸提交后 | ADR 2026-09-17 · lib/writeback-engine |
| 备份/回执 | **仅高影响**：locked 覆盖 · 锁定/核心非 permanent delete。普通开放笔记 delete 无 trash。`BACKUP_KEEP=3` · `RECEIPT_KEEP=50` | writeback-engine |
| Memory | 路径经契约；profile 事实 append/retire/update（确认式）；periodic=周期反思；无自动遗忘/向量 | ADR 2026-08-16 · 2026-08-23 |
| Stream / 活动窗口 | `yearDir` 默认 true；周期路径双向粘滞；`archiveStreamYear` → `{system}/stream-archive/{year}/`。活动窗口 **21 天 / 30 文件 / 6 周期**；语料预算 suggest 16K · todo extract 16K · maintain 12K | ADR 2026-08-09 · `lib/activity-window.mjs` |
| AI 语言 | 正文：用户要求→原文→workspace locale；建议/待办：用户要求→宿主 UI 语言→workspace locale | `lib/ai-output-locale.mjs` |
| Agent | 步数默认 32/上限 80；`edit_file` 匹配阶梯 + `expectedHash`；思考折叠 | Desktop ARCHITECTURE |

Intentional Partial：contract 非全 Surface UI。embedding / 全库 Ask：Non-goal / Target 延后（Reset）。

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
| Skills Pack | `topmind-skills` 仓 `topmind-pack.json` | 独立 |
| Desktop | `topmind-desktop/package.json` | 独立 |
| Clip Extension | `browser-extension/manifest.json` | 独立 |
| UTR（可选） | `utr/VERSION` | 跟随 Desktop |
| Obsidian Plugin | `topmind-obsidian` 仓 `manifest.json` | 独立 |

---

## Read First

1. `README.md`（**简体中文 default**）· `README.en.md`（English）  
   各模块 README 同此约定：`README.md` = 简体中文；`README.en.md` = English；`README.zh-CN.md` 为完整中文兼容副本。
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
  ├── 00-Inbox/
  ├── 10-动态/ … 动态类别 …
  ├── 88-交付/
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

## Repository Boundary

三仓按**交付面**划分（详见 `PRODUCT-BOUNDARIES.md` §0 · `docs/REPO-MAINTENANCE.md`）：

| 仓 | 交付物 |
|----|--------|
| **topmind**（本仓） | Desktop · Clip · UTR · Kernel（`lib/`，非独立交付面） |
| **topmind-skills** | Skill Pack · installer · npx/skills.sh |
| **topmind-obsidian** | Obsidian 社区插件（构建时引本仓 `lib/`） |

契约文档只在本仓维护。跨仓共享仅：构建时引用、文档链接+CI 断言、`pack:prepare` 拉姊妹 Release（可降级）。

---

## Skill Boundary

唯一日常入口：`topmind`。包内 7 核心 + 2 可选连接器 + 1 可选记账 + 1 可选公众号 write 子技能（共 11 目录）：

- router：`topmind`  
- action：`capture` · `organize` · `write` · `memory` · `maintain` · `loop`  
- connector（可选）：`weread` · `x`  
- write 子技能（可选）：`wechat`（公众号创作；不是并列前台）
- memory 卫星（可选）：`ledger`（记账；不是并列前台）  

不新增并列前台入口。Desktop Skills Dock：Capture / Organize / Write / Memory / Loop。  
Frontmatter schema：`SKILL-ARCHITECTURE.md`。

---

## Tool Boundary

UTR **可选**。域：`workspace-read` · `workspace-write` · `workspace-transform` · `workspace-maintain` · `contract` · `memory` · `lifecycle` · `derived`（见 `TOOLS.md` / `utr/core/contract-registry.mjs`）。  
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
npm test                      # root + utr + desktop（skills/obsidian 见各姊妹仓）
npm run root:test             # 仅根 tests/*.test.mjs
npm run utr:test
npm run utr:doctor
npm run utr:doctor:engine
npm run utr:list
npm run desktop:dev
npm run desktop:validate
npm run desktop:quality
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
# skills tests: 在 topmind-skills 仓 npm test
node --test utr/tests/unit/foo.test.mjs                                    # utr
cd topmind-desktop && npx tsx --test --test-force-exit tests/foo.test.mjs  # Desktop（Windows 必须 --test-force-exit）
```

---

## Target Architecture

### Skills

`topmind-skills` 独立仓 · 日常入口 `topmind` · `npx skills add topmindspace/topmind-skills`。

### UTR

Contract-first Node 底座；命令面见 `TOOLS.md`。依赖 engine 根 `lib/` + `templates/`。

### Workspace

```text
{workspace-root}/
├── topmind.yaml         # 工作区门面契约
├── memory/              # 语义平面：profile / periodic/{YYYY}/ / topics / todo.md / 可选 ledgers/
├── .topmind/            # 机器态：index/loop/logs
├── 00-Inbox/
├── 10-动态/             # yearDir: true → 10-动态/{YYYY}/2026-W30.md
│   └── {YYYY}/           # 往年可归档到 99-归档/stream-archive/
├── 20-专题/ … 60-参考资料/
├── 88-交付/             # 扁平 YYYY-MM-DD-描述.ext
├── 99-归档/             # backups / stream-archive / trash / receipts
└── .obsidian/           # 可选外部工具

{类别}/{YYYY-主题}/
├── topic.md             # 专题首页
├── *.md
├── images/              # 可选
└── .derived/            # 可选：AI 衍生（摘要/历史）
```

- 交付物只进 `88-交付/`，不在专题内建 `outputs/`  
- 不默认创建 `outline.md` / `setting.md` / `style.md`  
- 笔记在专题根，不建强制 `notes/`  

### Desktop

可选；永非内容真源。

```text
记一下 / Clip Extension → Category / Topic / File → Editor → AI/Save → Receipt/Recovery
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
