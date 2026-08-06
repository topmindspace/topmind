# ADR: Phase D — Desktop 硬化（组件拆分 · 事件类型化 · 单队列 · RPC 校验 · AI 输出单闸）

**Date:** 2026-08-06  
**Status:** Accepted（已落地，全质量门绿）  
**Context:** Wave M / S* 合闸后，Desktop 渲染层与桥接层积累一批结构性债：四个大组件单文件超 400–1100 行难以评审；渲染层本地事件总线为裸字符串（emit/on 双侧无类型约束，改名靠 grep）；action-store 建议刷新可被事件/轮询/手动多路并发触发（重复 kernel suggest = 浪费 AI token + 列表闪烁）；rpc-bridge 对 method/params 无入参校验（原型链键可达任意函数）；AI 输出清洗逻辑散在 memory/suggest/todo/ai-ops 多处，阈值不一致；Windows 上 `tsx --test` 进程不退出导致质量门挂起。

## Decision

1. **组件拆分纪律**（单文件 ≤~300 行，逻辑外提 hooks / 子组件）：
   - `SelectionAiBar` 1140 → **294 行** + `useSelectionAi.ts`（状态机）+ `SelectionAiToolbar/Diff/Error`；
   - `QuickCapture` 900 → **210 行** + `CaptureForm/Preview/Attachments`；
   - `SettingsDialog` 600 → **119 行** + `SettingsLayout` + `useSettingsController.ts`；
   - `Shell` 400 → **229 行** + 5 hooks（`useAutoTodoMaintain` / `usePluginInit` / `useShellSettingsSync` / `useShellShortcuts` / `useWorkspaceHealth`）。
2. **本地事件类型化**：`src/lib/local-events.ts` 定义 `LocalEventMap`（事件名 → payload 类型）为唯一真源；`emitLocal` / `onLocal`（`src/plugins/host.ts`）经泛型对该 map 双侧类型检查。新事件先登记再用。
3. **建议刷新单队列**：`action-store` 所有刷新触发（事件 / 安全网轮询 / 手动 / 启动）汇入 `enqueueSuggestRefresh` 串行队列；并发调用合并（`force` 升级胜出），任何时刻至多一次 kernel suggest 通过。
4. **RPC 入参校验**：`electron/rpc-bridge.mjs` `resolveRpcTarget`（纯函数可单测）——method 必须匹配 `service.fn` 严格正则（拒绝多段/空段/非标识符）；params 须为纯对象（拒数组/字符串）；`hasOwnProperty` 阻断原型链查找（`constructor` / `__proto__`）。
5. **AI provider 纯 per-call**：删除 Desktop `wireKernelAiProvider` 接线；`electron/ai-provider-adapter.mjs` 仅导出 `createKernelAiProvider(settings)` 工厂，suggest / applySuggestion / todo / ai-ops / derived 全部按调用注入，无全局单例（Kernel `setAiProvider` 仍保留兼容，见 ADR 2026-08-02）。
6. **AI 输出单闸**：`validateAiOutput` 集中于 `lib/ai-content-sanitize.mjs`（剥离 thinking/占位 + 按目标层 `minLength` 判定）；memory-engine / suggest / todo-engine / ai-operation-engine / derived-builder 统一经此闸，失败诚实不写。
7. **AI 操作配置驱动**：`ai-operation-engine` 读取工作区契约 `agent.ai_ops`（`disabled: [...]` 隐藏操作、`options.{id}` 传参），Desktop `listOperationTypes` 同步过滤。
8. **Windows 测试根治**：desktop 测试脚本改 `tsx --test --test-force-exit`（root / skills / utr 保持 `node --test`）。

## Consequences

- 四大组件均回到可单屏评审体量；hooks 可独立单测。
- 事件改名/新增编译期报错，不再靠运行时失踪。
- 建议列表无并发刷新闪烁；AI token 消耗可预期。
- RPC 面收窄到显式服务方法；恶意/畸形 method 在入口即拒。
- AI provider 无跨工作区串扰；测试注入 fake provider 不污染全局（同 ADR 2026-08-02 目标闭环）。
- 新 ADR 覆盖的决策点此前仅有代码与测试，无文档记录——本篇补齐。

## Verification

`npm run desktop:quality`（deps → typecheck → electron → dead-code → i18n → test → build → pack:verify）全绿；新增 `topmind-desktop/tests/rpc-bridge.test.mjs`（resolveRpcTarget 正/反例）与 `utr/tests/unit/kernel-api-consistency.test.mjs`；组件行数经 `wc -l` 实测（294 / 210 / 119 / 229）。
