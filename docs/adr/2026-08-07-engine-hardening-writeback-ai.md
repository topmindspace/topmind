# ADR: Engine Hardening — Writeback 回执轮转 + AI Provider 动态参数（2026-08-07）

> **状态**：Accepted（**2026-08-08 策略增量：高影响 only**）  
> **日期**：2026-08-07  
> **范围**：`lib/writeback-engine.mjs` · `topmind-desktop/electron/ai-provider-adapter.mjs` · `ai-session-compact.mjs` · `ai-model.mjs`  
> **前置**：Kernel AI Provider Context（`2026-08-02-kernel-ai-provider-context.md`）· Writeback Engine（Architecture Reset §2.2）

## 背景

全面代码质量审视发现两类可优化点：

1. **Writeback 回执/备份噪音**：早期「AI 每次写都备份 + 有备份则回执」仍使 open 文件更新产生归档膨胀；应进一步收紧为**仅高影响**。
2. **AI Provider 参数静态**：所有 AI 操作使用相同的 temperature 和 maxTokens，未区分提取类任务（需确定性）与分析类任务（需多样性）；无重试机制，网络抖动直接失败；会话压缩参数过保守，浪费现代模型的大上下文窗口。

## 决策

### 1. 回执轮转（Receipt Rotation）

| 项 | 值 | 理由 |
|----|----|------|
| `RECEIPT_KEEP` | 50 | 保留足够恢复窗口（~50 次高影响写入），防止无限累积 |
| `pruneOldReceipts()` | 按 ISO 时间戳排序， newest-first 保留 | 确保最旧回执先被清理 |
| 触发时机 | 每次**高影响**写入回执后 | 增量清理，无需独立定时任务 |

### 2. 备份/回执策略（High-impact only · 2026-08-08）

> **Supersedes** 本节早期「AI 写入 + 有备份 → 回执 / actor=user 跳过」表述。中心判定在写闸 `isHighImpactContentWrite` + delete/archive 路径；调用方不得靠零散 `skipBackup` 拼出矛盾语义。

| 场景 | 备份？ | 回执？ | 理由 |
|------|--------|--------|------|
| open 文件 create/update（actor=ai 或 user） | ❌ | ❌ | 频繁、低风险；原子写足够 |
| locked 既有文件覆盖（user；AI 写 locked 被拒） | ✅ 旋转 `BACKUP_KEEP` | ✅ | 高影响；可恢复 |
| 删除 / 归档（非 permanent） | ✅ trash/归档副本 | ✅ | 可逆操作；恢复路径必需 |
| permanent 删除/归档 | ❌ | ❌ | 用户明确不可恢复 |
| forceBackup 显式强制（既有文件） | ✅ | ✅ | 罕见逃逸舱 |

### 3. 目录归档安全加固

| 优化 | 说明 |
|------|------|
| 原子 rename 优先 | 同文件系统 `renameSync` = 原子操作；避免 copy+rm 窗口期 |
| 跨文件系统降级 | `cpSync` + **文件计数校验** + `rmSync`；计数不匹配时回滚 |
| `countFilesRecursive()` | 递归计数验证；防止部分复制静默成功 |

### 4. AI Provider 动态参数

#### Temperature（per-operation）

| 操作类型 | Temperature | 理由 |
|----------|-------------|------|
| inbox_organize / topic_classify / memory_extract / memory_organize / todo_extract / todo_maintain | 0.3 | 提取/分类需确定性 |
| period_analysis / period_digest / topic_summary | 0.5 | 分析/摘要需自然语言但不过度发散 |
| 其他 | undefined（provider 默认） | 通用场景 |

#### System Prompt（per-operation）

结构化输出操作（inbox_organize / topic_classify / memory_organize / todo_extract / todo_maintain）自动附加简洁系统提示：
> "You are a precise content analysis assistant. Follow output format instructions exactly. Output only the requested format — no preamble, no thinking tags, no markdown code fences unless explicitly requested."

#### Max Tokens（per-operation）

| 操作 | maxTokens | 理由 |
|------|-----------|------|
| topic_summary | 8192 | 多文件摘要可能较长 |
| period_analysis / period_digest / inbox_organize / memory_organize / todo_extract / todo_maintain | 4096 | 结构化输出 |
| memory_extract / topic_classify | 2048 | 短输出 |
| 默认 | 4096 | 从 2048 提升，防止截断 |

### 5. 瞬态错误自动重试

| 项 | 值 |
|----|----|
| `isTransientError()` | 匹配 timeout / econreset / enotfound / socket hang up / rate-limit / 429 / 503 / 502 / 500 |
| `maxRetries` | 1（1 次重试，不过度重试） |
| 退避 | 800ms（避免 hammer rate-limited API） |
| 不重试 | abort / cancel（用户主动取消） |

