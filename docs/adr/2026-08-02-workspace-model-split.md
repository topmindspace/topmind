# ADR: workspace-model 拆分（facade + 4 模块）

**Date:** 2026-08-02  
**Status:** Accepted（已落地）  
**Context:** `lib/workspace-model.mjs` 膨胀至 ~1500 行 / 30+ 导出，混杂类别发现、topic 落点闸、stream 解析、memory 路径与结构变更逻辑，阅读与测试定位困难。

## Decision

按语义域拆为 4 个实现模块 + 1 个稳定门面：

| 模块 | 职责 |
|------|------|
| `lib/model-core.mjs` | PLANES / CATEGORY_PATTERN / 角色常量 · 类别发现 · config 读写 · `resolveWorkspaceModel` |
| `lib/model-topic.mjs` | topic 落点闸（reserved 类别 / 角色禁入 / `sanitizeTopicPlacement`） |
| `lib/model-stream.mjs` | `findStreamCategory` / `resolveStreamTarget` / 周期判定 / `listStreamPeriods` |
| `lib/model-memory.mjs` | `resolveMemoryPaths` / `ensureCoreProfile` |
| `lib/workspace-model.mjs`（facade） | 全量 re-export（导入面零变化）+ 结构性变更（ensureRequiredStructure / addCategory / renameCategory / writeWorkspaceMap） |

## Rules

- 外部（tests / utr / desktop / skills 文档）**只 import facade**；模块文件视为内部实现。
- `CATEGORY_PATTERN` 定义在 model-core；desktop `electron/lib/category-pattern.mjs` 契约测试对照 model-core 源。

## Consequences

- 拆分零调用方改动（166 root tests 未改动即绿）。
- 顺带修复潜在 bug：`discoverCategories` catch 分支引用未初始化 `config`。

## Verification

`npm run root:test` / `skills:test` / `utr:test` 全绿；`topmind-desktop/tests/category-pattern.test.mjs` 已同步。
