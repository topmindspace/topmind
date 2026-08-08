# AI + Stream assessment — topmind (2026-08-08)

> **角色**：AI 基础设施 / 建议·待办·Agent / Stream 主表面 — 架构师 + 用户双视角  
> **状态**：Active assessment（本目标产出）  
> **基线锁**：`ARCHITECTURE-RESET` AI 分层 · `stream-first-optimization-scheme` · writeback 唯一写闸 · ≤5 用户概念  
> **方法**：对照 shipped Kernel + Desktop 代码与既有测试，每条 finding 必须有处置。

---

## 0. 结论摘要

| 维度 | 判定 | 说明 |
|------|------|------|
| AI 分层（会话 / 行内 / 建议规则 / AI 建议 / ops） | **健康** | 与 Reset §1 AI 能力分层一致；无第二写闸 |
| 写回 + confirm | **健康** | 耐久 AI 写经 writeback；high-impact 经 `suggestion-gate` |
| activity-window 共用 | **健康** | suggest / todo / ai-ops 同一窗口语义 |
| fingerprint / force / hash | **健康** | suggest 指纹 + todo `processedHashes`（**prompt corpus**＝周期∪活动 extras，非 raw-only）+ ops force |
| 多路 AI 并发（agent · suggest · todo） | **健康** | background lane 串行 prep；agent 独立；soft `agent_busy`；StatusBar multiActive |
| sanitize / 空 AI 诚实 | **健康** | `ai-content-sanitize` + 失败不写 / reason 码 |
| Agent 人设 + 渐进上下文 | **健康** | skill-first prompts · context-loader · session compact 240K/60 |
| **todo complete 匹配** | **有缺口 → fix** | 拉丁词碎片回退可误标完成 |
| **AI context frontmatter** | **有缺口 → fix** | profile/topic 去 frontmatter 不认 CRLF |
| **Stream 展示转义** | **有缺口 → fix** | `\[ \]` 已修；`\-` 列表子弹 仍脏 |
| Stream 解析 / 增补 / 整理 | **健康** | soft-split · CRLF · reconcile 用户触发（非静默改用户文） |
| embedding / 全库 Ask | **non-goal** | Reset 已锁 |

**架构师**：主路径已合闸；本轮修边缘正确性（匹配、CRLF 上下文、展示转义），不重做 AI 运行时。  
**用户**：建议确认 / 待办维护 / 动态 feed 可用；误完成待办与脏转义会伤信任，优先修。

---

## 1. AI 能力地图（对照代码）

| 能力 | 实现入口 | 写闸 | 状态 |
|------|----------|------|------|
| Agent 会话 `ai.invoke` | Desktop `ai-service` + `ai-prompts` + tools | tool → WorkspaceService → writeback | Done |
| 行内 AI | `inline-complete-prompt` + `sanitizeInlineAiResult` | 回填编辑器；落盘走 save | Done |
| 建议条规则 + AI | `lib/suggest-engine` + ActionStore | apply + gate | Done |
| todo maintain / extract | `lib/todo-engine` + TodoStore | executeWrite actor ai/user | Done（corpus hash · force · extras 排除 memory/todo · Desktop progressive force 再点 ✨） |
| memory_organize / topic_classify | `lib/ai-operation-engine` | writeback | Done |
| activity-window | `lib/activity-window` | 只读窗口 | Done |
| fingerprint | `lib/suggest-fingerprint` | 系统平面 | Done |
| sanitize | `lib/ai-content-sanitize` | 策略纯函数 | Done |
| context progressive | `ai-context-loader` + assembleContext | 只读注入 prompt | Done（F2 CRLF） |
| session compact | `ai-session-compact` | 会话态 | Done |
| 人设 | `ai-prompts.buildSystemPrompt` 中文 skill-first | — | Done intentional |

---

## 2. Stream 能力地图

| 能力 | 实现 | 状态 |
|------|------|------|
| 默认主表面 stream | PrimaryNav + StreamDetailView | Done |
| 周期解析 soft-split | `stream-period-parse` | Done |
| 增补 append | `activity-window` + 画布续写 | Done |
| 展示 MD 预览净化 | `prepareStreamMarkdown` | Done + F3 转义增强 |
| 整理 / reconcile | TaskStore + organize-week + 用户 CTA | Done（不静默改文） |
| 格式错乱「自动写回优化」 | 仅 reconcile 用户确认路径 | **intentional keep** — 文件真源；展示层 normalize 可进，写回需用户 |

---

## 3. Findings

| ID | 严重度 | 区域 | 问题 | 处置 |
|----|--------|------|------|------|
| **F1** | **med** | todo-engine maintain complete | 完成匹配用「任一 ≥3 字母词命中 complete 文案」→ 如 *Buy milk* 被 *I will buy groceries* 误完成 | **fixed** — `matchTodoMaintainText` |
| **F2** | **med** | ai-context-loader | profile/topic frontmatter strip 仅 `\n`，CRLF 工作区整段 YAML 进入 system prompt | **fixed** — `stripFrontmatterForPrompt` |
| **F3** | low | stream-period-parse | `normalizeStreamEscapes` 未还原 `\-` / `\*` 列表转义，feed 显示脏 | **fixed**（仅展示层） |
| **F4** | — | writeback / confirm / gate | 主路径正确 | **intentional keep** |
| **F5** | — | force / fingerprint / processedHashes | 已有 force + hash 变更重扫 | **intentional keep** |
| **F6** | — | 空 AI / sanitize 失败 | reason 码；不写污染 | **intentional keep** |
| **F7** | — | Agent 人设中文 + skill-first | 产品默认中文；i18n 系统 prompt = Non-goal | **intentional keep** |
| **F8** | — | 静默全量 auto-reconcile 写回 | 与文件真源冲突 | **non-goal**（保持用户触发） |
| **F9** | — | embedding / 全库 Ask | Reset | **non-goal** |
| **F10** | — | 第二套 suggest UI | 已合闸 SuggestPopover | **intentional keep** |

---

## 4. 用户视角（Stream + AI）

1. **记一下** → 周期本；feed 按日/条目可读  
2. **建议** → 💡 / strip → 确认 → 写闸  
3. **待办** → 维护不因松匹配误勾完成  
4. **格式脏** → 展示尽量干净；真要改文件用「整理本周」  
5. **AI 人设** → 工作台助手，不编造工具、skill-first  

---

## 5. 与既有文档

- 实施锁仍为 `ARCHITECTURE-RESET`  
- Stream 真理：`stream-first-optimization-scheme.md`  
- 本文件只记 AI/Stream 点时评估与本轮 fix  
