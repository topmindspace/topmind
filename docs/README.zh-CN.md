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
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first 使用态备忘（数字与 `lib/activity-window.mjs` 对齐；策略真源：DESIGN / TOOLS / Reset） |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest 能力矩阵 |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | 知识管理方案对比与选型指南 |
| [`UIUX-AUDIT-2026-09-01.md`](./UIUX-AUDIT-2026-09-01.md) | **NON-LIVING** 历史锚点（现行 IA 见 `topmind-desktop/DESIGN.md`） |

---

## 4. 架构决策记录（ADR）

完整档案见 [`./adr/`](./adr/)。索引保持**短摘要**；细节读原文，不在此复述实施史。

| 日期 | 现行约束（一行） |
|------|------------------|
| [2026-06-14](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI Runtime — Vercel AI SDK |
| [2026-07-13](./adr/2026-07-13-browser-clip-extension.md) | Clip 扩展 — MV3 + Readability + content_html |
| [2026-07-16](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | Agent harness — edit / compact / steer |
| [2026-07-16](./adr/2026-07-16-desktop-skill-first-agent.md) | Skill-first — 优先自带技能 |
| [2026-07-16](./adr/2026-07-16-public-update-and-pack-root.md) | 公共更新与引擎打包 |
| [2026-07-17](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | Desktop 内置 UTR 与工具台 |
| [2026-07-19](./adr/2026-07-19-knowledge-ingest-pipeline.md) | Ingest — anydoc sidecar / 可选 markitdown |
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | 围栏/写闸/Skills 仍有效；**循环选型被 2026-09-07 覆盖** |
| [2026-07-22](./adr/2026-07-22-stream-packing-and-core-memory.md) | 周期本打包 + 画像记忆闭环 |
| [2026-08-02](./adr/2026-08-02-connector-bridge.md) | 连接器 Bridge 契约 |
| [2026-08-02](./adr/2026-08-02-kernel-ai-provider-context.md) | per-call aiProvider + createKernelContext |
| [2026-08-02](./adr/2026-08-02-workspace-model-split.md) | workspace-model 门面拆分 |
| [2026-08-06](./adr/2026-08-06-phase-d-desktop-hardening.md) | Desktop 硬化 · RPC · 强类型事件 |
| [2026-08-07](./adr/2026-08-07-comprehensive-design-optimization.md) | 视觉精炼（细 chrome / 边框阴影） |
| [2026-08-07](./adr/2026-08-07-desktop-single-entry-dedupe.md) | 单入口降噪 |
| [2026-08-07](./adr/2026-08-07-engine-hardening-writeback-ai.md) | 回执轮转 · 退避重试 · 独立版本 |
| [2026-08-07](./adr/2026-08-07-obsidian-plugin-architecture.md) | 插件仓独立 · 构建内联 Kernel |
| [2026-08-09](./adr/2026-08-09-stream-year-archive-memory-redesign.md) | Stream 年目录 · periodic=反思 |
| [2026-08-13](./adr/2026-08-13-adversarial-first-principles-review.md) | 单契约写者 · AI 不改 yaml · 统一 Clip 转换 |
| [2026-08-13](./adr/2026-08-13-desktop-stream-editor-ai-review.md) | 预览非活 TipTap · 动态剥 chrome |
| [2026-08-13](./adr/2026-08-13-surface-ux-review.md) | 动态≠工作台 · 记一下≠记下 |
| [2026-08-16](./adr/2026-08-16-memory-consolidation.md) | 画像事实确认式 append/retire/update |
| [2026-08-23](./adr/2026-08-23-contract-settings-integrity.md) | 契约修复收敛 · 原子写 · 周期路径粘滞 |
| [2026-08-27](./adr/2026-08-27-desktop-log-rotation.md) | 支持日志轮转（2 MB × 3） |
| [2026-09-07](./adr/2026-09-07-pi-engine-and-three-column-reevaluation.md) | Hybrid pi-agent-core · 三列 AI 工作区 |
| [2026-09-14](./adr/2026-09-14-product-vocabulary-rename.md) | 词汇：Inbox / 交付 / Delivery |
| [2026-09-15](./adr/2026-09-15-boot-integrity-and-undeclared-identifiers.md) | 启动完整性 · 未声明标识符守卫 |
| [2026-09-15](./adr/2026-09-15-cross-platform-chrome-and-suggest-lifecycle.md) | 跨平台 chrome · 建议批量执行 |
| [2026-09-17](./adr/2026-09-17-adversarial-deep-review.md) | 结构平面围栏 · 归档 containment |
| [2026-09-17](./adr/2026-09-17b-writeback-authorization-model.md) | locked=任务快照 · 分级 confirm |
| [2026-09-17](./adr/2026-09-17c-adversarial-pass-fences-and-honesty.md) | symlink fail-closed · Memory 单真源 |
| [2026-09-17](./adr/2026-09-17e-global-memory-quality.md) | 全局记忆质量（去重/恢复/注入） |

设计提案（非 ADR）：[`./design/`](./design/)。
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
