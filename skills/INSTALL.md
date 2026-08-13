# Install & update topmind Skills

[Root README](../README.md) · [English](../README.en.md) · [skills/README](./README.md)

**Model (same idea as open Agent Skills / `npx skills`):**

```text
指定源（GitHub 仓库 / 本地路径 / Release）
    + 仓库内 skills 子目录（默认 skills/）
    + 安装目标（host 的 skills 根目录）
    → 安装
    → 以后在同一目标上 update 升级
```

```text
Source  examples:  topmindspace/topmind   ./skills   release:latest
Path    default:   skills/     (monorepo 里 skill 包所在目录)
Dest    examples:  ~/.claude/skills   ./.claude/skills   ~/.codex/skills
```

Repository: https://github.com/topmindspace/topmind  
Daily entry after install: **`topmind`**

---

## 0. Via Desktop（推荐 · 探测 + 装/升/卸）

若已安装 **topmind Desktop**，不必先跑 CLI：

1. 打开 **设置 → 管理与更新 (Manage & Updates)**
2. 查看已探测的 Agent 宿主（Claude Code · Codex · Hermes · OpenCode · CodeBuddy 等）  
3. 对目标宿主点 **安装 / 升级 / 卸载**（优先全局 skills 根 + 回执；卸载只删托管条目，不动无关用户 skill）  
4. 同一页还可：**准备剪藏扩展**（引导浏览器 Load unpacked）、**安装 Obsidian 插件**到当前工作区 vault  

独立 CLI / pack 路径仍然有效（无 Desktop 时用本节后续命令）。宿主探测与装机逻辑在 Desktop 内为纯 FS，与本脚本语义对齐。

---

## Publishing to skills.sh & Open Agent Skills Registry

**skills.sh**（与 `npx skills` 工具网络）采用基于 **GitHub 公开仓库的直连索引机制**。将本仓库的 Skills 发布并公开到 `skills.sh` 无需传统 npm publish，步骤如下：

1. **规范校验与打包**：
   确保技能文件符合 Agent Skills 规范（`SKILL.md` 包含 YAML frontmatter、Use when / Do NOT 边界、行数 <500）：
   ```bash
   npm run pack:skills
   node --test skills/tests/*.test.mjs
   ```
2. **Push 至 GitHub Public 仓库**：
   ```bash
   git add skills/
   git commit -m "feat(skills): update skills definitions"
   git push origin main
   ```
3. **发布 Tag & Release（推荐）**：
   ```bash
   npm run versions                 # 真源 stamp；全量 tag 用 Desktop 版本
   git tag v<desktop-version>
   git push origin v<desktop-version>
   ```
4. **生态发现与在线安装**：
   发布后，全球开发者即可通过以下方式发现与安装：
   - **CLI 直接索引**：`npx skills add topmindspace/topmind -g -y`
   - **查看目录**：`npx skills add topmindspace/topmind -l`
   - **网页版浏览**：访问 `https://skills.sh/topmindspace/topmind`

---

## Two installers (pick one)

### A. Community CLI — `npx skills`（和开源 skills 生态一致）

已验证：本仓库可被直接发现 **9 个** skill。

```bash
# 安装到用户全局（~/.claude/skills 等，按 agent 探测）
npx skills add topmindspace/topmind -g -y

# 只装部分
npx skills add topmindspace/topmind -g -y -s topmind -s topmind-capture

# 升级
npx skills update -g -y

# 列出仓库里有什么（不装）
npx skills add topmindspace/topmind -l
```

适用：Claude Code / Cursor / Codex / OpenCode 等认 Agent Skills 目录布局的 host。

#### 关于 “Failed to install 9 / PromptScript”

`npx skills add … -g` **多数已经成功**。日志里先有：

```text
◇  Installed 9 skills
✓ ~/.agents/skills/topmind  (+ symlink → Claude Code / Codex / …)
```

