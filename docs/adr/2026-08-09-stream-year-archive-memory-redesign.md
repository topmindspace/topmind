# ADR: Stream 年目录 + 视图优化 + 年归档 + 分层记忆重设计

> **状态**：Accepted · **日期**：2026-08-09
> **取代**：无（增量演进）
> **影响范围**：lib/ engine · Desktop · Obsidian Plugin · Skills · UTR · 文档

## 背景

动态流（Stream）是 topmind 北极星——最低摩擦个人动态流。当前实现存在四个结构性问题：

1. **周期本平铺**：`10-动态/2026-W30.md` 直接在动态类根下，多年使用后文件膨胀（52 周 × N 年），目录噪音大。
2. **视图无边界**：StreamDetailView 一次性展示最多 50 个周期 chip，周期本越多越臃肿。
3. **无年归档**：旧年份周期本永远留在动态目录，无法清理，影响导航和性能。
4. **记忆与流混淆**：`memory/periodic/` 做 1:1 周期摘要——本质是流的压缩副本，不是「关于用户的记忆」。记忆应该是更高维度的提炼，不是事件的重复。

## 决策

### D1: Stream 年目录（yearDir 默认 true）

**方案**：动态类下按年分组，周期本归入年份子目录。

```text
10-动态/
├── 2026/
│   ├── 2026-W30.md
│   ├── 2026-W31.md
│   └── ...
├── 2025/
│   ├── 2025-W01.md
│   └── ...
└── .derived/          # 可选 AI 衍生
```

**实施**：
- `DEFAULT_STREAM.yearDir` 改为 `true`
- `buildDefaultContract()` 中 `stream.year_dir: true`
- 已有 `yearDir: false` 的工作区：**不强制迁移**；`listStreamPeriods` 已兼容年子目录和根级平铺两种模式（双模式扫描）
- 新建工作区默认年目录；旧工作区用户可在设置中开启
- `periodYearDir()` 使用 ISO year（weekly packing 跨年时）

### D2: Stream 视图优化（有限展示 + 往年入口）

**方案**：StreamDetailView 周期 chip 区域改为「近期 + 更多 + 往年」三段式。

```text
┌──────────────────────────────────────────┐
│ [本周 W30] [W29] [W28] [W27] [W26]       │ ← 近期 5 个（chips）
│                                            │
│ ▸ 本年更多 (2026 · 21 个)                 │ ← 折叠展开
│   [W25] [W24] ...                          │
│                                            │
│ ▸ 往年                                     │ ← 年份选择器
│   2025 (52) · 2024 (48)                    │
└──────────────────────────────────────────┘
```

**规则**：
- 近期 chips：最近 N 个周期（N=5，可配）
- 本年更多：当前年份剩余周期，折叠展开
- 往年：按年份列出，点击年份展开该年所有周期
- 不加载全部 50 个 chip；按需懒加载
- sidebar StreamView 不变（只显示当前周期内容）

### D3: 年归档机制

**方案**：用户可将完整年份归档到 `99-归档/stream-archive/`。

```text
99-归档/
├── backups/
├── trash/
├── receipts/
└── stream-archive/          # 新增：动态年归档
    └── 2025/                  # 原样保留年份目录结构
        ├── 2025-W01.md
        └── ...
```

**操作**：
- **API**：`archiveStreamYear(workspaceRoot, year, options)` → 目录原子 rename
- **位置**：StreamDetailView chrome overflow 菜单 →「归档往年」
- **条件**：只能归档当前年份之前的年份（`year < currentYear`）
- **安全**：走 writeback-engine 高影响路径（backup + receipt）
- **可恢复**：归档目录可通过搜索 / 归档面板访问；恢复 = 移回原位
- **不影响记忆**：归档 stream 年不影响 memory/periodic/（记忆是提炼，不是原始事件）

### D4: 分层记忆重设计

**核心原则**：记忆是「关于用户的持续认知」，不是「事件的压缩副本」。

#### 新三层结构

| 层 | 物理 | 内容本质 | 更新触发 | 与 Stream 的关系 |
|----|------|----------|----------|------------------|
| **profile** | `memory/profile.md` | 身份：偏好、目标、关系、习惯 | on-suggest / manual | 跨周期稳定事实 |
| **periodic** | `memory/periodic/{year}/{period}.md` | 反思：本周/本月**揭示了什么** | 周期结束 AI 生成 | 从流提炼**关于用户的洞察**，非事件摘要 |
| **topics** | `memory/topics/{slug}.md` | 主题：跨周期知识积累 | Stream→Memory 提升 | 反复出现的主题沉淀 |

#### periodic 记忆的本质转变

**旧**：周期摘要 = 流的压缩副本（「本周做了什么」）
**新**：周期反思 = 关于用户的提炼（「本周揭示了什么」）

