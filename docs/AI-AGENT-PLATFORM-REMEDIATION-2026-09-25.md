# AI 智能体平台全面整改方案（2026-09-25）

> **状态**：Accepted · **角色**：实施真源（本波次）  
> **范围**：topmind Desktop AI · Kernel agent 协议 · Obsidian 插件 · Skills 一致性 · UI/UX  
> **相关**：`docs/adr/2026-09-25-goal-oriented-agent-loop.md` · `docs/adr/2026-09-07-pi-engine-and-three-column-reevaluation.md` · `docs/ARCHITECTURE-RESET.md`  
> **北极星不变**：最低摩擦个人动态流；用户概念 ≤5；Kernel writeback 唯一写闸；不重复造轮子。

---

## 0. 调研结论（四路并行审计）

| 路 | 结论一句话 |
|----|-----------|
| **Pi 0.87.1 原生能力** | 只用了 ~20% 面；`getFollowUpMessages` 被 Agent 构造静默忽略；steer 双注入；双压缩栈 |
| **Desktop Autopilot** | 「有界目标感知 runner」已成型，但 GoalState 跨 auto-continue 被 clobber、跨用户轮次丢失、无任务账本 UI、停止原因不诚实 |
| **Obsidian 插件** | P0：`stripThinking` 正则损坏、pending-writes 非持久、memory fence 漏 ledgers/inbox、目标 chip 可假成功；工具面 14/38（整改后 **29/38**）；无 token 流式（平台约束） |
| **业界实践** | 独立 evaluator 判目标（非自评）；压缩保留原文+重注入 plan/memory；Queue/Steer/Stop；记忆双层（人写指令 vs 自动记忆）+ 索引硬帽 |

### 0.1 必须立即承认的现状

上一会话已有大量 **未提交 WIP**（goal protocol 三副本已字节一致、profile CAS、memory health、Esc-to-stop 等）。本方案 **先安全落地 WIP，再按波次整改**，不推倒重来。

---

## 1. 问题诊断

### 1.1 Pi 原生能力未吃透（不重复造轮子）

| # | 问题 | 证据 | 影响 |
|---|------|------|------|
| P-1 | `getFollowUpMessages: createGoalFollowUps(...)` **被忽略** — `Agent` 只 drain 内部 `followUpQueue` | `ai-pi-runtime.mjs:574` vs `pi-agent-core/dist/agent.js:335` | 目标 in-run 续跑从未生效 |
| P-2 | steer **双注入**：`registry.steers` + `agent.steer()` 同时推 | `ai-stream.mjs:86` + `ai-pi-runtime.mjs:559` | 用户指令可能重复进入上下文 |
| P-3 | 双压缩栈：自研 `ai-session-compact.mjs` 与 Pi `compact/estimateTokens` 并存 | `ai-service.mjs` 与 `ai-pi-runtime.mjs` 分叉路径 | token 估算不一致、压缩语义分叉 |
| P-4 | `finishTurn` 未按 README 守卫 `stopReason error\|aborted` | `ai-pi-runtime.mjs:519` | 失败回合被计入目标进度 |
| P-5 | 未用：`Session/JsonlSessionRepo`、`loadSkills`、`SessionSearchService`、`afterToolCall`、`Agent.sessionId` cache、branch summary | pi 包导出面 | 会话持久化/技能加载/检索自造轮子 |
| P-6 | Pi 路径 **无 timeout/idle** | `ai-pi-runtime.mjs` 无计时器 | 挂起只能靠用户发现 |

**保留（有意不采纳）**：bash 工具、无围栏 FS、`~/.pi` 当内容真源、full coding-agent、pi-ai 取代 AI SDK v7（ADR 2026-09-07）。

### 1.2 Desktop Autopilot 十二缺口

