# AGENTS.md — topmind

本仓库是产品源码，不是 agent 的个人工作区。默认中文，简洁沟通；动手前说明文件与计划，执行命令前说明目的；不编造路径、配置或执行结果，不输出密钥。

## 工作方式

- 完成用户已授权的整项任务；多步骤可连续执行，不因内部技能切换重复询问。新出现的范围外动作先提案。
- 先读本次相关实现与测试，再改动；不要默认读完整产品手册。已获取的当前源码与工具证据无需重复读取。
- 行为变化补执行级测试，直接调用真实模块；不能用“源码包含某句话”替代行为验证。
- 改 / 删 / 重构 Desktop 前跑 `npm run desktop:quality` 建立基线；失败先定位。修改后按范围验证，交付前跑集成质量门。
- 替代实现完成后删除废弃代码、脚本和文档。保留公开 id、配置与已有用户数据的兼容性；不顺手进行无关重构。
- `.codegraph/` 存在时，定位/理解代码先用 CodeGraph；索引报告漂移的文件再直接读取。没有索引则用 `rg`，不自动建索引。

## 不变量

- 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`。用户日常说自然语言，不必选择技能模块。
- 用户数据在用户工作区，文件是内容真源。Desktop 状态、会话、缓存和索引不能替代内容文件。
- 根 `topmind.yaml` 为行为契约；`memory/` 为语义内容，`.topmind/` 为可重建机器态。不要建立平行 truth store。
- 耐久内容写入共用 Kernel `lib/writeback-engine.mjs`；路径围栏必须解析符号链接。写入返回真实 target path 与 affected files。
- `writeback.mode: auto | confirm`：内容编辑直接落盘；confirm 只将删除/归档置为待确认。locked 允许编辑，任务首写快照；永久删除 locked/core 仍走既有用户权限。
- 主动记忆/分类建议不是写入授权；用户明确要求的记忆更新或建专题无需再次确认。实际写闸与外部发布授权仍需遵守。
- 类别由 workspace-model 动态发现，不用固定白名单否定自定义类；ensure 只补 required roles，不复活用户删除的可选类。
- 专题 `{类别}/{YYYY-主题}/`，首页 `topic.md`；不默认生成 outline/setting/style、专题 outputs/notes、全局硬索引或平行 wiki。
- 自动建议可以忽略。临时问答、只要求回复的总结不强制生成文件；持久整理与交付按用户意图落盘。

## 按任务读取

| 改动 | 先读 |
|---|---|
| 产品与数据约定 | `PRODUCT-BOUNDARIES.md`、`PROJECT-MODEL.md` 相关小节 |
| Skills / 路由 | `SKILL-ARCHITECTURE.md`；真实源码在姊妹仓 `topmind-skills` |
| Desktop UI / 颜色 / 快捷键 | `topmind-desktop/DESIGN.md` 相关小节；`docs/DEVELOPMENT.md` 对应纪律 |
| Agent / prompt / tool / boot | `topmind-desktop/ARCHITECTURE.md` 与 `docs/DEVELOPMENT.md` 对应小节 |
| Kernel / UTR 写回 | `TOOLS.md` 相关契约及真实注册表 |
| Obsidian | 姊妹仓 `topmind-obsidian` 的实现、ARCHITECTURE 与 DESIGN |
| 发行、版本、四仓同步 | `docs/REPO-MAINTENANCE.md`；版本查 `npm run versions`，不抄数量/版本到规约 |
| 演进方向与本轮审查 | `docs/ARCHITECTURE-AUDIT-2026-10-24.md`；历史决策见 `docs/ARCHITECTURE-RESET.md` |

契约文档在主仓维护，Skills 操作语义在其 `shared/` 单一维护；Obsidian 的 `lib/` 是构建快照，通过 `ensure-engine` 同步，不手改副本。`skills/` 与 `obsidian-plugin/` 仅保留迁移入口。

## 验证命令

```bash
npm run root:test          # Kernel 与跨表面回归
npm run utr:test           # CLI / MCP
npm run docs:guard         # 文档与实现契约
npm run desktop:quality    # Desktop 完整质量门，含打包源码检查
npm run validate           # 根集成质量门
```

Skills 在姊妹仓 `npm test && npm run pack`；Obsidian 在姊妹仓 `npm run typecheck && npm run lint && npm test && npm run build && npm run pack:verify`。质量门详细顺序、单测与 UI 纪律见 `docs/DEVELOPMENT.md`。打包源码检查通过不代表真实安装包、跨平台 UI 或线上模型效果已经验收；交付时明确已测与未测范围。