新 periodic 记忆结构：
```markdown
---
title: 2026-W30 洞察
source_type: ai-derived
memory_layer: periodic
derived_from: [10-动态/2026/2026-W30.md]
generated_at: ...
---

## 关注焦点
（本周反复出现的主题/关切）

## 知识与见解
（用户表达的新认知、学习成果）

## 行为信号
（工作方式、习惯模式的观察）

## 偏好变化
（本周表现出的偏好倾向或调整）

## 线索
（可能在后续周期延续的线索，供追踪）
```

**不是**：时间线、条目列表、流水账压缩
**是**：模式识别、偏好信号、知识积累、行为洞察

#### 年目录对齐

memory/periodic/ 也按年分组，与 stream 年目录对齐：
```text
memory/periodic/
├── 2026/
│   ├── 2026-W30.md
│   ├── 2026-W31.md
│   └── ...
├── 2025/
│   └── ...
```

#### 年度提炼（可选）

`memory/periodic/{year}/{year}-summary.md` — 从全年周期反思中提炼的年度洞察。
- AI 在年底或用户触发时生成
- 不是事件的年度回顾，而是「这一年用户是如何演变的」
- 可选，不默认创建

#### 归档与记忆

- 归档 stream 年**不影响** memory/periodic/ — 记忆是提炼物，比原始事件更有保留价值
- 用户可单独清理 memory/periodic/ 的旧年份（手动）
- 记忆归档不设自动机制（避免丢失知识积累）

### D5: Memory 与 Stream 的明确边界

```text
Stream (episodic)         Memory (semantic)
─────────────────         ──────────────────
原始事件记录               提炼认知
按时间组织                 按主题/模式组织
可归档（年）               保留（知识积累）
短期价值                   长期价值
"发生了什么"               "揭示了什么"
```

**类比业界最佳实践**：
- **Episodic Memory**（情景记忆）= Stream 周期本 — 原始事件
- **Semantic Memory**（语义记忆）= Memory 层 — 提炼知识
- **Procedural Memory**（程序记忆）= Profile 中的习惯/偏好
- 参考：MemGPT 的 core/archival 分层 · Generative Agents 的 observation→reflection · Zep 的 episodic/semantic 分离

## 实施范围

### 引擎层（lib/）
1. `stream-period.mjs`：`DEFAULT_STREAM.yearDir = true`
2. `contract-engine.mjs`：`buildDefaultContract()` 加 `stream.year_dir: true`
3. `model-core.mjs`：`saveWorkspaceConfig()` 持久化 `year_dir`
4. `model-stream.mjs`：新增 `listStreamYears()` + `archiveStreamYear()`
5. `memory-engine.mjs`：`writePeriodDigest()` 改为 `writePeriodReflection()`；periodic 路径加年目录
6. `model-memory.mjs`：`resolveMemoryLayerPath()` periodic 加年目录
7. `suggest-engine.mjs`：stream_digest 建议改为 reflection 建议
8. `kernel-api.mjs`：导出新函数
9. `ai-operation-engine.mjs`：memory_organize 操作更新为反思模式

### Desktop（topmind-desktop/）
1. `workspace-path-ops.mjs`：新增 `archiveStreamYear` + `listStreamYears` IPC
2. `api.ts`：新增类型定义
3. `StreamDetailView.tsx`：三段式周期展示 + 归档入口
4. `locales/`：新增 i18n 键

### Obsidian Plugin
1. `kernel-workspace-ops.ts`：年目录适配
2. `stream-workbench-view.ts`：适配
3. `types.ts`：类型更新

### Skills / UTR
- Skills 路由文档更新年目录说明
- UTR 新增 `workspace.archive-stream-year` 命令

### 文档
1. `PROJECT-MODEL.md`：目录模型 + stream + memory 章节
2. `ARCHITECTURE-RESET.md`：状态 + 决策表
3. `AGENTS.md`：Current Truth
4. `DESIGN.md`：如需
5. 新建本 ADR

## 兼容性

- **旧工作区**：`yearDir: false` 继续工作；`listStreamPeriods` 双模式扫描兼容
- **旧 periodic 记忆**：根级 `memory/periodic/2026-W30.md` 仍可读；新写入到 `memory/periodic/2026/`
- **迁移**：不强制；用户可在设置中开启年目录 + 手动迁移旧文件
- **契约**：`stream.year_dir` 为新键，缺省时 normalize 为 `true`（新工作区）或从现有 `yearDir` 读取（旧工作区）

## 风险

1. **旧工作区混合**：年目录和非年目录共存 — `listStreamPeriods` 已兼容双模式
2. **记忆语义转变**：旧 periodic 记忆是摘要格式 — 新生成的是反思格式；旧文件保留，新生成覆盖
3. **归档不可逆性**：年归档是目录 move — 走 writeback-engine 高影响路径确保可恢复
