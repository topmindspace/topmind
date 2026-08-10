# topmind Skills

可移植 AI 技能包：在 Claude Code / Codex / OpenCode / Hermes 等 Host 上使用同一套内容约定。  
[总览](../README.md) · [English](../README.en.md) · [安装与发布](./INSTALL.md) · [发布到 skills.sh](./INSTALL.md#publishing-to-skillssh--open-agent-skills-registry) · [架构](../SKILL-ARCHITECTURE.md)

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

## Product contract

```text
User experience:     capture-first
Data organization:   category-first + topic-emerges
Content truth:       topmind-workspace/categories-and-topics
Capability model:    action-first
Save settings:       auto | confirm
Safety model:        reversible by default
```

Expose only `topmind` as the daily entry. Host session state must not become topmind content truth.  
**Desktop is not required** for this pack. **UTR is optional** — use host file tools when UTR is absent.

Workflow: `收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整`  
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

## Workspace contract

```text
{workspace-root}/
├── topmind.yaml                # contract v4
├── memory/                     # profile.md · periodic/ · topics/
├── .topmind/                   # rebuildable machine state
├── 00-收件箱/                  # buffer
├── 10-动态/ …                  # categories (template-driven)
├── 88-输出/                    # flat deliverables
└── 99-归档/                    # safety layer
```

Topic:

```text
{category}/{YYYY-theme}/
├── topic.md                 # optional
├── *.md                       # notes at topic root
└── images/                    # optional
```

Loose note: `{category}/{note}.md` when no topic yet.

**Do not create (deprecated):** default `outline.md` / `setting.md` / `style.md`; `project_type` frontmatter; nested topic `notes/` or `outputs/`; top-level `projects/`; `YYYY-类型-项目名` naming.

**Categories:** discover `{NN-Name}/` at runtime + `topmind.yaml` v4 (`categories.extensions` / `categories.overrides` with `hidden`). Shared resolver: engine `lib/workspace-model.mjs`. Prefer role-based routing over hardcoded `10-`/`20-` numbers.

Do not hardcode absolute paths — infer `workspace_root` from the host or ask.

### 6 条核心规约

1. **大类不重叠**  
2. **专题自然涌现**  
3. **动态类特殊**（默认平铺）  
4. **兜底类清理**（约 30 天）  
5. **参考资料定位**  
6. **大类命名稳定**（rename via migration）  

Full rules: [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) §2.

---

## Rules (skills behavior)

- Capture first; don’t block simple saves on perfect classification  
- Auto-route when signal is strong; otherwise `00-收件箱/`  
- Loose notes at category root when topic is unclear  
- Every write returns a receipt (path, route reason when available, next step)  
- `source_type`: `user-original` | `external-capture` | `ai-derived`  
- UTR is optional — host file tools preserve the same contract  
- Save settings protocol: `writeback_mode: auto | confirm`  
- Locked/final files → revision copy (`文章 - 修订版.md`), not in-place auto-edit  
- Desktop is not required for this pack  
- **Compound discipline (no structure change):** organize leaves synthesis on disk; write reads optional `topic.md` first; memory only on explicit confirm; capture never edits `topic.md`; **no** hard `INDEX.md` / parallel wiki trees (see `shared/project-model-brief.md`)  

---

## Install targets

Nine skill directories (7 core + 2 connectors) can be symlinked/copied into Claude Code, Codex, OpenCode, Hermes, etc.  
Prefer the pack-aware installer so `shared/` and `topmind-pack.json` stay intact — see [`INSTALL.md`](./INSTALL.md).

Host adapters must **not** change content truth, add parallel daily entries, or store content in agent runtime state. See [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md).