| ID | 缺口 | 优先级 |
|----|------|--------|
| **G1** | GoalState 被 per-run 内层 **clobber**（`ai-service.mjs:672-673` 替换而非 merge）；auto-continue 后 plan/criteria 丢失 | **P0** |
| **G2** | GoalState per-invoke，不跨用户轮次/重启；`message.goal` 未回传 | **P0** |
| G3 | 无任务账本 UI；`taskLedger` 死代码；计划步骤/验收项不可见不可勾 | P1 |
| G4 | cancel/timeout 不诚实；invoke `ok:true` 无 `cancelled`；Pi 无超时 | P0 |
| G5 | `stepLimitHit` 无视已完成强制 continue | P1 |
| G6 | 续跑预算耗尽未 terminalize（可停在 neither done nor incomplete） | P0 |
| G7 | `blocked`/需用户输入状态 **零写入者** | P1 |
| G8 | 溢出压缩只重试 1 次且 tools-gated | P1 |
| G9 | 压缩对用户不可见（只 spinner） | P2 |
| G10 | in-run follow-up 因 G1/P-1 实际失效 | P1 |
| G11 | 无 session→memory 自动蒸馏闭环（`memoryDistillHint` 无人消费） | P2 |
| G12 | 测试多为源码正则，缺行为测试 | P1 |

### 1.3 Obsidian 优先缺口（摘要）

**P0**：`stripThinking` 写成 `<ink>`（`kernel-workspace-ops.ts:919`）· pending-writes 丢弃 · memory fence 漏 `memory/ledgers/` 与 `inboxRelativePath` · goal chip 正则假「目标达成」  
**P1**：工具 14/38 · `decideAutoContinue` 死 import · `contextLimit` 从未传入 · 压缩无 token/目标保留 · 无流式/steer · 无 skills · 无工具名双向锁测试  
**P2**：软中止 · chips 截断 · regenerate 重复历史 · 错误无重试  
**有意非缺口**：无 ops journal、无记账 mini-app、无记忆三件套 chat 工具（走 Suggest）、Node fs 写闸、Desktop-only

### 1.4 记忆 / 技能 / 任务一致性（待 explore-4 收口后补全）

已知：
- 记忆：Desktop chat 有三件套；Obsidian 走 Suggest；UTR 已补 retire/update/compact/restore；profile CAS 是 WIP
- 技能：Desktop `formatSkillsForSystemPrompt` + load_skill；Obsidian 零 skills；portable pack 独立
- 任务：`TaskStore`=引擎后台作业 ≠ Agent 计划；GoalState 与 todo.md 分离

---

## 2. 目标架构（整改后）

```text
┌─ 用户目标 ──────────────────────────────────────────────┐
│  自然语言任务 / 继续 / 中断 / 纠偏                          │
└───────────────────┬─────────────────────────────────────┘
                    ▼
┌─ Goal & Task Layer（共享 · lib/agent-goal-protocol + 扩展）─┐
│  GoalState 会话级持久  · Plan/criteria 可见可勾            │
│  独立评估器（或启发式 + 可选小模型）→ met|not_met|impossible │
│  stop reasons: done | incomplete | blocked | cancelled |    │
│                timeout | budget_exhausted                  │
└───────────────────┬─────────────────────────────────────┘
                    ▼
┌─ Agent Runtime ──────────────────────────────────────────┐
│  Desktop: pi-agent-core Agent                             │
│    · finishTurn 步数闸 + error/aborted 守卫                │
│    · agent.followUp() 真续跑（修 P-1）                     │
│    · 单一 steer 路径（修 P-2）                             │
│    · Pi compact 为主 + 自研 fold 兜底（统一 token 估算）    │
│    · timeout/idle 双保险                                   │
│  Obsidian: 轻量工具环 + **同一 Goal 协议/续跑/压缩预算**    │
│    · 工具面扩到与 Desktop 对齐（除有意差异）                 │
│    · 流式（能则 token 级，不能则逐步进度诚实）               │
└───────────────────┬─────────────────────────────────────┘
                    ▼
┌─ Kernel（唯一领域逻辑 · 写闸不变）────────────────────────┐
│  writeback · memory（profile CAS/health）· todo · suggest  │
│  goal 协议 helpers · compact budget · 输出语言              │
└───────────────────┬─────────────────────────────────────┘
                    ▼
┌─ Workspace 三平面（不变）─────────────────────────────────┐
│  内容 / memory 语义 / topmind.yaml + .topmind               │
└───────────────────────────────────────────────────────────┘
```

