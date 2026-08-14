# topmind Skills Package Index (包索引)

> [!NOTE]
> **每日唯一入口**：`topmind` (router)。其余 6 个 action 与 2 个 optional connector 模块均由 router 调度。  
> **通用与可移植**：兼容 Claude Code / OpenCode / Codex / Hermes 等 Agent Host。  
> **版本真源**：`topmind-pack.json`（可执行 `npm run versions` 查看完整版本号）。  
> 详见权威说明：[Skills README](./README.md) · [简体中文](./README.zh-CN.md) · [安装与部署指南 (INSTALL.md)](./INSTALL.md)。

---

## 九大 Skill 包清单

| # | Skill 名称 | 模块类型 | 关键触发词 / 场景 | 职责描述 |
|---|---|---|---|---|
| 1 | `topmind` | **Router** | `topmind` / 记一下 / 整理 / 模糊多意图 | **主入口 router**：解析用户意图与工作区上下文，自动路由动作与大类 |
| 2 | `topmind-capture` | Action | 记一下 / capture / 抓取链接 | **捕获动作**：处理速记、网页链接、知识文件加工并安全落盘 |
| 3 | `topmind-organize` | Action | 整理 / organize / 提炼结构 | **整理动作**：归纳笔记、整理专题、提取证据链与知识留痕 |
| 4 | `topmind-write` | Action | 写 / 起草 / 润色 / 出稿 | **写作动作**：根据专题与参考资料起草长文、润色及生成 Deliverable |
| 5 | `topmind-memory` | Action | 记住 / memory / 存入记忆 | **记忆动作**：维护专题 `topic.md` 稳定记忆与背景上下文 |
| 6 | `topmind-maintain` | Action | doctor / 诊断 / 清理 | **体检动作**：检查目录健康、孤立文件、配置校验与环境诊断 |
| 7 | `topmind-loop` | Action | loop / 巡检 / 自动盘点 | **巡检动作**：可恢复的工作区全量语义巡检与盘点 |
| 8 | `topmind-weread` | Connector | 微信读书 / weread | **微信读书连接器**：同步划线、书评与阅读笔记 |
| 9 | `topmind-x` | Connector | X / 推特 / twitter | **X (Twitter) 连接器**：归档推特帖子、书签与时间线 |

---

## 核心约定与规约

1. **唯一前台入口**：AI Agent 日常激活只需推荐 `topmind`。
2. **渐进式披露 (Progressive Disclosure)**：Discovery (`name+description`) → Activation (`SKILL.md`) → Deep Procedures (`shared/` / `references/`)。
3. **文件系统即真源**：不引入独立的数据库或 Agent state 依赖。
4. **遵从 6 条核心规约**：详见根目录 [`PROJECT-MODEL.md`](../PROJECT-MODEL.md)。

👉 **详细架构、Frontmatter Schema 与安装方法请参阅**：
- [Skills README](./README.md) · [简体中文](./README.zh-CN.md)
- [多 Host 安装教程 (INSTALL.md)](./INSTALL.md)
- [根目录架构契约 (SKILL-ARCHITECTURE.md)](../SKILL-ARCHITECTURE.md)
