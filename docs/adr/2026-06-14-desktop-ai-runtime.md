# ADR: Desktop Embedded AI Runtime

**Status:** Accepted · **Date:** 2026-06-14  
**Supersedes:** none · **Related:** 2026-07-21 Pi decision (reaffirm)

## Decision

Desktop 内嵌 AI 使用 **Vercel AI SDK v7**。  
Pi / OpenCode / Codex / Hermes 等是**可选外部 agent harness**，不是 Desktop 核心运行时，也不拥有内容写回权威。

## Rationale

Desktop 是 TypeScript + React + Electron。内嵌 AI 需要多 provider、流式 UI、工具调用与结构化输出。AI SDK 与该栈匹配。

外部 harness 适合脚本化 / 终端 / 技能执行，但不得成为工作区内容真源。

## Boundaries

| 层 | 选型 |
|----|------|
| Desktop 内嵌 AI | AI SDK v7（`electron/ai-*.mjs`） |
| AI 写回工具 | **Desktop-native** → WorkspaceService（不经 UTR） |
| 确定性 CLI/MCP（可选） | UTR |
| 外部 harness | Pi / OpenCode / Codex / Hermes 等，可替换 |
| 持久化内容 | 文件系统 + 回执 / 备份 / 修订副本 |

## Dependency Policy

- AI SDK 与 providers：常规维护跟 patch 线  
- AI SDK / Electron / React / Vite / TypeScript 等 **major**：需设计审查 + 本 ADR 更新  
- 外部 harness 适配器可快速迭代，但必须可替换  

## Status

Accepted. 与 `PRODUCT-BOUNDARIES.md` 一致：UTR 对 Desktop 可选。
