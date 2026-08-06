# Quality audit — topmind (2026-08-03)

> **角色**：深度质量审查记录（证据 → 判定 → 处置）  
> **范围**：Kernel · Desktop stream/AI · Skills · UTR 边界 · 活文档 · TestWS 夹具  
> **非目标**：主观 delight 实测、embedding/Ask、绿场第二北极星  
> **基线**：v2.0.3 — AI 写回卫生 · StatusBar 单 AI 控件 · stream MD · 行内「格式」

---

## 1. 结论摘要

| 维度 | 判定 |
|------|------|
| Stream AI 产品路径 | **健康** — activity-window 共用；organize → runActivityOps；confirm 写闸 |
| 写安全 | **健康** — create_topic sanitize + writeback workspace 边界 |
| AI 耐久写卫生 | **健康（v2.0.3）** — `ai-content-sanitize`：无占位污染、无 JSON dump、无未标签 CoT；失败诚实不写；profile 去重；period 同名更新 |
| 活文档双真源 | **健康** — 入口诚实表与 Wave S\* 对齐 |
| Desktop stream UX 结构 | **健康** — 默认 stream · 记下 · 增补 · SuggestEntryStrip→ActionBar · 建议/清单/后台分词 |
| StatusBar AI chrome | **健康（v2.0.3）** — 单「AI 就绪」pill：离线→设置；就绪→`toggleAiPanel`（去掉冗余「会话」按钮） |
| Inline AI | **健康（v2.0.3）** — 新增「格式」；结果 sanitize 与 main/renderer 双层 |
| TestWS | **已补齐** — 可打开 stream / list periods / activity window ≥1 |

本轮 **fix（历史）**：TestWS 空骨架 → `scripts/seed-testws-fixtures.mjs`。  
本轮 **fix（v2.0.3）**：AI suggest/organize/todo 写回污染与冗余；StatusBar 冗余；stream MD 空白/列表；行内「格式」。  
UTR `memory.digest` = 确定性 adapter（非产品 AI 路径），见 `TOOLS.md`。

---

## 2. Findings

| ID | 严重度 | 区域 | 证据 | 判定 | 处置 |
|----|--------|------|------|------|------|
| F1 | high (was) | TestWS | 仅空目录 + 23B yaml；`resolveActivityWindow` → 0 items | **fix** | 种子脚本 + 合成 Markdown/yaml（本机 TestWS） |
| F2 | — | Kernel Stream AI | suggest/todo/ai-ops 均 `resolveActivityWindow` | **intentional** 已合闸 | 保持 |
| F3 | — | create_topic 安全 | `sanitizeTopicPlacement` + writeback outside deny | **intentional** 已合闸 | 保持 + 回归测 |
| F4 | — | 活文档 | rg 无 disabled-placeholder / 待实施假陈述 | **intentional** 已合闸 | 保持 |
| F5 | med (was) | Desktop DESIGN 分词 | §3 曾写 ActionBar=「待办」与 §0「建议」双真源 | **fix** | DESIGN §3/§3.6 改为「建议」；cross-surface 测 doesNotMatch 统一待办条 |
| F6 | low | UTR | 无 activity-window 命令 | **non-goal** | 可选薄 adapter；日常不强制 UTR |
| F7 | low | 跨周期聚合 feed | Q5-A 单周期+chip | **non-goal** | 见 stream-first scheme |
| F8 | info | TestWS 不在 git | 用户数据根在 engine 外 | **intentional** | 种子脚本入引擎；数据不进 `topmind/` |

---

## 3. Stream-first / Desktop UX 结构核对

| 检查项 | 结果 |
|--------|------|
| 默认 selection = stream | `view-store.ts` |
| 记下（inline composer） | `StreamDetailView` |
| 条目增补 | `appendStreamEntry` + UI |
| quiet「N 条建议」 | 画布顶 `SuggestEntryStrip`（`data-stream-suggestions-quiet`）→ `openSuggestSurface` → ActionBar |
| organize 合入 confirm 建议 | `runOrganizeWeek` → `runActivityOps` |
| 个人清单 ≠ 建议 ≠ 后台 | DESIGN §0 + §3/§3.6 + ActionStore（ActionBar≠「待办」） |
| 高影响 confirm | `blockUnconfirmedHighImpact` |
| create_topic 不出 workspace | `sanitizeTopicPlacement` |

**Dream 模式易用性**：以结构完备 + DESIGN 语言为准（非端到端 GUI A/B）。

---

## 4. TestWS 夹具（合成 · 非隐私）

路径：工作区外独立用户数据目录（例如 sibling `TestWS`，**不在** engine 树内）

重种：

```bash
node scripts/seed-testws-fixtures.mjs /path/to/TestWS
```

包含：

- `topmind.yaml` contract_version 4 · stream weekly  
- `10-动态/{当前周,上周}.md` 多日条目  
- `20-专题/2026-知识管理演示/topic.md` + 笔记  
- `memory/profile.md` + `memory/periodic/{上周}.md`  
- `00-收件箱` 剪藏样例 · `88-输出` 交付样例  

探针（本审计）：activity_items ≥ 1 · stream_periods ≥ 1 · append marker · sanitize under root。

---

## 5. 与锁的关系

不改动 Reset A–D：文件真源 · 写闸 · ≤5 概念 · 建议确认。  
不扩大用户概念；不强制 UTR。

---

## 6. 修订

| 日期 | 说明 |
|------|------|
| 2026-08-03 | 首版：审查结论 · TestWS 种子 · 证据路径见 goal SCRATCH |
| 2026-08-03 | F5 fix：DESIGN ActionBar 产品词统一为「建议」；测试加固拒绝「统一待办条」 |
| 2026-08-03 | Stream 完善：卡片 MD 预览（`stream-md-preview`）；sanitize reserved plane；topic_classify 排除 stream/delivery；ARCHITECTURE「统一待办」→「统一建议条」 |
| 2026-08-03 | 架构复审：task-store 候选 → `suggest-surface:open`（展开 ActionBar）；Reset/README.en/stream-first 叙述对齐统一建议入口 |
