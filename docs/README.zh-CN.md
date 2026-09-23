# topmind 文档全景导览中心

[简体中文](README.md) · [English](README.en.md)

> **根目录入口** [`../README.md`](../README.md)（简体中文） · **English** [`../README.en.md`](../README.en.md)  
> 本目录收录架构设计锁、ADR 决策记录、打包发布规范与全表面导览。  
> 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整` · 写回只经 Kernel `writeback-engine`（唯一写闸）· UTR `8 域 / 28 命令`

**README 约定：** 各模块以 `README.md` 为简体中文主文档（GitHub 默认），`README.en.md` 为英文；`README.zh-CN.md` 仅作兼容跳转。

---

## 按角色快速导航

```text
               ┌──────────────────────────────────────────────┐
               │    topmind 项目全景文档导览 (Doc Map)         │
               └──────────────────────┬───────────────────────┘
                                      │
       ┌──────────────────────────────┼──────────────────────────────┐
       ▼                              ▼                              ▼
   使用者                         架构 / 开发者                   Agent 宿主
   • README.md (产品总览)          • ARCHITECTURE-RESET.md         • SKILL-ARCHITECTURE.md
   • topmind-desktop/README.md     • PROJECT-MODEL.md (模型规约)  • skills/INSTALL.md
   • topmind-obsidian (姊妹仓)      • DESIGN.md (UI/UX 规范)        • TOOLS.md (UTR CLI/MCP)
   • browser-extension/README.md   • PACKAGING.md (打包/CI)
```

---

## 1. 表面与组件专有文档

| 表面 / 模块 | 核心职责 | 英文 README | 中文 README | 架构与设计 |
|-------------|----------|-------------|-------------|------------|
| **Desktop** | 本地富文本工作台 / Electron 应用 | [`topmind-desktop/README.md`](../topmind-desktop/README.md) | [`README.zh-CN`](../topmind-desktop/README.zh-CN.md) | [`ARCHITECTURE`](../topmind-desktop/ARCHITECTURE.md) · [`DESIGN`](../topmind-desktop/DESIGN.md) |
| **Obsidian 插件** | Obsidian Vault 内嵌动态流视图 | [topmind-obsidian](https://github.com/topmindspace/topmind-obsidian) | [README.zh-CN](https://github.com/topmindspace/topmind-obsidian/blob/main/README.zh-CN.md) | [ARCHITECTURE](https://github.com/topmindspace/topmind-obsidian/blob/main/ARCHITECTURE.md) |
| **Skills** | Agent 可移植技能包 | [`skills/README.md`](../skills/README.md) | [`README.zh-CN`](../skills/README.zh-CN.md) | [`SKILL-ARCHITECTURE`](../SKILL-ARCHITECTURE.md) · [`INSTALL`](../skills/INSTALL.md) |
| **剪藏扩展** | 浏览器一键网页正文加工与剪藏 | [`browser-extension/README.md`](../browser-extension/README.md) | [`README.zh-CN`](../browser-extension/README.zh-CN.md) | [`capture-clip-matrix`](./capture-clip-matrix.md) |
| **UTR** | 确定性 CLI / MCP 工具链 | [`utr/README.md`](../utr/README.md) | [`README.zh-CN`](../utr/README.zh-CN.md) | [`TOOLS.md`](../TOOLS.md) |

---

## 2. 架构决策与设计规范

| 规范文档 | 角色与用途 | 关键要点 |
|----------|------------|----------|
| [`ARCHITECTURE-RESET.md`](./ARCHITECTURE-RESET.md) | **架构决策锁与实施诚实表**（唯一实施真源） | 诚实能力表、八引擎规范、全阶段 Done / Non-goal |
| [`PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) | **四体边界** | 定义 Skills / Desktop / UTR / Obsidian 的独立与协同界限 |
| [`PROJECT-MODEL.md`](../PROJECT-MODEL.md) | **内容模型与 6 条规约** | 定义【三平面】目录架构、6 条命名与归档规约 |
| [`DESIGN.md`](../DESIGN.md) | **产品交互设计规范** | 约束用户概念 <= 5，定义"记一下/动态/专题/我的情况/交付" |
| [`SECURITY.md`](../SECURITY.md) | **安全与密钥边界** | 约定 API Key 本地明文存储规范、无遥测声明、网络范围 |
| [`AGENTS.md`](../AGENTS.md) | **Agent 行为纪律真源** | 定义质量门顺序、死代码检测、多表面版本发布策略 |

---

## 3. 打包、构建与产品参考

