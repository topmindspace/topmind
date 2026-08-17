# ADR: 记忆整合（Memory Consolidation）——对齐业界实践的确认式事实生命周期

> **状态**：Accepted · **日期**：2026-08-16
> **取代**：无（增量演进；延伸 2026-08-09 记忆重设计的 D4）
> **影响范围**：lib/memory-engine · lib/ai-operation-engine · lib/suggest-engine · 文档

## 背景

2026-08-09 重设计后，topmind 记忆机制已对齐业界的分层与提炼思路：

| 业界方案 | 核心机制 | topmind 对应 |
|---|---|---|
| MemGPT / Letta | core / archival 分层 + LLM 自编辑 core memory | profile（core）/ periodic+stream（archival）+ 确认式写闸 |
| Zep / Graphiti | episodic / semantic 分离 + 时间有效性 | Stream（episodic）/ Memory（semantic）+ 条目日期标记 |
| Generative Agents | observation → reflection → 检索 | 活动窗口 → periodic 反思（洞察而非事件）→ AI 上下文注入 |
| mem0 | 抽取事实后做 ADD / UPDATE / DELETE 决策 | 抽取 + 去重 + 确认写入（**只有 ADD**） |
| Claude memory | Markdown 真源 + 用户可读可改 | memory/ 全 Markdown，用户随时手改 |

**缺口**：mem0 的核心循环是「抽取事实 → 对每条事实决定 ADD / UPDATE / DELETE」。topmind 此前只有 **ADD**（appendProfileEntry + 去重）。后果：

1. `## 进行中的事` 里的条目完成后**永远留在活跃区**——「进行中」语义失真，且每次 AI 上下文注入都携带过期事实，污染提示词。
2. 事实发生变化（如「每周跑步 3 次」→「改为游泳」）只能靠人手改文件；AI 发现了变化也没有可用的更新通道。
3. 与「不设自动遗忘」的正确立场冲突吗？不冲突——业界 DELETE 语义在 topmind 必须翻译为**可见、可逆、需确认**的归档，而非删除。

## 决策

### D1: 确认式事实生命周期（活跃 → 历史记录）

profile 事实引入两段生命周期：**活跃**（分布在 `## 偏好` / `## 当前目标` / `## 进行中的事` 等段落）→ **已归档**（`## 历史记录` 段落，带 `（YYYY-MM-DD 归档）` 前缀）。**永不自动删除**；归档条目仍在文件里，用户可随时手工移回。

### D2: memory-engine 新增两个整合操作（Kernel 4/8 内，非新引擎）

- `retireProfileEntry({ workspaceRoot, match, section?, historySection="历史记录", contract })` — 把匹配事实行从活跃段落**移入**历史段落，加归档日期。匹配语义与 `profileSectionHasFact` 一致（规范化后相等或 ≥6 字符包含），日期前缀 `（YYYY-MM-DD）`/`（YYYY-MM-DD 归档）` 自动剥离后再比较；**段落标题行永不参与匹配**（防标题被当归档拆结构）；显式 `section=历史记录` → `skip invalid-section`。已在历史段 → `skip already-retired`；找不到 → `skip no-matching-fact`；profile 缺失 → `skip no-profile`。
- `updateProfileEntry({ workspaceRoot, match, content, section?, contract })` — 原位替换匹配行为 `- （今日日期）新内容`；新内容过 `validateAiOutput` 消毒 + 同段落去重（`duplicate-fact` skip）。**历史段不可原位更新**（审计记录保持原样，需手改文件）。

两者都经 `executeWrite`（唯一写闸、`role: memory`、`skipShadow`），导出自 `kernel-api.mjs`。

### D3: memory_organize 提出「可归档候选」（mem0 DELETE 的确认式翻译）

`ai-operation-engine` 的 `memory_organize` 提示词 schema 增加 `retire` 数组：要求 AI 从**已有画像中逐字/近似引用**被活动材料证明「已完成 / 已过期 / 不再成立」的条目（最多 3 条）。产出 `kind: promote_memory` + `payload.action: "retire_profile"` 的建议条，**默认只生成建议，须用户确认**。

`applySuggestion`（suggest-engine）新增 `retire_profile` action 分发：match 文本先过 `sanitizeAiContent` + 占位污染拒绝，再调 `retireProfileEntry`；`already-retired` / `no-matching-fact` 视为良性 skip（`ok: true`，不产生错误噪音）。

UPDATE 语义 = retire 旧行 + append 新行（两个操作都已存在），不单独做 AI 建议通道，控制 AI 出错面。

### D4: 明确不做的（Non-goals，延续既有立场）

- **不引入向量/embedding/语义检索**（Reset Non-goal；归档候选靠活动窗口 + LLM 语义判断，不建索引）。
- **不自动遗忘**：无定时任务扫描 profile 自动归档；只有 memory_organize（用户手动/后台 prep 触发）+ 确认。
- **不做时间衰减打分**（Generative Agents recency/importance 分数）：Markdown 真源放不下隐藏分数，日期前缀已提供人工可读的时间信号。
- **不建 JSON 事实库**：真源始终是 profile.md 本身。

## 实施清单

- `lib/memory-engine.mjs`：`parseProfileSections` / `findProfileFactLineIndexes` 内部助手 + `retireProfileEntry` / `updateProfileEntry` 导出。
- `lib/kernel-api.mjs`：再导出两个新函数。
- `lib/ai-operation-engine.mjs`：memory_organize 双语提示词 + 解析 + `mem-retire-*` 建议条。
- `lib/suggest-engine.mjs`：`promote_memory` case 增加 `retire_profile` action。
- `tests/memory-consolidation.test.mjs`：21 条行为测试（移动/幂等/无匹配/无 profile/段落过滤/标题行保护/历史段不可更新/invalid-section/CRLF 归一/readProfileActiveBody/穿越拒绝/原位更新/去重/污染拒绝/AI 建议/applySuggestion 三态）。
- 加固（同批）：topic slug / period stem 穿越校验（`invalid-slug` / `invalid-period` skip）；`readProfileActiveBody` 供 AI 上下文使用（历史段折叠为一行计数）；suggest/ai-operation 活动指纹排除 `memory/` 平面 + 去掉 mtime（AI 自写不再自我触发）。
- Desktop / Obsidian：**零改动**——建议条 UI 与 `WorkspaceService.applySuggestion` 走 Kernel 通用管线，retire 建议自动出现并可确认执行。

## 后果

- 「我的情况」保持诚实：进行中的事做完就归档，AI 上下文注入的是当前为真的事实。
- 与删除诚实原则一致：归档不是删除，无 trash、无回执需求（普通 profile 行内容仍在同一文件内）。
- mem0 / Letta 的 ADD/UPDATE/DELETE 三操作在 Markdown 真源上都有了确认式等价物；Zep 的时间有效性由日期前缀 + 归档段落近似表达。
