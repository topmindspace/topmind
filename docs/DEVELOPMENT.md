# 开发与验证

按改动范围读取本页相关小节。产品模型见 `PROJECT-MODEL.md`，开发入口见 `AGENTS.md`。

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
- **禁止**对 `status-*-bg` wash token 再加 `/NN`（`bg-status-error-bg/50`）——wash 本身就是 9% 停止位，二次稀释会让字掉到 AA 下。solid status 作 chip 底也用完整 wash token。
- **禁止** `bg-surface-muted/NN`——软填充用 `bg-surface-wash-15/30/45/65` token（对比度停止位已定）。
- 状态色通常坐在**自己的 `-bg` 淡底**上，故核算对比度必须按「字 @ 自身淡底 @ 最苛刻表面」，只算白底会漏（深色 error 就是这么漏掉的）。
- 新增 / 移动 token 后，**同一次改动**里更新 `tests/ui-token-compliance.test.mjs` 断言与 `DESIGN.md` §5.0.1 基线表。
- **内容字号下限 13px**（`text-xs`）：建议正文 / tool 摘要 / 列表主行 / goal 验收项 / Dialog 描述不得用 `text-3xs`（12px 是 label/badge 档）。
- **图标合同**见 `topmind-desktop/DESIGN.md` §0.0.2：`RiPencilLine` 仅捕获；编辑/重命名用 `RiEditLine`；对话用 `RiChatAiLine`（禁 robot）。
- **hover 用状态层**：交互 hover 填 `hover:bg-state-hover`（禁止 `hover:bg-surface-muted` 换底色）；**软禁用** `softDisabled` 看起来不可用但仍可聚焦。

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

- **工具契约唯一真源**为 Kernel `lib/agent-tool-catalog.mjs`；Desktop 的 `electron/lib/ai-tool-names.mjs` 是 `npm run sync:agent-contract` 生成的纯模块快照。修改真源后同步并运行 `npm run check:agent-contract`。提示词（`ai-prompts.mjs`）与注册表（`ai-tools.mjs`）由 `tests/ai-tools-inventory.test.mjs` 双向核对工具名与双语说明。
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
