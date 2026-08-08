# Architecture assessment — topmind (2026-08-08)

> **角色**：全项目设计 / 架构 / 功能 / 模块合理性评估（架构师 + 终端用户双视角）  
> **状态**：Active assessment（本目标产出）  
> **基线**：活文档锁 `ARCHITECTURE-RESET` · `PROJECT-MODEL` · `PRODUCT-BOUNDARIES` · `DESIGN` · `AGENTS`  
> **方法**：对照活真源与 shipped 代码（Kernel `lib/`、四表面 + Clip、质量门），每条 finding 必须有处置。

---

## 0. 结论摘要

| 维度 | 判定 | 说明 |
|------|------|------|
| 设计哲学 / 北极星 | **健康** | 最低摩擦个人动态流；≤5 用户概念；文件即真源；A/B/C/D 决策锁清晰 |
| 目标架构三层 | **健康** | Experience → Kernel → Workspace 与代码一致；writeback 为唯一内容写闸 |
| 四体边界 | **健康（小漂移已修）** | Skills / Desktop / UTR / Obsidian 职责分明；Clip 为 companion 分发面 |
| Kernel 八引擎 + 扩展 | **健康** | 主写 Done；todo / AI ops / activity-window 已纳入；Intentional Partial 诚实 |
| Desktop 写路径 | **有一处缺口 → fix** | `renameTopic` 改 frontmatter 曾绕过 writeback；与 `renameCategory` 不对称 |
| 活文档一致性 | **小漂移 → fix** | connector-bridge 路径误写；表面计数「四体 / 五大」措辞冲突 |
| 废弃 / 冗余 | **局部清理** | v3 community-templates 无引用；ADR 验收框未勾；其余 ADR 与 Reset 保留 |
| 质量门 | **以验证为准** | secrets / docs:guard / dead-code / validate 见本目标证据 |

**总评（架构师）**：实现与决策锁高度对齐（完成度分数卡 ~98–99% 主路径可信）。本轮不是重做架构，而是**消弥剩余写闸缝隙、文档措辞漂移、历史残留**。

**总评（用户）**：主路径（记一下 → 动态 → 建议确认 → 写出来）产品化完成；不需要新功能堆叠。清理与文档诚实比「全面重写」更提升可信度。

---

## 1. 设计哲学与目标架构（评估）

### 1.1 设计哲学 — **合理 · intentional keep**

| 原则 | 证据 | 判定 |
|------|------|------|
| 最低摩擦动态流 | Reset A · stream-first scheme · Desktop PrimaryNav 默认 stream | keep |
| AI 建议 + 用户确认 | Reset D · suggest-engine · ActionStore · confirm writeback | keep |
| 文件即真源 · 无平行 DB | 三平面 FS · 无 content DB | keep |
| 用户概念 ≤5 | DESIGN / PRODUCT-BOUNDARIES / UI 白话 | keep |
| Surface 不平行业务语义 | Kernel writeback · connector-bridge · UTR adapter | keep（renameTopic 曾违规，已 fix） |

### 1.2 目标架构三层 — **正确 · intentional keep**

```text
Experience (Desktop / Skills / Clip / Obsidian UI)
    → Kernel lib/ (contract · model · stream · memory · writeback · lifecycle · derived · ingest
                   + todo · ai-ops · activity-window)
    → Workspace FS (content / memory / topmind.yaml + .topmind)
```

对照代码：`lib/kernel-api.mjs` 门面、`workspace-model` facade 拆分、Desktop `kernelDurableWrite`、UTR `executeWrite` 一致。

### 1.3 三平面 + 六规约 — **正确 · intentional keep**

PROJECT-MODEL 仍为内容约定唯一真源；skills 共享 `project-model-brief` 为摘要非第二真源。文件名含 legacy「project」属历史命名，内容已 Topic* 化 — **intentional keep**（改名收益 < 引用面成本）。

---

## 2. 四体 + Clip 表面（评估）

| 表面 | 职责合理性 | 与 Kernel 关系 | 判定 |
|------|------------|----------------|------|
| Skills | 可移植流程；Host 文件工具为主 | 契约消费者，不强制 UTR | keep |
| Desktop | 富工作台；不硬依赖 UTR | WorkspaceService → writeback | keep + F1 fix |
| UTR | 可选 CLI/MCP adapter | 业务在 Kernel | keep |
| Obsidian | Vault 内嵌流 + esbuild 内联 Kernel | 复用 lib/，非 Desktop 替代 | keep |
| Clip | MV3 剪藏 companion | Bridge → Desktop ingest，非独立 Kernel 宿主 | keep（措辞对齐 F3） |

