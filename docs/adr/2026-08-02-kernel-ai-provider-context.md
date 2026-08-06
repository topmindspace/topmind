# ADR: Kernel AiProviderContext — per-call AI provider 注入

**Date:** 2026-08-02  
**Status:** Accepted（已落地 `lib/derived-builder.mjs` + `lib/kernel-api.mjs`）  
**Context:** derived-builder / suggest-engine 曾用模块级 `let aiProvider` 单例（`setAiProvider()`）。同进程多工作区（或并行任务）会互相覆盖 provider，且测试需要串行重置全局状态。

## Decision

1. **per-call 注入优先**：`buildTopicDerived` / `buildPeriodDerived` / `rebuildAllDerived` 接受可选 `aiProvider` 参数；内部 `resolveProvider(provider)` 规则 = 显式传入 > 模块级单例 > null（占位回退）。
2. **`createKernelContext({ workspaceRoot, engineRoot, contract, aiProvider })`**：kernel-api 新增工厂，返回把 workspaceRoot / contract / aiProvider 预绑定的方法集（generateSuggestions / applySuggestion / rebuildAllDerived / buildTopicDerived / buildPeriodDerived / runOperation）。多工作区各持一个 context，互不干扰。
3. **向后兼容**：`setAiProvider` / `getAiProvider` 在 Kernel 层保留（单进程单工作区场景行为不变）。**更新（2026-08-06）**：Desktop 已删除 `wireKernelAiProvider` 接线，`electron/ai-provider-adapter.mjs` 改为导出 `createKernelAiProvider(settings)` 工厂，全部调用点（suggest / applySuggestion / todo / ai-ops / derived）纯 per-call 注入，无全局单例。

## Consequences

- 多工作区/并行安全；测试可注入 fake provider 而不污染全局。
- Desktop 后续可迁移到 per-window `createKernelContext`（非本次范围）。

## Verification

`tests/kernel-api.test.mjs`（createKernelContext binds workspace + per-call AI provider）；`tests/derived-builder.test.mjs` 全绿。