### 2.1 核心产品行为（用户可见）

用户提出任务目标后，智能体应：

1. **设定目标** — 写出 `[PLAN]`（步骤 + `done-when` 验收项）
2. **拆分规划** — 可在 UI 看到计划/验收清单
3. **执行** — 工具调用 + 路径回执；接近上下文上限时**主动压缩**（保留任务账本）
4. **持续推进** — 更新任务状态 / 目标；未完成验收项自动续跑（有界，默认 2/最多 4）
5. **结束** — 真正完成（有证据）→ `done`；真失败 → `incomplete` + 原因；需用户 → `blocked`（停下等输入）
6. **随时可中断** — Stop/Esc 取消（诚实标注 cancelled）；可 Steer 纠偏；可 Queue 排队

---

## 3. 整改原则

1. **不重复造轮子** — Pi 原生优先（compaction、followUp、steer、skills format、session 可选）；领域工具/写闸/可移植 Skills 仍是我们自己的，不换成 bash
2. **目标协议是共享内核** — `lib/agent-goal-protocol.mjs` 唯一真源；Desktop/Obsidian 字节同步（已有 parity 测试）
3. **诚实优先** — 禁止假成功；停止原因可区分；压缩可感知；cancel ≠ timeout ≠ incomplete
4. **写闸与围栏不变** — writeback 唯一写闸；memory fence 对齐；locked/confirm 策略延续
5. **Surface 不平行实现业务语义** — Obsidian 可薄，但协议/预算/语言/围栏必须同源
6. **果断删坏方案** — clobber、死 import、双注入、损坏正则、源码正则冒充行为测试
7. **质量门当场过** — `desktop:quality` / Obsidian `npm test` / root `npm test`

---

## 4. 分波次实施

### Wave 0 — 安全落地 WIP + 修致命 bug（P0）

| 项 | 动作 | 验收 |
|----|------|------|
| W0.1 | 修 `stripThinking`：`<ink>` → `thinkable` 正确构造；Desktop/Obsidian 提示词「ink」文案改为「think」 | 思考块不进工具解析/目标评估 |
| W0.2 | 落地/校验 WIP：goal protocol 三副本、profile CAS、memory health、Esc-to-stop | 三仓 test 绿 |
| W0.3 | Obsidian memory fence：允许 `memory/ledgers/`；检查全部 path 形参（含 `inboxRelativePath`） | 对齐 Desktop `memory-fence.mjs` |
| W0.4 | Obsidian pending-writes 持久化到 `.topmind/pending-writes.json`（对齐 Desktop 语义：满则拒新，不静默丢） | 重启不丢待确认写 |
| W0.5 | 修 P-2 steer 双注入：只走 `agent.steer()` **或** registry，单路径 | 单测断言不双推 |
| W0.6 | 修 P-1 follow-up：改用 `agent.followUp(msg)`；删除无效 `getFollowUpMessages` 配置 | createGoalFollowUps 真触发 |
| W0.7 | `finishTurn` 加 `stopReason` error/aborted 守卫 | 失败回合不污染 GoalState |

### Wave 1 — Autopilot 核心（Goal 连续性 + 停止诚实）