末尾的 `Failed to install 9` **只针对 PromptScript**：该 host **不支持 global 安装**，不是 topmind 包损坏。可忽略，或不要装 PromptScript。

验收：

```bash
ls ~/.agents/skills/topmind/SKILL.md
ls ~/.claude/skills/topmind   # 常为 symlink → ~/.agents/skills/topmind
```

#### 社区 CLI 不会装 `shared/`（重要）

社区 CLI 只复制含 `SKILL.md` 的目录。topmind skill 内有 `../shared/*.md` 渐进披露链接（含 `media-assets.md` 等），**缺 `shared/` 时子文档打不开**。

这是开放标准「单 skill 目录」与 topmind **pack 级 shared** 的已知差异。加载契约见 [`shared/host-loading.md`](./shared/host-loading.md)。

装完社区 CLI 后**务必**再跑 pack-aware（或手动拷 shared）：

```bash
# ① 推荐：pack-aware 安装器（带 shared/ + topmind-pack.json）
# 通用根（npx skills 主目录）
node scripts/install-skills.mjs add topmindspace/topmind --dest ~/.agents/skills
# 或 Claude 默认根
node scripts/install-skills.mjs add topmindspace/topmind -g

# ② 或手动把 monorepo / Release 包里的 shared 放到同级
mkdir -p ~/.agents/skills
cp -R /path/to/topmind/skills/shared ~/.agents/skills/shared
```

#### 其他 Host 也能装

| Host 类型 | 做法 |
|-----------|------|
| Claude Code / Cursor / Codex / OpenCode | 目录布局 = Agent Skills：`{skillsRoot}/{name}/SKILL.md` |
| 只认 monorepo 单路径 | symlink 整个 `skills/` 或 pack-aware 装到 host skills 根 |
| MCP-only 宿主 | Skills 仍是 Markdown 指令；确定性命令可另接 UTR MCP（可选） |
| 无 skill 系统 | 把 `topmind/SKILL.md` 当 system 片段粘贴；shared 按链接手动附上 |

**Discovery**：Host 应只预加载各 skill 的 `name`+`description`（≤1024 字符）。  
**Activation**：匹配任务后再读完整 `SKILL.md`。  
**Resources**：需要时再读 `shared/` 与 `references/`。

### Zip 加载报 `SKILL.md not found`？

topmind Release 包是 **多 skill 组合包**，不是单目录 skill：

```text
topmind-skills-<ver>.zip
└── topmind-skills-<ver>/
    ├── SKILL.md              ← 根入口 = router
    ├── topmind/SKILL.md      ← 推荐日常入口
    ├── topmind-capture/…
    └── shared/
```

| Host 行为 | 正确处理 |
|-----------|----------|
| 解压 zip 后在根找 `SKILL.md` | 用包内根 `SKILL.md`（router） |
| 扫描 `*/SKILL.md` 多 skill | 装全部 `topmind*` 目录 + `shared/` |
| 社区 `npx skills add` | 从 GitHub 仓装 `skills/` 子树（不依赖 zip 根） |

`skills.md` 是 **包索引**（人类可读），不是 Agent Skills 标准的 `SKILL.md` 替代名——两者并存，不要把 `skills.md` 改成唯一入口。

### B. Pack-aware 安装器 — `scripts/install-skills.mjs`（推荐给 topmind）

会装齐 **skill 目录 + `shared/` + `topmind-pack.json` + …**，保证 `../shared/*.md` 渐进披露链接可用。

