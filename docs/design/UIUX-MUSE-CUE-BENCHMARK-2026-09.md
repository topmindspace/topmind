
---

### 二十一次 UTR / Clip / Skills 一致性（2026-09-29 · 全表面）

| 级别 | 面 | 发现 | 修复 |
|------|----|------|------|
| **P0 安全** | UTR | `restore-safety-receipt` 路径逃逸（`../` 读任意文件 + 写出工作区） | 源/目标双侧 `isPathInsideWorkspace` 围栏 |
| **P0 安全** | UTR | `memory.promote` 任意本地文件读入 memory/topics | 同上围栏 |
| P1 | UTR | `contract.reseed` 走 danger exposure 但绕过分级 confirm | `isLifecycle` 纳入 `exposure==="danger"` |
| P1 | UTR | 写回模式默认 auto，忽略 `topmind.yaml writeback.mode` | `contractMode` 回退链：payload → option → env → **contract** |
| P1 | UTR | 高风险备份把 `topmind.yaml`/`memory` 解析到 engineRoot（快照为空） | workspace-plane 归 userWorkspaceRoot |
| P1 | UTR | 围栏纯词法、symlink 可绕 | 边界判定对齐 `..` 前缀语义 |
| P1 | Clip | `content`+`content_html` 合计 > bridge 2MB 上限 → 413 | 有 HTML 时 plain 只留 120KB 预览 |
| P1 | Clip | popup `innerHTML` 裸拼工作区 id | 改 DOM `createElement`/`textContent` |
| P2 | Skills | `pan-style.md` 写成本地路径 | 改 `qu-aiwei-zh/references/…` |
| P2 | Skills | router 引用 `shared/` 深度错误 | `../../shared/…` |
| P2 | Skills | 「记下/Log it」触发词缺口 | 消歧表补对译；frontmatter 仍锁「记一下」（测试合同） |
| 测试 | 根 | memory-feed tsconfig 断言过严 · README.zh-CN 漂移 · obsidian lock 版本 | 对齐 glob / 同步副本 / 4.17.0 |

**已知遗留**：UTR tools 硬编码 `actor:"user"`（CLI 语义正确；MCP agent 路径应传 `actor:"ai"`）——需 ctx 贯通，留待下一波。

**测试**：root 667 · UTR 148 · desktop 1362 · skills 47 — 全绿。

---

### 二十二次 actor 贯通 / P2 收尾（2026-09-29）

| 项 | 发现 | 修复 |
|----|------|------|
| **P1 遗留** | UTR tools 硬编码 `actor:"user", confirmed:true` —— agent 路径绕过 kernel 分级 confirm | `resolveActor()`/`isUserActor()` 经 `topmind_ACTOR` 贯通；CLI=user，MCP=`actor:"ai"` |
| P2 | `parseArchiveRelRoot` 硬编码重复根名（含重复 `99-Archive`） | 改用 `ARCHIVE_ROOT_NAMES` 单真源 |
| P2 | 围栏错误硬编码英文 | 接 `error.traversalDisallowed` 双语 |
| P2 | Clip 死 i18n `clip_via` · 缺 `mode_label_highlights` · 无用 `id="mode-article"` | 删 / 补 / 去 id |
| 测试 | actor 贯通 + fail-closed 锁 | `resolveActor` 单元测试 |

**测试**：root 667 · UTR 149 · desktop 1362 · skills 47 — 全绿。
