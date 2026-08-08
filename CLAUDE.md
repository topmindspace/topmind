# CLAUDE.md

> Claude Code 兼容入口。Agent 行为规范的**唯一真源**是 `AGENTS.md`。

## Read First

```text
AGENTS.md                      ← Agent 行为规范唯一真源
docs/ARCHITECTURE-RESET.md     ← 决策锁 · Target/Done · 实施阶段
PRODUCT-BOUNDARIES.md          ← Skills / Desktop / UTR / Obsidian 四体边界
PROJECT-MODEL.md               ← 数据模型 + 6 条规约 + 命名 + 配置
SKILL-ARCHITECTURE.md          ← Skill 架构 + frontmatter schema
TOOLS.md                       ← UTR 命令面（可选）+ 写回契约
DESIGN.md                      ← 交互与体验原则（用户概念 ≤5）
README.md                      ← 入口导航（中文默认）
README.en.md                   ← English
docs/README.md                 ← 文档索引 · ADR · 打包
```

## Quick Summary

```text
topmind = Portable Skills  ⊕  Optional Desktop  ⊕  Optional UTR  ⊕  Optional Obsidian
          （四体核心）        + Optional Clip 剪藏分发面（Desktop 捕获 companion）
```

- **北极星**：最低摩擦个人动态流 — 记简单；AI 建议；用户确认；文件是真源。  
- 工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
- 用户概念：记一下 · 动态 · 专题 · 我的情况 · 写出来  
- Skills：唯一入口 `topmind`；Host 文件工具为主；UTR 可选  
- Desktop：**富工作台**；导航变薄；不硬依赖 UTR  
- UTR：可选 CLI/MCP（**8 域 / 27 命令**；MCP 默认 18）  
- Obsidian 插件：可选；Obsidian 内嵌动态流 + AI 副驾；复用 Kernel `lib/` 八引擎  
- Kernel 写闸 · Memory · 建议条/待确认写入 · 待办 · AI 操作框架 · **活动窗口 / 动态增补** · **高影响 only 备份/回执 + AI Provider 动态参数**：**Done** — 见 `docs/ARCHITECTURE-RESET.md` §2 · `docs/adr/2026-08-07-engine-hardening-writeback-ai.md`

## Commands

```bash
npm run validate
npm run docs:guard
npm test
npm run desktop:dev
npm run obsidian:dev
npm run pack:all
npm run versions
```

Repo: https://github.com/topmindspace/topmind

## Hard Rules（子集）

完整列表见 `AGENTS.md`。

- 用户数据不进 engine 目录  
- Desktop runtime 不是内容真源  
- 写入必须返回 target path + affected files evidence  
- 命名：`{类别}/{YYYY-主题}/`；专题首页 `topic.md`  
- 不默认创建 outline/setting/style、专题内 outputs/notes  
- 代码 Topic* / Category*，不用 Project*  
