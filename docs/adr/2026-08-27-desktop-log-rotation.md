# ADR: Desktop 支持日志轮转（2026-08-27）

> **状态**：Accepted  
> **日期**：2026-08-27  
> **范围**：`topmind-desktop/electron/lib/writeback.mjs` · `topmind-desktop/tests/log-rotation.test.mjs`  
> **前置**：Engine Hardening（`2026-08-07-engine-hardening-writeback-ai.md`，回执/备份旋转同一产品保证族）

## 背景

AI 工具调用与文件操作审计发现：备份/回执已收敛为「仅高影响 + 旋转」（`BACKUP_KEEP=3` · `RECEIPT_KEEP=50`），但 Desktop 打包支持日志 `{desktopStateHome}/logs/main.log` 是 **append-only JSONL，无大小上限、无轮转、无清理**——157 处日志调用点（boot、工作区切换、AI 写失败等）会让该文件无限增长。违反「log 有循环上限和清理能力」的产品保证。

## 决策

文件 sink 加**大小上限轮转**，语义与 Kernel 产物旋转对齐（调用时读 env，而非模块加载时求值）：

| 项 | 值 | 理由 |
|----|----|------|
| `topmind_LOG_MAX_BYTES` | 默认 2 MB | 支持排障够用；粒度足够小，避免长驻安装膨胀 |
| `topmind_LOG_KEEP` | 默认 3（归档份数） | `main.log` + `main.log.1…3`，磁盘最坏 ≈ (keep+1) × cap ≈ 8 MB |
| 超限判定 | 字节计数（attach 时 stat 初始化，append 时累加） | 不逐行 stat；logger 保持零异常抛出 |
| 轮转动作 | `main.log.{i}` → `main.log.{i+1}`（最旧槽 unlink）→ `main.log` → `main.log.1` | 保序、best-effort，锁死的轮转文件不阻塞日志 |
| 自愈 | 既有超大日志（升级前遗留）在下一次 append 时触发轮转 | 无需启动期专项清理 |
| stderr | 始终输出（attach 与否） | 开发态可见性不变 |

日志级别过滤（`topmind_LOG_LEVEL`）不变；轮转只约束文件 sink。

## 不变项

- Kernel 写闸备份/回执策略（高影响 only）不变
- `.topmind/` 机器态有界性不变（`ai-ops.json` per-op 整体替换、todo frontmatter 截尾 20 / dismissed 30 天过期、ingest 队列 `MAX_JOBS=200`、AI 会话压缩 240K/60）
- Obsidian / UTR 仍只 console 输出，无文件日志面

## 验收

- [x] `topmind-desktop/tests/log-rotation.test.mjs`：上限轮转 + 归档数有界 + JSONL 完整；超大旧日志自愈；无 attach 不落盘
- [x] `tests/writeback-engine.test.mjs` 补 `BACKUP_KEEP`/`RECEIPT_KEEP` 轮转断言（连续 locked 覆盖后备份恰剩 keep 份且保留最新；回执目录恰剩 keep 份）
- [x] Desktop 质量门全过（deps → typecheck → electron → dead-code → i18n → test 909+14 → build → pack:verify 12 checks）
- [x] root 测试 396/396 · `docs:guard` ok
