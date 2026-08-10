# ADR: Pi（pi.dev）作为 Desktop 核心智能体底座 — 再评估结论

**Date:** 2026-07-21  
**Status:** Accepted（维持既有 runtime 边界）  
**Surfaces:** Desktop AI · Skills pack · 外部 agent host  

## Context

Desktop AI 使用 Vercel AI SDK v7 + skill-first + WorkspaceService 领域工具（~2.4k LOC 主进程 AI 栈）。有观点认为应引入更自由的智能体底座（Pi / pi.dev / `@mariozechner/pi-*`），把通用 agent 能力「让派做」，以降低产品侧复杂度。

既有相关决策：

- `2026-06-14-desktop-ai-runtime.md` — 内嵌 = AI SDK；Pi 等为外部 harness  
- `2026-07-16-desktop-agent-harness-upgrade.md` — 吸收 Pi 风格 edit/compact/steer，**不**嵌入 `pi-coding-agent`  

本次对 Pi v0.73.x（SDK / RPC / skills / packages）做再评估。

## Decision

1. **不以 Pi 为 Desktop 产品内核**（不嵌入 `pi-coding-agent`，不默认 bash 工具链）。  
2. **本周期不引入** `pi-agent-core` 适配层、topmind Pi Package 工程、RPC 自由体模式。  
3. **维持**：内嵌 AI = AI SDK v7 · skill-first · `buildDesktopAiTools` → WorkspaceService 写回。  
4. Pi / OpenCode / Codex / Hermes 继续为**可选外部 host**；用户可自行安装使用，产品不承诺一等集成、不绑 Pi 版本。  

## Rationale

| 点 | 说明 |
|----|------|
| 复杂度归属 | 约 40% 领域模型 + 20% 领域工具 + 15% skills 协议 — **换底座消不掉**；派主要吃通用 harness（~20%） |
| 产品边界 | 知识台 = 类别/专题/写回伦理/备份回执；coding agent 默认 shell 与无内建权限系统冲突 |
| 可移植 Skills | Pack 须继续在 Claude/Codex 等 host 可用，不得被 `~/.pi` 路径绑架 |
| 升级成本 | Pi 0.x 高频发版；全量核心耦合会使独立升级变难，而非变易 |
| 「让派做」正确形态 | 复杂自由任务在**用户本机 Pi 进程**；Desktop 保留工作台副驾 |

## Non-goals（本周期）

- 不新增 `@mariozechner/pi-*` 依赖  
- 不抽 AgentRuntime 可插拔抽象（除非未来另立任务）  
- 不把 `~/.pi` session 当内容真源  

## Re-open triggers

仅当出现可观测条件时再评估 Phase（外部 Pi package / `pi-agent-core` 试点），**不**因 Pi 小版本自动重开：

1. AI SDK 路径出现结构性缺陷且修复成本明显高于适配 Pi core  
2. 明确产品需求「自由智能体模式」且接受外部进程或双轨 UX  
3. 有维护 pin + adapter + 回归的季度升级预算  

重开时优先：外部 host 一等文档 → 可选 `pi-agent-core` flag；避免直接全量 coding-agent 内核。

## Consequences

- Desktop AI 继续小步增强 harness（compact/steer/prompt），不换底座  
- 文档与 `TOOLS.md`「不内建平行 generic agent runtime」精神保持一致  
- 评估细节归档于决策过程；实现侧零依赖变更  