| 项 | 动作 | 验收 |
|----|------|------|
| W1.1 | **G1 修复**：外层 GoalState **merge** 而非 replace；内层 Pi run 启动时从历史折叠 `[PLAN]`/done-when（或传入外层 state） | auto-continue 后 plan/criteria 仍在 |
| W1.2 | **G2**：GoalState **会话级**存储（随 session 消息持久化）；invoke 接受 `priorGoal` / 从历史恢复 | 「继续」不丢原验收项 |
| W1.3 | **G6**：预算耗尽 → `status=incomplete` + `blockReason=budget_exhausted`；UI 明确 | 不再出现无终态 |
| W1.4 | **G4**：invoke 返回 `cancelled/timeout/stalled/stepLimitHit`；UI 标注；Pi 路径加 wall-clock + idle 双保险 | 取消/超时/挂起可区分 |
| W1.5 | **G5**：`stepLimitHit` 仅在非 `done` 时强制 continue | 已完成不空转 |
| W1.6 | **G7**：`blocked` 可写 — 模型显式 `[NEEDS-USER reason]` 或 confirm 阻塞时置位 | 「需要你」一等公民 |
| W1.7 | **G8**：溢出压缩重试上限提到 2–3 次；无 tools 也可压缩重试 | 超长上下文可恢复 |
| W1.8 | 目标评估升级：优先独立启发式（已有）+ 可选外部小模型 evaluator（`met\|not_met\|impossible`+reason）；**禁止仅凭 `[DONE]` 宣称成功** | 与业界 /goal 对齐 |
| W1.9 | 行为测试：GoalState 跨 continue / 跨轮次 / cancel / budget 穷尽 | 去掉纯正则测试依赖 |

### Wave 2 — Pi 原生能力深度接入

| 项 | 动作 | 验收 |
|----|------|------|
| W2.1 | 统一压缩：Pi `shouldCompact/prepareCompaction/compact/generateSummary` 为主；自研 fold 仅兜底；统一 `estimateTokens` | 一套 token 语义 |
| W2.2 | 压缩非破坏：保留原文于 session JSON（现有 messages 文件即原文）；投影摘要；压缩事件 UI 可感知（「已压缩历史，保留目标/回执」） | G9 |
| W2.3 | `loadSkills` / `formatSkillsForSystemPrompt` 与 catalog 映射打通；Obsidian 复用同一 skill 描述面（或共享 skills 路径） | 技能加载一致 |
| W2.4 | 评估 `JsonlSessionRepo` 替换自研 session JSON（可选，独立 PR）；至少对齐 compaction entry 语义 | 减少会话轮子 |
| W2.5 | `Agent.sessionId` 传给 provider 做 cache 亲和；`afterToolCall` 做工具审计/证据 | 性能+可追溯 |
| W2.6 | 删除死代码：无效 getFollowUpMessages 注册、重复 compact 入口、Obsidian dead import | dead-code 检查 0 |

### Wave 3 — 记忆与技能一致性

| 项 | 动作 | 验收 |
|----|------|------|
| W3.1 | 会话结束 → `memoryDistillHint` 自动进入 **建议** 轨道（confirm-gated，不静默写） | G11 半自动闭环 |
| W3.2 | 记忆面诚实：Desktop 三件套 vs Obsidian Suggest 差异写进协议文档 + 设置说明；可选 Obsidian 启用三件套（与 Desktop 同围栏） | 用户可预期 |
| W3.3 | Skills：pack `command_count`/mcp 与 TOOLS.md 对齐测试；Desktop/Obsidian/UTR 词汇表统一 | 契约不漂 |
| W3.4 | 技能加载规约：progressive disclosure 三阶段在 Desktop 与（新增）Obsidian 一致；`load_skill` 资源路径围栏 | 不裸读引擎路径 |
| W3.5 | 任务三义分层文档化：Agent Goal/Plan · 引擎 TaskStore 作业 · 用户 todo.md；UI 命名不混用 | 概念清晰 |

### Wave 4 — UI/UX（对话与工作过程）

| 项 | 动作 | 验收 |
|----|------|------|
| W4.1 | **任务账本面板**：计划步骤 + done-when 清单 + 状态勾选展示（只读优先；可后续可编辑） | G3 |
| W4.2 | **中断三件套**：Stop（取消）· Steer（纠偏）· Queue（排队）；Esc 一致；取消标注 | 业界对齐 |
| W4.3 | 进度条：elapsed / turns / 续跑次数 / 当前步骤 / 需输入徽章 | 长任务可感知 |
| W4.4 | 工具时间线：失败可见、路径可点、超 12 可展开、摘要可见 | Obsidian P2 |
| W4.5 | 压缩/继续/预算事件进 timeline（非仅 spinner） | G9 |
| W4.6 | 错误行内可重试；regenerate 截断历史不重复 | Obsidian P2.4/2.5 |
| W4.7 | a11y：live region、focus 管理、对比度 token 纪律 | 已有部分 |