```bash
# ① 指定仓库（默认 path=skills，装到 Claude 用户目录）
node scripts/install-skills.mjs add topmindspace/topmind -g

# ② 指定仓库 + 自定义 monorepo 子路径 + 自定义目标
node scripts/install-skills.mjs add topmindspace/topmind \
  --path skills \
  --dest ~/.claude/skills

# ③ 装到「当前项目」而不是用户全局
node scripts/install-skills.mjs add topmindspace/topmind \
  --dest ./.claude/skills

# ④ 本地 monorepo / 任意目录当源
node scripts/install-skills.mjs add ./skills --dest ~/.claude/skills
node scripts/install-skills.mjs add ./skills --mode symlink --dest ~/.claude/skills

# ⑤ 从 Release zip（有 topmind-skills-*.zip 时）
node scripts/install-skills.mjs add release:latest -g

# ⑥ 升级（读目标目录里的回执，重新拉同一源）
node scripts/install-skills.mjs update --dest ~/.claude/skills

# ⑦ 只看会装什么
node scripts/install-skills.mjs list topmindspace/topmind
```

根脚本别名：

```bash
npm run skills:install -- add topmindspace/topmind -g
npm run skills:update  -- --dest ~/.claude/skills
```

私有仓：

```bash
export GH_TOKEN=...    # 或 GITHUB_TOKEN
node scripts/install-skills.mjs add topmindspace/topmind -g
```

---

## Source 写法

| Source | 含义 |
|--------|------|
| `topmindspace/topmind` | GitHub `owner/repo`，默认分支，子目录 `--path skills` |
| `topmindspace/topmind@v*` | 指定 ref / tag（版本见 `npm run versions`） |
| `https://github.com/topmindspace/topmind.git` | 任意 git URL |
| `./skills` / 绝对路径 | 本地 pack 根（含 `topmind-pack.json` 或 `*/SKILL.md`） |
| `release:latest` | GitHub Release 里的 `topmind-skills-*.zip` |

| Option | 含义 |
|--------|------|
| `--path skills` | 仓库内 pack 子目录（默认 `skills`） |
| `--dest <dir>` | 安装目标 = host 的 skills 根 |
| `-g` / `--global` | dest → `~/.claude/skills` |
| `--host codex` 等 | 换默认 dest |
| `--mode symlink` | 仅本地源；开发时热更新 |
| `--skill topmind` | 只装列出的 skill id（可重复） |
| `--locale en-US` | 安装 locale overlay（回退到 `topmind_LOCALE` 环境变量） |

---

## Host destinations

| Host | 典型 dest | 写法 |
|------|-----------|------|
| Claude Code | `~/.claude/skills` 或项目 `.claude/skills` | `-g` 或 `--dest ./.claude/skills` |
| Codex | `~/.codex/skills` | `--host codex` |
| Hermes | `~/.hermes/skills` | `--host hermes` |
| OpenCode | 项目 skills 路径 / config `skills.paths` | `--host opencode` 或见 `integrations/opencode/` |

`install-targets/*.json` 描述各 host 契约（无硬编码本机绝对路径）。

---

## Update 原理

安装后在 dest 写入：

```text
{dest}/.topmind-skills-install.json
```

里面记录了 `source` / `path` / `version`。之后只需：

```bash
node scripts/install-skills.mjs update --dest <同一 dest>
```

就会按原 source 再拉一遍并覆盖（升级）。

社区 CLI 对应：

```bash
npx skills update -g -y
```

---

## 装完长什么样

```text
~/.claude/skills/          # 或你指定的 --dest
├── topmind/SKILL.md       # 日常唯一入口
├── topmind-capture/
├── topmind-organize/
├── …
├── shared/                # pack-aware 安装器会带上
├── topmind-pack.json
└── .topmind-skills-install.json
```

在 host 里调用 **`topmind`**。子 skill 是模块，不是并列产品入口。

---

## OpenCode（可选）

示例：`integrations/opencode/opencode.example.json` — 用 `skills.paths` 指向 monorepo `skills/` 或已安装目录。

---

## Security

- Skills 是 Markdown 指令；不信任的 fork 先审再装。
- API Key 不要写进 skill 文件。
- 安装器只写 `--dest`，不改 engine 仓库（除非 dest 故意指过去）。
