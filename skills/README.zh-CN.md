# topmind Skills

可移植 AI 技能包：在 Claude Code / Codex / OpenCode / Hermes 等 Host 上使用同一套内容约定。

[English](README.md) · [简体中文](README.zh-CN.md) · [总览](../README.zh-CN.md) · [安装与发布](./INSTALL.md) · [发布到 skills.sh](./INSTALL.md#publishing-to-skillssh--open-agent-skills-registry) · [架构](../SKILL-ARCHITECTURE.md)

```bash
# 仓库根
npm run skills:install
npm run skills:update
# node scripts/install-skills.mjs add topmindspace/topmind -g
```

**版本与清单真源：** [`topmind-pack.json`](./topmind-pack.json)（`npm run versions`）。  
各 `SKILL.md` 的 `version` **必须**等于 pack 版本。

---

## 结构

```text
skills/
├── topmind/                 # 唯一日常入口（router）
├── topmind-capture|organize|write|memory|maintain|loop/
├── topmind-weread|x/        # 可选连接器
├── shared/                  # 写回回执 · 降级 · 捕获 …
├── install-targets/         # Host 安装形状
├── evals/evals.json
└── topmind-pack.json
```

| 类型 | 模块 |
|------|------|
| **入口** | `topmind` only |
| **动作** | capture · organize · write · memory · maintain · loop |
| **连接器** | weread · x（可选） |

> 子 skill 触发词只服务 Host 路由，**不是**第二前台入口。

---

## 产品契约

```text
User experience:     capture-first
Data organization:   category-first + topic-emerges
Content truth:       topmind-workspace/categories-and-topics
Capability model:    action-first
Save settings:       auto | confirm
Safety model:        reversible by default
```

日常入口只暴露 `topmind`。Host 会话状态不得成为 topmind 内容真源。  
本 pack **不要求 Desktop**。**UTR 可选** — 没有 UTR 时用 Host 文件工具。

工作流：`收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
（用户说「收一下」「记一下」「整理」「写成稿」「跑一遍 loop」— router 推断类别 / 专题 / 动作。）

---

## SKILL.md frontmatter

```yaml
---
name: <kebab-case-id>           # required; matches directory name
version: <pack.version>         # required; = topmind-pack.json version
description: >-                  # required; Use when + Do not use
  …
action_category: capture        # skill taxonomy (not user note category)
triggers: [...]
entrypoint: false               # only topmind router is true
author: TopMindSpace
license: MIT
homepage: https://github.com/topmindspace/topmind
degradation: ../shared/capability-degradation.md
---
```

由 `skills/tests/package-manifest.test.mjs` 强制校验。一个 pack JSON，无 per-skill 第二清单。完整 schema：[`../SKILL-ARCHITECTURE.md`](../SKILL-ARCHITECTURE.md)。

---

## 工作区契约

```text
{workspace-root}/
├── topmind.yaml                # contract v4
├── memory/                     # profile.md · periodic/ · topics/
├── .topmind/                   # rebuildable machine state
├── 00-收件箱/ or 00-Inbox/     # role: buffer (live dir name)
├── 10-动态/ …                  # categories (template-driven)
├── 88-输出/ or 88-Outputs/     # role: delivery
└── 99-归档/ or 99-Archive/     # role: system
```

专题：

```text
{category}/{YYYY-theme}/
├── topic.md                 # optional
├── *.md                     # notes at topic root
└── images/                  # optional
```

尚无专题时，散篇放在 `{category}/{note}.md`。

**不要创建（已废弃）：** 默认 `outline.md` / `setting.md` / `style.md`；`project_type` frontmatter；专题内嵌套 `notes/` 或 `outputs/`；顶层 `projects/`；`YYYY-类型-项目名` 命名。

**类别：** 运行时发现 `{NN-Name}/` + `topmind.yaml` v4（`categories.extensions` / `categories.overrides` 含 `hidden`）。共享解析器：引擎 `lib/workspace-model.mjs`。优先按角色路由，不要写死 `10-` / `20-` 编号。

不要硬编码绝对路径 — 从 Host 推断 `workspace_root`，或向用户询问。

### 6 条核心规约

1. **大类不重叠**  
2. **专题自然涌现**  
3. **动态类特殊**（默认平铺）  
4. **兜底类清理**（约 30 天）  
5. **参考资料定位**  
6. **大类命名稳定**（rename via migration）  

完整规则：[`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) §2。

---

## 行为规则

- 先捕获；不要因为分类不完美而挡住简单保存  
- 信号足够强时自动路由；否则走 **role:buffer**（现场收件箱目录，不要只写死 `00-收件箱/`）  
- 专题不清时，散篇放在大类根  
- 每次写入返回回执（路径、路由原因、下一步）  
- `source_type`: `user-original` | `external-capture` | `ai-derived`  
- UTR 可选 — Host 文件工具遵守同一契约  
- 保存设置协议：`writeback_mode: auto | confirm`  
- 锁定/定稿文件 → 修订副本（`文章 - 修订版.md`），不要原地自动改  
- 本 pack 不要求 Desktop  
- **复合纪律（不改结构）：** organize 把综合写回磁盘；write 先读可选 `topic.md`；memory 仅在明确确认后写；capture 从不改 `topic.md`；**不要**硬造 `INDEX.md` / 平行 wiki 树（见 `shared/project-model-brief.md`）  

---

## 安装目标

九个 skill 目录（7 个核心 + 2 个连接器）可以符号链接或复制到 Claude Code、Codex、OpenCode、Hermes 等。  
优先使用 pack-aware 安装器，保证 `shared/` 与 `topmind-pack.json` 完整 — 见 [`INSTALL.md`](./INSTALL.md)。

Host 适配器**不得**改变内容真源、新增并列日常入口，或把内容存进 agent 运行态。见 [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md)。
