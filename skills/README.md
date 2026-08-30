# topmind Skills

Portable AI skill pack: the same content contract on Claude Code / Codex / OpenCode / Hermes and other hosts.

[English](README.md) · [简体中文](README.zh-CN.md) · [Overview](../README.md) · [Install](./INSTALL.md) · [Publish to skills.sh](./INSTALL.md#publishing-to-skillssh--open-agent-skills-registry) · [Architecture](../SKILL-ARCHITECTURE.md)

```bash
# repo root
npm run skills:install
npm run skills:update
# node scripts/install-skills.mjs add topmindspace/topmind -g
```

**Version and manifest truth:** [`topmind-pack.json`](./topmind-pack.json) (`npm run versions`).  
Each `SKILL.md` `version` **must** equal the pack version.

---

## Layout

```text
skills/
├── topmind/                 # only daily entry (router)
├── topmind-capture|organize|write|memory|maintain|loop/
├── topmind-weread|x/        # optional connectors
├── topmind-ledger/          # optional bookkeeping (memory-plane ledgers)
├── shared/                  # write receipts · degradation · capture …
├── install-targets/         # host install shapes
├── evals/evals.json
└── topmind-pack.json
```

| Kind | Modules |
|------|---------|
| **Entry** | `topmind` only |
| **Actions** | capture · organize · write · memory · maintain · loop |
| **Connectors** | weread · x (optional) |
| **Optional** | ledger (记账 · memory-plane books) |

> Sub-skill trigger words exist for host routing. They are **not** a second product front door.

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
(If the user says “capture this”, “note it”, “organize”, “write it up”, or “run a loop”, the router infers category / topic / action.)

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

Enforced by `skills/tests/package-manifest.test.mjs`. One pack JSON; no per-skill second manifest. Full schema: [`../SKILL-ARCHITECTURE.md`](../SKILL-ARCHITECTURE.md).

---

## Workspace contract

```text
{workspace-root}/
├── topmind.yaml                # contract v4
├── memory/                     # profile.md · periodic/ · topics/ · todo.md · optional ledgers/
├── .topmind/                   # rebuildable machine state
├── 00-Inbox/ or 00-收件箱/     # role: buffer (live dir name)
├── 10-Stream/ …                # categories (template-driven)
├── 88-Outputs/ or 88-输出/     # role: delivery
└── 99-Archive/ or 99-归档/     # role: system
```

Topic:

```text
{category}/{YYYY-theme}/
├── topic.md                 # optional
├── *.md                     # notes at topic root
└── images/                  # optional
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

Full rules: [`../PROJECT-MODEL.md`](../PROJECT-MODEL.md) §3.

---

## Rules (skills behavior)

- Capture first; don’t block simple saves on perfect classification  
- Auto-route when signal is strong; otherwise **role:buffer** (live inbox dir, not hardcoded-only `00-Inbox/`)  
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

Packaged skill directories (7 core + 2 optional connectors + optional ledger) can be symlinked/copied into Claude Code, Codex, OpenCode, Hermes, and similar hosts.  
Prefer the pack-aware installer so `shared/` and `topmind-pack.json` stay intact — see [`INSTALL.md`](./INSTALL.md).

Host adapters must **not** change content truth, add parallel daily entries, or store content in agent runtime state. See [`../PRODUCT-BOUNDARIES.md`](../PRODUCT-BOUNDARIES.md).