| 指南文档 | 说明 |
|----------|------|
| [`PACKAGING.md`](./PACKAGING.md) | 打包与发布规范：安装包命名矩阵、GitHub Actions 独立/全量 Release 工作流、Win/Mac/Linux 构建说明 |
| [`images/README.md`](./images/README.md) | 媒体与截图资源索引 |
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first 理想使用态备忘（**非策略真源** — 见 DESIGN / TOOLS / Reset） |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest 能力矩阵 |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | 知识管理方案对比与选型指南 |
| [`UIUX-AUDIT-2026-09-01.md`](./UIUX-AUDIT-2026-09-01.md) | **NON-LIVING** 历史锚点（现行 IA 见 `topmind-desktop/DESIGN.md`） |

---

## 4. 存活架构决策记录

| 编号/日期 | 主题 | 决策摘要 |
|-----------|------|----------|
| [2026-06-14](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI Runtime | 采用 Vercel AI SDK 统一 Desktop 端 AI 驱动 |
| [2026-07-13](./adr/2026-07-13-browser-clip-extension.md) | Browser Clip Extension | Manifest V3 + Readability + content_html 架构 |
| [2026-07-16](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | Agent Harness Upgrade | 支持 edit / compact / steer 辅助会话 |
| [2026-07-16](./adr/2026-07-16-desktop-skill-first-agent.md) | Skill-First Agent | 优先调用 topmind 自带技能 |
| [2026-07-16](./adr/2026-07-16-public-update-and-pack-root.md) | Public Update & Pack | 公共 `latest.json` 免 Token 更新检查与引擎打包 |
| [2026-07-17](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | Desktop UTR Bundle | Desktop 内置 UTR 环境及调试控制台 |
| [2026-07-19](./adr/2026-07-19-knowledge-ingest-pipeline.md) | Ingest Pipeline | 离线知识加工；默认 anydoc sidecar + 可选 markitdown/pandoc + 内置 JS |
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | 不以完整 Pi coding-agent 为内核 | 围栏 / 写闸 / 可移植 Skills 仍有效；**循环选型被 2026-09-07 覆盖**（hybrid `pi-agent-core`） |
| [2026-07-22](./adr/2026-07-22-stream-packing-and-core-memory.md) | Stream & Core Memory | 周期本打包与个人画像记忆闭环 |
| [2026-08-02](./adr/2026-08-02-kernel-ai-provider-context.md) | Kernel AI Context | 支持 per-call `aiProvider` + `createKernelContext` |
| [2026-08-02](./adr/2026-08-02-workspace-model-split.md) | Workspace Model Split | `lib/workspace-model.mjs` 门面化拆分 |
| [2026-08-02](./adr/2026-08-02-connector-bridge.md) | Connector Bridge | 外部数据连接器 Bridge 契约 |
| [2026-08-06](./adr/2026-08-06-phase-d-desktop-hardening.md) | Phase D Hardening | Desktop 硬化、RPC 校验与事件强类型 |
| [2026-08-07](./adr/2026-08-07-desktop-single-entry-dedupe.md) | Single Entry Dedupe | 单入口降噪与全量 UI 提精 |
| [2026-08-07](./adr/2026-08-07-comprehensive-design-optimization.md) | Design Optimization | 综合视觉精炼 (36/24px 纤细 Chrome, 边框与阴影) |
| [2026-08-07](./adr/2026-08-07-engine-hardening-writeback-ai.md) | Engine Hardening | 写回回执轮转、指数退避重试与独立版本策略 |
| [2026-08-07](./adr/2026-08-07-obsidian-plugin-architecture.md) | Obsidian Plugin Architecture | Obsidian 插件集成 esbuild 内联 Kernel 架构 |
| [2026-08-09](./adr/2026-08-09-stream-year-archive-memory-redesign.md) | Stream Year Archive & Memory Redesign | Stream 年目录 + 年归档 + Memory periodic 反思语义重设计 |
| [2026-08-13](./adr/2026-08-13-adversarial-first-principles-review.md) | Adversarial first-principles review | High：单契约写者、AI 写回不覆盖 yaml、删 home、统一 Clip 转换器、搜索进主锚 |
| [2026-08-13](./adr/2026-08-13-surface-ux-review.md) | Surface UX review | High：Obsidian 动态≠工作台、记一下≠记下、整理我的情况；Clip 不教 lite 转换器；Desktop 文档归档不进主锚 |
| [2026-08-13](./adr/2026-08-13-desktop-stream-editor-ai-review.md) | Stream / editor / AI review | High：预览非活 TipTap；动态多行剥 chrome；Obsidian 增补可见且剥注释 |
| [2026-08-16](./adr/2026-08-16-memory-consolidation.md) | Memory Consolidation | 确认式画像事实生命周期：追加 / 归档到历史段 / 原位更新，对齐 mem0 ADD/UPDATE/DELETE |
| [2026-08-23](./adr/2026-08-23-contract-settings-integrity.md) | Contract & Settings Integrity | 契约修复收敛、覆盖前备份、原子写、设置 partial patch、周期路径双向粘滞、Memory/todo 平面契约路径（含 skip 回执与宿主打开入口）、设置关闭冲刷 |
| [2026-08-27](./adr/2026-08-27-desktop-log-rotation.md) | Desktop Log Rotation | 支持日志按大小轮转（`main.log` 2 MB × 3 份归档；过大遗留文件自愈） |
| [2026-09-07](./adr/2026-09-07-pi-engine-and-three-column-reevaluation.md) | Pi engine + three-column | Hybrid `pi-agent-core`（bash 关、围栏 FS）；右列 AI 工作区与画布对等 |
| [2026-09-14](./adr/2026-09-14-product-vocabulary-rename.md) | 产品词汇改名 | 收件箱 / 写出来 / Ship it → Inbox / 交付 / Delivery；默认模板种子改名，存量工作区目录不动 |
| [2026-09-15](./adr/2026-09-15-cross-platform-chrome-and-suggest-lifecycle.md) | 跨平台窗口外壳与建议生命周期 | Windows 一行标题栏（自绘菜单条 → 原生子菜单）、chord 经 `formatChord` 按平台渲染、全屏收回让位垫、浮窗无边框、Windows 对话框按钮在 CSS 翻转；建议批量执行 + 终态/可重试失败分类 + 忽略落盘 |
| [2026-09-15](./adr/2026-09-15-boot-integrity-and-undeclared-identifiers.md) | 启动完整性与未声明标识符 | `popupSink` 被赋值但从未声明——ready 处理器里的 ReferenceError 让三个平台在开出第一个窗口前就死掉，绕过了八道绿灯关卡；`install-skills.mjs` 自初版起就无法解析；新增真正的 scope 分析检查，以及一个在 stub Electron 下真实启动主进程的测试 |
| [2026-09-17](./adr/2026-09-17-adversarial-deep-review.md) | 对抗性深度审查 | 生命周期结构平面围栏、归档面 containment、捕获脏 Esc 守卫、openPath realpath、todo 默认 actor=ai |
| [2026-09-17b](./adr/2026-09-17b-writeback-authorization-model.md) | 写回授权模型 | `locked` = 任务级首写快照（非 AI 禁区）；分级 confirm（内容落盘；仅删/归档 pending）；永久删 locked/core 仅用户 |
| [2026-09-17c](./adr/2026-09-17c-adversarial-pass-fences-and-honesty.md) | 对抗审查：围栏与诚实 | 悬空 symlink fail-closed；系统安全叶子；归档校验 fail-closed；Memory 单真源；分级 confirm UI 改名；Esc 守卫重臂 |
| [2026-09-17e](./adr/2026-09-17e-global-memory-quality.md) | 全局记忆质量 | 事实清单 · 健康（近重复）· 恢复 · 排序注入 · 整理分区路由 |

**设计提案（非 ADR）：**

| 文档 | 主题 |
|------|------|
| [design/2026-09-16-tools-and-logs-workspace-care.md](./design/2026-09-16-tools-and-logs-workspace-care.md) | 工具与日志：stats · ops journal · 健康含契约 · 清理预览/去重 · C1–C9 修复 |

---

## 版本数字与真源

根据独立版本策略，版本数字**只**在真源文件中维护，请勿在文档中硬编码版本数字。查看全局所有表面的当前版本：

```bash
npm run versions
```

| 表面 | 真源文件 | 策略 |
|------|----------|------|
| Skills Pack | [topmind-skills/topmind-pack.json](https://github.com/topmindspace/topmind-skills/blob/main/topmind-pack.json) | 独立 |
| Desktop | [`../topmind-desktop/package.json`](../topmind-desktop/package.json) | 独立 |
| Clip Extension | [`../browser-extension/manifest.json`](../browser-extension/manifest.json) | 独立 |
| UTR | [`../utr/VERSION`](../utr/VERSION) | 跟随 Desktop |
| Obsidian Plugin | [topmind-obsidian/manifest.json](https://github.com/topmindspace/topmind-obsidian/blob/main/manifest.json) | 独立 |
