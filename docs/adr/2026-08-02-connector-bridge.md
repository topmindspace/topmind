# ADR: ConnectorBridge — Desktop 连接器共享契约

**Date:** 2026-08-02  
**Status:** Accepted（已落地 `topmind-desktop/electron/lib/connector-bridge.mjs`）  
**Context:** WereadService 与 XService 各自重复实现 settings+secret 加载、settings patch 持久化、frontmatter 注入 + `kernelDurableWriteAbs` 落盘调用；未来连接器（RSS / Readwise 等）会再次复制这套样板并可能绕过写闸约定（actor/confirmed/operation 元数据）。

## Decision

1. **共享模块** `electron/lib/connector-bridge.mjs`：
   - `loadConnectorSettings(ctx)` — settings + secretAdapter 水合；
   - `persistConnectorPatch(ctx, key, patch)` — 按连接器 key（`weread` / `x`）合并写回 + 刷新内存快照；
   - `writeConnectorNote(ctx, { absPath, body, frontmatter, operation })` — 统一 frontmatter 注入 + kernel 写闸（`actor: "user", confirmed: true`）；
   - `sleep(ms)` — 分页节流。
2. **服务只保留 API 特有逻辑**：weread（gateway 调用、分页、指纹跳过、预算）；x（Bearer/xurl 双层能力探测、tweet 归一化）。类别落点继续走既有 `connector-category.mjs`。
3. **新连接器接入规范**：实现 `{ getStatus, testConnection, sync* }` RPC 方法对象 + 复用 bridge helpers；**禁止**直接调用 `kernelDurableWriteAbs`/`injectFrontmatter` 组合（必须经 `writeConnectorNote` 保证写闸元数据一致）。

## Consequences

- weread/x 两服务删除 ~60 行重复样板；写闸元数据单点维护。
- bridge 是薄工具层而非基类 —— 两个连接器 API 形态差异大，继承层次收益为负，故选组合。

## Verification

`topmind-desktop` 测试套（weread-notes / x-normalize / desktop-confirm-writeback 契约）全绿；lint 无 unused import。
