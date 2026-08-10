# topmind 文档全景导览中心 (Documentation Sitemap)

> **根目录入口** [`../README.md`](../README.md) · **English** [`../README.en.md`](../README.en.md)  
> 本目录收录 topmind 项目的架构设计锁、ADR 决策记录、打包发布规范与全表面导览。

---

## 按角色快速导航

根据阅读目标，选择最适合的路径：

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
   • obsidian-plugin/README.md     • DESIGN.md (UI/UX 规范)        • TOOLS.md (UTR CLI/MCP)
   • browser-extension/README.md   • PACKAGING.md (打包/CI)
```

---

## 1. 表面与组件专有文档 (Surface Documentation)

| 表面 / 模块 | 核心职责 | 英文 README | 中文 README | 架构与设计 |
|-------------|----------|-------------|-------------|------------|
| **Desktop** | 本地富文本工作台 / Electron 应用 | [`topmind-desktop/README.md`](../topmind-desktop/README.md) | - | [`ARCHITECTURE`](../topmind-desktop/ARCHITECTURE.md) · [`DESIGN`](../topmind-desktop/DESIGN.md) |
| **Obsidian 插件** | Obsidian Vault 内嵌动态流视图 | [`obsidian-plugin/README.md`](../obsidian-plugin/README.md) | [`README.zh-CN`](../obsidian-plugin/README.zh-CN.md) | [`ARCHITECTURE`](../obsidian-plugin/ARCHITECTURE.md) · [`DESIGN`](../obsidian-plugin/DESIGN.md) |
| **Skills** | Agent 可移植技能包 (Claude Code / OpenCode) | [`skills/README.md`](../skills/README.md) | - | [`SKILL-ARCHITECTURE`](../SKILL-ARCHITECTURE.md) · [`INSTALL`](../skills/INSTALL.md) |
| **剪藏扩展** | 浏览器一键网页正文加工与剪藏 | [`browser-extension/README.md`](../browser-extension/README.md) | - | [`capture-clip-matrix`](./capture-clip-matrix.md) |
| **UTR** | 确定性 CLI / MCP 工具链 | [`utr/README.md`](../utr/README.md) | - | [`TOOLS.md`](../TOOLS.md) |

---

## 2. 架构决策与设计规范 (Architecture & Specifications)

| 规范文档 | 角色与用途 | 关键要点 |
|----------|------------|----------|
| [`ARCHITECTURE-RESET.md`](./ARCHITECTURE-RESET.md) | **架构决策锁与实施诚实表**（唯一实施真源） | 诚实能力表、八引擎规范、全阶段 Done / Non-goal |
| [`PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) | **四体边界** | 定义 Skills / Desktop / UTR / Obsidian 的独立与协同界限 |
| [`PROJECT-MODEL.md`](../PROJECT-MODEL.md) | **内容模型与 6 条规约** | 定义【三平面】目录架构、6 条命名与归档规约 |
| [`DESIGN.md`](../DESIGN.md) | **产品交互设计规范** | 约束用户概念 <= 5，定义"记一下/动态/专题/我的情况/写出来" |
| [`SECURITY.md`](../SECURITY.md) | **安全与密钥边界** | 约定 API Key 本地明文存储规范、无遥测声明、网络范围 |
| [`AGENTS.md`](../AGENTS.md) | **Agent 行为纪律真源** | 定义质量门顺序、死代码检测、多表面版本发布策略 |

---

## 3. 打包、构建与产品参考 (Packaging & Product References)

| 指南文档 | 说明 |
|----------|------|
| [`PACKAGING.md`](./PACKAGING.md) | 打包与发布规范：安装包命名矩阵、GitHub Actions 独立/全量 Release 工作流、Win/Mac/Linux 构建说明 |
| [`images/README.md`](./images/README.md) | 媒体与截图资源索引 |
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first 产品真理与理想使用态 |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | Capture · Clip · Ingest 能力矩阵 |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | 知识管理方案对比与选型指南 |

---

## 4. 存活架构决策记录 (Active ADRs)

| 编号/日期 | 主题 (Subject) | 决策摘要 |
|-----------|----------------|----------|
| [2026-06-14](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI Runtime | 采用 Vercel AI SDK 统一 Desktop 端 AI 驱动 |
| [2026-07-13](./adr/2026-07-13-browser-clip-extension.md) | Browser Clip Extension | Manifest V3 + Readability + content_html 架构 |
| [2026-07-16](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | Agent Harness Upgrade | 支持 edit / compact / steer 辅助会话 |
| [2026-07-16](./adr/2026-07-16-desktop-skill-first-agent.md) | Skill-First Agent | 优先调用 topmind 自带技能 |
| [2026-07-16](./adr/2026-07-16-public-update-and-pack-root.md) | Public Update & Pack | 公共 `latest.json` 免 Token 更新检查与引擎打包 |
| [2026-07-17](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | Desktop UTR Bundle | Desktop 内置 UTR 环境及调试控制台 |
| [2026-07-19](./adr/2026-07-19-knowledge-ingest-pipeline.md) | Ingest Pipeline | 离线知识加工与 PDF/Office 入队列机制 |
| [2026-07-21](./adr/2026-07-21-pi-agent-base-decision.md) | No Pi Agent Base | 坚持原汁原味 Node 引擎，不依赖底层 Pi Agent 壳 |
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

---

## 版本数字与真源

根据独立版本策略，版本数字**只**在真源文件中维护，请勿在文档中硬编码版本数字。查看全局所有表面的当前版本：

```bash
npm run versions
```

| 表面 (Surface) | 真源文件 (Truth Source Path) | 策略 |
|----------------|------------------------------|------|
| Skills Pack | [`../skills/topmind-pack.json`](../skills/topmind-pack.json) | 独立 |
| Desktop | [`../topmind-desktop/package.json`](../topmind-desktop/package.json) | 独立 |
| Clip Extension | [`../browser-extension/manifest.json`](../browser-extension/manifest.json) | 独立 |
| UTR | [`../utr/VERSION`](../utr/VERSION) | 跟随 Desktop |
| Obsidian Plugin | [`../obsidian-plugin/manifest.json`](../obsidian-plugin/manifest.json) | 独立 |
