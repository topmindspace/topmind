# topmind Skills — Capability Degradation

> **共享降级表（唯一真源）**。各 SKILL.md frontmatter `degradation` 指向本文件。  
> Skill 是纯 Markdown 指令集，**不依赖特定运行时**。主路径 = Host 文件工具 + `PROJECT-MODEL`；UTR 为可选加速。边界见 `PRODUCT-BOUNDARIES.md`。  
> Host 如何三级加载 / 安装 `shared/`：见 [`host-loading.md`](./host-loading.md)。

## 三级能力（主 → 次）

```text
Level 1（主）: Host 文件工具
  → 直接读写工作区 Markdown / 目录
  → 遵守 PROJECT-MODEL 路径与 frontmatter
  → 写入返回路径回执

Level 2（可选）: UTR CLI / MCP
  → workspace-read.* / workspace-write.* 等确定性命令
  → 适合批量、脚本、强校验

Level 3（最低）: 仅对话
  → 给出路径与步骤；不静默假装已写入
```

**不要**把「先装 UTR」写成用户前提。

## Level 1 — Host 文件工具

| 意图 | 操作要点 |
|------|----------|
| 看类别 | 扫描 `{NN}[- ]{Name}/` + 读 `topmind.yaml` v4（含 categories.extensions / overrides）；跳过 hidden |
| 看专题 | 列出类别下专题目录 + 根层单篇 `.md` |
| 检视专题 | 读 `topic.md`（若有）+ 专题根 `.md` |
| 捕获 | 写带 frontmatter 的 `.md` 到专题根 / 大类根 / role:buffer |
| 交付 | 写到 role:delivery（常为 `88-输出/`） |
| 追加记忆 | 默认 `memory/profile.md`（主）或 `memory/periodic/`（周期摘要）；**开专题**写内容大类 `{YYYY-主题}/`；仅用户明说才写 `memory/topics/{slug}.md` |
| 健康检查 | 遍历结构、报告缺失 / 垃圾；自定义类合法 |
| 归档 / 恢复 | 移动并写入 role:system（常为 `99-归档/`） |

写回：`auto | confirm`（见 `TOOLS.md`）。

## Level 2 — UTR（可选）

| 需要 | 命令 |
|------|------|
| 类别 / 专题 | `list-categories`（WorkspaceModel Descriptor）· `list-topics` · `inspect-topic` · `list-topic-files` · `list-inbox` |
| 捕获 / 创建 | `create-topic` · `capture-note` · `save-output` |
| 记忆 | `memory.append-profile` · `memory.append-topic` · `memory.promote` · `memory.digest` |
| Inbox 路由 | `plan-inbox-routing`（primary；整理 inbox 前规划） |
| 检查 / 维护 | `doctor-workspace` · `archive-topic` · `restore-safety-receipt` |

扩展面见 `TOOLS.md` §Current Command Surface。输入用独立字段 `category` + `topic`。

## Level 3 — 对话 only

- 给出明确路径：`{workspace}/{类别}/{专题}/xxx.md`  
- 描述可手动执行的步骤  
- 可提示安装 UTR 获得脚本化能力（**非强制**）  

## 回执格式

```text
已收进/已更新：大类 → 专题（或单篇 / Inbox）
位置：relative/path.md
操作：create | update | delete | archive | restore
保存模式：auto | confirm
判断：信心与理由（如有）
下一步：继续写 / 整理（活动窗口）/ 更新我的情况 / 建议开专题（内容大类）/ 手动移动
```

完整 write evidence 见 `TOOLS.md`。

## Save Settings

```yaml
writeback_mode: auto | confirm
```

## 与 Desktop

- Desktop **不是** Skills 运行时，也不是 UTR 的 GUI  
- Desktop 内捕获 / 编辑 / AI 走 **WorkspaceService**  
- 同一套 Skills 文案在任意 agent host 独立生效  
- 四者只共享内容约定，不共享进程  