### 6. 会话压缩适配现代模型

| 参数 | 之前 | 之后 | 理由 |
|------|------|------|------|
| `maxMessages` | 28 | 40 | 更多轮次后再压缩 |
| `keepRecent` | 12 | 16 | 更深的工作记忆 |
| `maxChars` | 56K | 80K | ~20K tokens；128K 窗口模型充裕 |
| `maxPerMessage` | — | 8000 | 防止单条过长 |

### 7. 默认模型更新

| Provider | 之前 | 之后 |
|----------|------|------|
| OpenAI | gpt-4o-mini | **gpt-4.1-mini** |
| Anthropic | claude-3.5-sonnet | **claude-sonnet-4-20250514** |
| Google | gemini-1.5-flash | **gemini-2.5-flash** |
| xAI | grok-2 | **grok-3-mini** |

## 不变项

- writeback-engine 作为唯一写闸的架构不变
- `auto` / `confirm` 写回语义不变
- protection 两档（open / locked）不变
- AI Provider per-call 注入机制（`createKernelContext`）不变
- `setAiProvider` 单例兼容不变

## 验收

- [x] `check:dead-code` 36 项全绿
- [x] TypeScript 零错误
- [x] i18n parity 通过
- [x] 根测试 9/9 通过（writeback + suggest）
- [x] Desktop 测试 45/45 通过（todo-engine + suggest-surface + uiux）
- [x] `RECEIPT_KEEP` / `BACKUP_KEEP` / `pruneOldReceipts` / `pruneOldBackups` 均有测试覆盖
- [x] `resolveTemperature` / `resolveSystemPrompt` / `resolveMaxTokens` / `isTransientError` 实现完整

---

## 增量更新（v2.1.0 · 2026-08-07）

本节记录引擎硬化 ADR 发布后的进一步调优。

### 会话压缩再次调优

| 参数 | v2.0.7 | v2.1.0 | 原因 |
|------|--------|--------|------|
| `maxMessages` | 40 | **60** | 现代 128K+ 模型支持更深对话 |
| `keepRecent` | 16 | **24** | 更广工作记忆 |
| `maxChars` | 80K | **240K** | ~80K tokens；现代模型窗口充裕 |
| `maxPerMessage` | 8000 | **16000** | 单条更完整 |
| `maxTokens` 估算 | /3.5 | **/3** | 更准确的 token-char 比 |

### Agent 步数扩展

| 参数 | v2.0.7 | v2.1.0 |
|------|--------|--------|
| `DEFAULT_MAX_AGENT_STEPS` | 12 | **20** |
| `AGENT_STEPS_MAX` | 24 | **50** |

### maxTokens 操作限制提升

| 操作 | v2.0.7 | v2.1.0 |
|------|--------|--------|
| `topic_summary` | 8192 | **16384** |
| `period_analysis` | 4096 | **12288** |
| `period_digest` | 4096 | **12288** |
| `inbox_organize` | 4096 | **12288** |
| `memory_organize` | 4096 | **12288** |
| `todo_extract` | 4096 | **12288** |
| `todo_maintain` | 4096 | **12288** |
| `topic_classify` | 2048 | **4096** |
| 默认值 | 4096 | **12288** |

### 默认模型再次更新（适配 2026 下半年模型）

| Provider | v2.0.7 | v2.1.0 |
|----------|--------|--------|
| OpenAI | gpt-4.1-mini | **gpt-4o-mini** |
| Anthropic | claude-sonnet-4-20250514 | **claude-sonnet-5** |
| Google | gemini-2.5-flash | **gemini-3.6-flash** |
| Moonshot | moonshot-v1-8k | **kimi-k2.5** |
| Zhipu | glm-4-flash | **glm-4.7-flash** |
| MiniMax | MiniMax-Text-01 | **MiniMax-M2.5** |

### derived-builder 上下文扩容

- `MAX_TOPIC_CONTEXT`: 12000 → **48000**（多文件摘要更完整）

### UI 改进

- StatusBar 统一 `v4-ai-busy-icon` + `v4-ai-busy-text` 动画（取代 `animate-pulse-soft`）
- TitleBar 新增 `TodoBadge`（未完成待办计数 badge）
- 所有 AI busy chip 统一 `v4-ai-progress-dot`

### 独立版本策略

- 各表面版本号独立（大版本对齐，小版本独立）
- UTR 跟随 Desktop；Skills / Extension 独立
- 未来 Obsidian Plugin 预留独立版本
- 仅 re-package 版本号实际变化的表面
