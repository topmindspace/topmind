# 工作区工具与日志 — 已落地，不再作为第二份规范

> **状态**：已吸收进 `docs/ARCHITECTURE-RESET.md` §2.2。本文件只留决定。

工作区菜单和 ⌘⇧L 打开同一块面板：概览、操作日志、`main.log`、契约健康、清理预览。`ops.jsonl` 是支持日志，不是第二套写回回执。写回、备份和回执仍只走 Kernel `writeback-engine`。

面板行为以 `topmind-desktop/DESIGN.md` 和已提交的实现为准。不要在这里重写交互稿。
