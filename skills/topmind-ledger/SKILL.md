---
name: topmind-ledger
version: 3.5.4
description: >-
  通用记账到记忆平面（默认个人/自己账本，用户自建账本与分类）。Use when 记账、记一笔、花了、存入、查看账单、账户余额。
  Do NOT use for 记一下到动态、待办、微信读书、发推、Feishu/lark-cli.
action_category: memory
triggers:
  - 记账
  - 记一笔
  - 花了
  - 存入
  - 查看账单
  - 账户余额
  - bookkeeping
  - log expense
tags: [ledger, bookkeeping, memory, optional]
entrypoint: false
compatibility: Host file tools or Kernel writeback. Desktop optional mini-app. Feishu/lark-cli is not required.
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
updated: 2026-08-29
degradation: ../shared/capability-degradation.md
---

# topmind 记账

可选技能：把一笔收入/支出追加到语义平面账本。**不是**第二前台入口；日常仍只走 `topmind`。

空工作区只有一本默认 **个人 / 自己** 账本。用户再加账本和分类。历史上的 ClassFund / Giggs / Mom 只是 50-账本 *行格式* 参考，**不是**产品默认账本。

```text
{memory.dir}/ledgers/Personal.md    # 默认「自己」
{memory.dir}/ledgers/{Book}.md      # 用户新增
{memory.dir}/ledgers/catalog.md     # 用户分类
```

## When NOT to use

- 「记一下」到动态/收件箱 → `topmind-capture`
- 待办清单 → `memory/todo.md`（todo-engine）
- 微信读书 / X → `topmind-weread` / `topmind-x`
- 飞书多维表格 / `lark-cli` / `sync_feishu_ledger_cache.py` — **不是**本 skill 的写路径

## 触发

| 用户说 | 动作 |
|--------|------|
| 花了 / 支出 / 买了 | 支出 |
| 存入 / 收入 | 收入 |
| 记账 / 记一笔 | 捕获一笔（缺金额则问清） |
| 查看账单 | 读流水 |
| 账户余额 | 读 Current balance |

未点名账本 → 默认个人本。短语里出现用户已有账本或分类名才落到那本/那个分类。不要为「班费」发明 ClassFund，除非用户已经建了那本账本。

## 落盘形状

```markdown
# Personal Ledger

> Cloud account: 自己
> Current balance: 0.00 元

## Transactions

- [YYYY-MM-DD HH:MM:SS] 收入 +523.00 元
  分类：工资；备注：…
- [YYYY-MM-DD HH:MM:SS] 支出 -50.00 元
  分类：运动；备注：买羽毛球拍
```

**Append-only**：只追加新行并更新 `Current balance`，不改历史行。

## 写入

Host 文件工具或 Kernel `appendLedgerEntry` / `captureLedgerPhrase`（经 writeback-engine）。回执含目标路径 + affected files。见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。

Desktop 可选小应用（看板 / 流水 / 分类 / 快捷记账）。**如何打开**：启用后从标题栏 Apps 菜单、状态栏「记账」chip、命令面板「记账」打开；关掉插件后这些入口消失（不是 PrimaryNav，也不是侧栏项）。**账本路径**即 `{memory.dir}/ledgers/...`，小应用展示当前本相对路径。无 Desktop 时本 skill 仍可用。Obsidian 不发记账小应用。

## 保存设置

- **自动保存 (auto)**：直接写入并返回路径回执（path receipt）
- **需要审阅 (confirm)**：先进入目标路径/内容审阅入口再保存
- Host 可编码为 `writeback_mode: auto | confirm`。详见 [`../shared/writeback-receipt.md`](../shared/writeback-receipt.md)。
