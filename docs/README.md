# 文档索引

> **产品入口** [`../README.md`](../README.md) · **English** [`../README.en.md`](../README.en.md)  
> 根目录放**日常契约**；本目录放架构锁、ADR、打包与截图。

## 版本

数字**只**写在真源；用 `npm run versions` 查看。**勿在文档中抄写版本号。**

| 层 | 真源 |
|----|------|
| Skills Pack | [`../skills/topmind-pack.json`](../skills/topmind-pack.json) |
| Desktop | [`../topmind-desktop/package.json`](../topmind-desktop/package.json) |
| Clip Extension | [`../browser-extension/manifest.json`](../browser-extension/manifest.json) |
| UTR | [`../utr/VERSION`](../utr/VERSION) |

---

## 阅读顺序

| 顺序 | 文档 | 读什么 |
|------|------|--------|
| 1 | [`../README.md`](../README.md) | 产品总览 · 工作流 · Skills 图 · 截图 |
| 2 | [`ARCHITECTURE-RESET.md`](./ARCHITECTURE-RESET.md) | **决策锁** · Target/Done · 阶段 |
| 3 | [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md) | Skills / Desktop / UTR 边界 |
| 4 | [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) | 内容模型 · **6 条规约** · 三平面 |
| 5 | [`../DESIGN.md`](../DESIGN.md) | 产品交互（用户概念 ≤5） |
| 6 | 按需 | Desktop · Skills · UTR · 剪藏 · 打包 |

---

## 本目录

| 路径 | 用途 |
|------|------|
| [`ARCHITECTURE-RESET.md`](./ARCHITECTURE-RESET.md) | 架构决策锁与实施诚实表（唯一实施真源 · 2026-08-07 精简） |
| [`stream-first-optimization-scheme.md`](./stream-first-optimization-scheme.md) | Stream-first **Shipped**：现行产品真理 + 理想使用模型（2026-08-07 精简） |
| [`quality-audit-2026-08.md`](./quality-audit-2026-08.md) | 2026-08 质量审查摘要（已归档 · 所有发现已处置） |
| [`PACKAGING.md`](./PACKAGING.md) | 打包 · Actions · 安装包命名 · 标签矩阵 |
| [`capture-clip-matrix.md`](./capture-clip-matrix.md) | 捕获 · Clip · 知识加工能力矩阵 |
| [`topmind-vs-others.md`](./topmind-vs-others.md) | 与 Notion / Obsidian 等对比 |
| [`images/`](./images/) | Desktop 截图（文档用压缩图） |
| [`examples/community-templates/`](./examples/community-templates/) | 社区模板示例（**非**官方 4 Profile） |
| [`adr/`](./adr/) | 仍生效的架构决策记录 |

### 已合并 / 勿再引用

| 原路径 | 去向 |
|--------|------|
| `architecture-refactor-proposal-2026-07.md` | → `ARCHITECTURE-RESET.md` |
| `desktop-uiux-design-proposal.md` | → `topmind-desktop/DESIGN.md` |
| `adr/2026-07-24-implementation-progress.md` | → `ARCHITECTURE-RESET.md` 阶段表 |
| `adr/2026-07-16-workspace-model-config-v3.md` | → contract v4 + `PROJECT-MODEL.md` |

---

## 存活 ADR

| ADR | 主题 |
|-----|------|
| [2026-06-14 desktop AI runtime](./adr/2026-06-14-desktop-ai-runtime.md) | Desktop AI = AI SDK |
| [2026-07-13 browser clip](./adr/2026-07-13-browser-clip-extension.md) | Clip 扩展 |
| [2026-07-16 agent harness](./adr/2026-07-16-desktop-agent-harness-upgrade.md) | edit / compact / steer |
| [2026-07-16 skill-first](./adr/2026-07-16-desktop-skill-first-agent.md) | skill-first Agent |
| [2026-07-16 public update](./adr/2026-07-16-public-update-and-pack-root.md) | 更新检查 · pack 根 |
| [2026-07-17 UTR bundle](./adr/2026-07-17-desktop-utr-bundle-tools-console.md) | 捆绑 UTR 仅 Tools |
| [2026-07-19 ingest](./adr/2026-07-19-knowledge-ingest-pipeline.md) | 知识加工 |
| [2026-07-21 no Pi kernel](./adr/2026-07-21-pi-agent-base-decision.md) | 不内嵌 Pi |
| [2026-07-22 stream + memory](./adr/2026-07-22-stream-packing-and-core-memory.md) | 周期本 + 记忆 |
| [2026-08-02 AI provider context](./adr/2026-08-02-kernel-ai-provider-context.md) | per-call aiProvider + `createKernelContext` |
| [2026-08-02 workspace-model 拆分](./adr/2026-08-02-workspace-model-split.md) | facade + model-core/topic/stream/memory |
| [2026-08-02 Design System 2.0](./adr/2026-08-02-design-system-2-paper-mind.md) | 纸感智识工作台（中性色已被 2.1 取代，见 2026-08-07 ADR Round 3） |
| [2026-08-02 ConnectorBridge](./adr/2026-08-02-connector-bridge.md) | Desktop 连接器共享契约 |
| [2026-08-06 Phase D hardening](./adr/2026-08-06-phase-d-desktop-hardening.md) | 组件拆分 · 事件类型化 · 单队列 · RPC 校验 · AI 输出单闸 |
| [2026-08-07 单入口降噪](./adr/2026-08-07-desktop-single-entry-dedupe.md) | 建议计数两处 · 清单单入口 · composer 去 meta · 侧栏少一条带 |
| [2026-08-07 综合设计优化](./adr/2026-08-07-comprehensive-design-optimization.md) | 标题栏品牌chip移除 · chrome纤细化(36/24px) · border/hover/shadow精炼 · 侧栏头部统一 · Landing去教育噪音 · 状态栏路径移除 |
| [2026-08-07 引擎硬化](./adr/2026-08-07-engine-hardening-writeback-ai.md) | 回执轮转 `RECEIPT_KEEP=50` · 智能回执 · 目录归档原子 rename + 校验 · AI Provider 动态 temperature/systemPrompt/maxTokens · 瞬态错误重试 · 会话压缩 80K/40 · 默认模型更新 |

摘要亦见 `ARCHITECTURE-RESET.md` §6。

---

## 根契约（勿在此复制全文）

| 文档 | 角色 |
|------|------|
| `PRODUCT-BOUNDARIES.md` | 三体边界 · 能力诚实 |
| `PROJECT-MODEL.md` | 内容模型 · 6 规约 |
| `SKILL-ARCHITECTURE.md` | Skills 包 |
| `TOOLS.md` | UTR · 写回 auto\|confirm |
| `DESIGN.md` | 产品交互 |
| `AGENTS.md` | Agent 纪律 |
| `SECURITY.md` | 安全 |

---

## 实现锚点

| 主题 | 锚点 |
|------|------|
| **Clip** | `browser-extension/` · Desktop `clip-bridge` · `skills/shared/long-url-capture.md` |
| **Ingest** | Desktop ingest 服务 · `skills/shared/document-ingest.md` · ADR 2026-07-19 |
| **写回** | `lib/writeback-engine.mjs` · Desktop WorkspaceService · UTR adapter |
| **安全恢复** | UTR `list-safety-receipts` / `restore-safety-receipt` · `99-归档/backups/` |
| **截图** | [`images/README.md`](./images/README.md) |
