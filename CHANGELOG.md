# Changelog

topmind 仓库的版本记录。GitHub 只保留最近 2 个 Release，本文件从这次优化起记；更早的版本见 git tag。

版本真源：Desktop 是 `topmind-desktop/package.json`，UTR 跟随 `utr/VERSION`。

## 4.16.2 — 2026-10-16

### 优化

- 同一帧里的 AI 流式增量合并成一次 store 通知（`createNotifyBatcher`）。
- 相同的笔记列表、专题列表请求共用一个 in-flight。更大的 limit 不会被更小的结果截断，`includeSystem` 不同的专题读取也不再混用。
- 摄入队列只保留一个轮询器，窗口隐藏时停表，不再每 1.5 秒空转。
- 文内查找把连续按键收成一次扫描，且输入时不滚动。选区滚动用一帧合并，不在每个滚轮事件上做布局。
- 生产构建写出 `dist/entry-graph.json`。捕获启动的静态图不含 Shell、CaptureSurface、QuickCapture。