### Wave 5 — Obsidian 全面对齐

| 项 | 动作 | 验收 |
|----|------|------|
| W5.1 | `decideAutoContinue` 真调用（删手搓决策） | 与 Desktop 同门 |
| W5.2 | `contextLimit` 端到端：model → chat → `resolveChatCompactBudget` → 磁盘历史 | P1.3/1.4 |
| W5.3 | 工具面扩展：读/发现/技能/HTTP/lifecycle/create/move/publish；**记忆写工具策略见 W3.2**（不注册） | **已落 29/38**（有意缺口 9：6 记忆写走 Suggest + `load_skill_resource`/`reconcile_week`/`create_dir`/`copy_file`） |
| W5.4 | 工具名双向锁测试（prompt ↔ registry） | 对齐 Desktop inventory 测试 |
| W5.5 | 目标 chip 用结构化 goalState（禁用正则宣称成功） | P0.4 |
| W5.6 | 压缩深度对齐：token 估算、目标保留、中间摘要 | P1.5 |
| W5.7 | 流式：优先 requestUrl 流式/SSE 或分块；做不到则逐步 tool 进度 + 诚实「无 token 流」 | P1.6 |
| W5.8 | 文档：ARCHITECTURE/DESIGN/设置文案与行为同步 | P3 |

### Wave 6 — 跨表面一致性与质量

| 项 | 动作 | 验收 |
|----|------|------|
| W6.1 | goal-protocol / memory-fence / compact-budget / 工具名 **parity 测试** 固化 | 漂移即红 |
| W6.2 | `docs:guard` + 各仓 validate 全绿 | CI |
| W6.3 | AGENTS.md / ARCHITECTURE-RESET 分数卡更新为诚实状态 | 文档=真相 |
| W6.4 | 删废弃：源码正则伪测试、死配置、过时文案 | 精简 |

---

## 5. 明确不做（本波次）

- 不换 full `pi-coding-agent` / 默认 bash / `~/.pi` 当真源
- 不引入 embedding / 全库 Ask（仍 Non-goal）
- 不把 Obsidian 变成 Desktop 皮（保持 Obsidian-native）
- 不做多用户云同步、移动端
- 不自动静默写记忆（仍建议 → 确认）
- 不做事务性多文件回滚（路径回执 + 诚实 incomplete 仍是恢复模型）

---

## 6. 验收判据（产品层）

用户提出一个多步目标后：

1. 能看到 **计划与验收项**
2. 跑到一半上下文变长，**自动压缩并继续**，不丢目标
3. 中途 **Esc/Stop** 能停，界面标明已取消
4. 跑完有 **路径回执**；假 `[DONE]` 不会被标成成功
5. 真失败显示 **任务未完成** + 原因；需要用户时显示 **需要你**
6. Desktop 与 Obsidian 在目标协议/续跑/围栏/语言/压缩预算上 **行为一致**（工具面差异仅限文档化的有意项）
7. 技能加载与调用规约两侧一致；pack 契约数字与 TOOLS.md 一致

---

## 7. 实施顺序（执行时）

```
W0 致命修复 → W1 Autopilot 核心 → W2 Pi 吃透
     ↘ W5 Obsidian 对齐（可与 W2 部分并行）
W3 记忆/技能 → W4 UI/UX → W6 一致性收口
```

每波次：改代码 → 行为测试 → 质量门 → 更新本文状态 → 再下一波。

---

## 8. 状态表（随实施更新）