---

## 3. Kernel / 模块（评估）

| 模块 | 状态 | 判定 |
|------|------|------|
| writeback-engine | 唯一写闸；backup/receipt 轮转 | keep |
| workspace-model 四件套 + facade | 导入面稳定 | keep |
| stream-period + activity-window | 动态 / 建议 / 待办共用窗口 | keep |
| memory / todo / suggest / ai-ops | 经 writeback；confirm 高影响 | keep |
| derived-builder | 可删可重建；AI 可占位 | keep |
| ingest-pipeline | 路由 Done；转换器 Desktop 本地 | keep |
| contract-engine | 主路径 Done；非全 Surface UI | intentional partial |
| 高影响 only 备份/回执 | locked · delete/archive | keep（2026-08-08） |
| embedding / 全库 Ask | Reset Non-goal | non-goal |
| Phase D 互操作 | 0% 明确未来 | non-goal |

---

## 4. Findings 与处置

| ID | 严重度 | 区域 | 问题 | 处置 |
|----|--------|------|------|------|
| **F1** | **med** | Desktop `renameTopic` | 目录 rename 后 `.md` frontmatter/`topic.md` 用 `fs.writeFile` 直写，绕过 Kernel writeback；与 `renameCategory`→`executeWrite` 不对称，违反「耐久 .md 经写闸」 | **fixed** — `kernelDurableWrite` + 护栏/行为测试 |
| **F2** | low | Desktop ARCHITECTURE | 诚实表写 `lib/connector-bridge.mjs`；实为 `electron/lib/connector-bridge.mjs` | **fixed** — 路径改正 |
| **F3** | low | README / 边界文档 | 「五大表面」vs「四体」并存；hero 公式曾将 Clip 列为 ⊕ 对等项 | **fixed** — 矩阵 + hero 公式统一「四体 ⊕ + Clip companion」；`tests/surface-formula-contract.test.mjs` |
| **F4** | low | ADR 2026-08-07 design opt | 验收清单仍为 `- [ ]` 但能力已合闸 | **fixed** — 勾选并注 Shipped |
| **F5** | low | `docs/examples/community-templates/` | v3 社区模板，标注非官方、零引用 | **fixed (purged 2026-08-08)** |
| **F6** | info | quality-audit-2026-08 | 已归档点时审查 | **intentional keep** |
| **F7** | info | stream-first-optimization-scheme | 现行产品真理 · Shipped | **intentional keep** |
| **F8** | info | Accepted ADRs | 决策记录，非「历史垃圾」 | **intentional keep** |
| **F9** | info | Intentional Partial | contract 非全 UI | **intentional keep** |
| **F10** | — | embedding / Ask / Phase D | Reset 已锁 | **non-goal** |
| **F11** | info | `skills/shared/project-model-brief.md` 文件名 | legacy 词 Project；内容正确 | **intentional keep** |
| **F12** | info | UTR 无 activity-window 一等命令 | 薄 adapter 可选；quality-audit F6 | **non-goal** |
| **F13** | info | 写闸主路径 save/delete/AI/connectors | 经 kernelDurableWrite / executeWrite | **intentional keep** |

### 用户视角补充（非独立 finding）

- 主 chrome 已按 2026-08-07 降噪（36/24 chrome）；不必再开一轮视觉重做（non-goal）。
- 搜索无 embedding 是诚实 Non-goal，产品文案已「关键词诚实」— 保持。
- 文档入口（README → surface READMEs → Reset）清晰；本轮只修漂移，不新建第二文档体系。

---

## 5. 清理范围（与 F5 对齐）

| 路径 | 动作 |
|------|------|
| `docs/examples/community-templates/**` | 删除 |
| ADR / Reset / quality-audit / stream-first | **保留** |
| Accepted ADRs 未 superseded 者 | **保留** |

---

## 6. 与既有审计关系

- `docs/quality-audit-2026-08.md`（08-03）：Stream AI / 写安全 / TestWS — 已处置归档。  
- 本文件：架构师+用户全景 + 2026-08-08 仍存在的写闸/文档漂移。  
- 实施真源状态表仍只更新 `docs/ARCHITECTURE-RESET.md`（不另起 progress ADR）。