| 波次 | 状态 | 备注 |
|------|------|------|
| W0 | **Done** | stripThinking · steer 单路径 · follow-up 走 finishTurn continue · finishTurn 守卫 · memory fence · pending-writes 持久化 · compact-history AI 确认 |
| W1 | **Done** | G1–G11 全落：mergeGoalState · 会话 GoalState · 任务账本 · 取消/超时/卡住 · done 不空转 · budget 穷尽 · [NEEDS-USER] · 压缩×3 · 压缩文案 · 蒸馏建议轨 |
| W2 | **Done** | 压缩层级统一；`formatSkillsForSystemPrompt`；**外部 evaluator**（`buildGoalEvaluatorPrompt`/`parseGoalEvaluatorResult`/`reconcileGoalVerdicts` + ai-service 可选 judge） |
| W3 | **Done** | 记忆全生命周期 + SKILL.md + 蒸馏闭环 |
| W4 | **Done** | 取消标记 · elapsed · 压缩可感知 · Steer/Queue |
| W5 | **Done** | 工具面 **29/38**（含 glob/fetch_url/create/move/publish/skills/lifecycle）· 结构化 goal chip · contextLimit · decideAutoContinue · priorGoal 会话恢复；token 流式 = 平台约束 |
| W6 | **Done** | parity 测试 · **agent-autopilot-behavior**（G1–G8 行为）· **skills-inventory-layers** · 文档诚实 |

**验证（2026-09-26 质量核查）**：
- `topmind` root:test **650 pass / 0 fail**
- `topmind-obsidian` npm test **150 pass / 0 fail** + typecheck clean
- Desktop typecheck + check:i18n + check:undeclared + check:dead-code clean
- docs:guard ok · goal-protocol 4 副本 md5 一致 · 38 工具名 TOOLS.md/ARCHITECTURE 全覆盖
- **质检修复**：mergeGoalState open-criteria 不再被 idle 覆盖；G5 接受 evaluator `met`；Obsidian 同步；工具指南补 delete/rename

**P0 正确性修复（2026-09-26 对抗审计）**：
1. 指令文本中的 `[DONE]` 字面量不再误标目标完成（`isMetaInstructionText`）
2. Obsidian `rename_path` 走写闸（executeWrite+unlink），禁模型自确认
3. `delete_path`/`rename_path` 禁 `call.confirmed` 自批
4. memory fence 覆盖 delete/rename + `newPath`
5. `compact_core_memory_history` 工具层强制 `confirmed:false`（引擎闸生效）
6. G6 预算耗尽在 continue 前 terminalize
7. stepLimitHit 不绕过 blocked/incomplete/impossible 硬停
8. evaluator `maxOutputTokens`；`impossible` 硬停；follow-up 不在 blocked 续跑

**P1/P2 收口（2026-09-26 续）**：
- 会话 GoalState：`clearSession` 删 `.goal.json`；新任务不继承旧 plan；evaluator `met` 清空验收项
- stopReason：AbortController.reason + 中文超时/卡住分类
- 溢出重试不重复拼接失败片段；`compact` 阴影变量改名；transformContext bump idle
- Obsidian：会话 `chat-goal.json` · 续跑提示带台账 · blocked 正文诚实 · pending 检测 · `hasTools` 死三元 · `glob_files` · PATH_RE 支持 `\`

**Pi SessionRepo 评估结论（T17）**：`JsonlSessionRepo`/`StorageBackedSession` 能力完整（entries/branches/values/fork），但 Desktop 已有 session JSON + GoalState 持久且测试覆盖；**本阶段不迁移**，避免双真源。后续若需要分支/回放/usage ledger，再以独立 PR 评估（替换 `aiService.loadMessages/saveMessages`，非叠加）。

**明确留作后续**：`loadSkills` 原生加载器替换 Desktop catalog · Obsidian token 级流式（`requestUrl` 无流式 API，平台约束）· Pi SessionRepo 迁移（评估后有意不做）。

**Obsidian 工具面续扩（2026-09-26）**：`fetch_url`（requestUrl 注入）· `create_topic` / `move_to_topic` / `publish_to_outputs` · `list_skills` / `load_skill` · `glob_files` · 进度 elapsed；ARCHITECTURE 工具清单已同步。

**会话 Goal 跨轮次（2026-09-26 续）**：Obsidian `priorGoal` 同任务恢复（对齐 Desktop `.goal.json`）；`agent-goal-protocol.d.mts` 补全 `mergeGoalState`/evaluator/`NEEDS_USER_MARK` 导出；`finishTurn` error/aborted 返回 `{action:"end"}`；memory 死三元清理。
