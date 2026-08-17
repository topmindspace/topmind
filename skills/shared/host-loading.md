# Host Loading & Progressive Disclosure

> 给 **Agent Host / 安装器** 的加载契约。人类安装见 [`../INSTALL.md`](../INSTALL.md)。  
> 对齐 [Agent Skills Open Standard](https://agentskills.io/specification) 三级披露。

## 三级加载（必须遵守）

| 级 | 何时 | 加载什么 | 体量目标 |
|----|------|----------|----------|
| **1 Discovery** | Session 启动 / skill 列表 | 每个 skill 的 `name` + `description` only | ~50–100 tokens/skill |
| **2 Activation** | 匹配到任务 | 完整 `SKILL.md` body | < 5k tokens 推荐 |
| **3 Resources** | 步骤需要时 | `shared/*.md` · `references/*` · 可选 scripts | 按需 |

**禁止**：启动时把 9 份 SKILL 全文 + shared 全部塞进 system prompt。

## 组合式 Pack 如何被 Host 理解

topmind 是 **multi-skill pack**（1 router + 6 action + 2 connector），不是单文件 skill。业界对齐：

| 约定 | topmind 做法 |
|------|----------------|
| Agent Skills 单 skill = `{name}/SKILL.md` | 9 个目录各有 `SKILL.md` |
| 部分 host 对 **zip 根** 找 `SKILL.md` | Release zip 根额外含 **router `SKILL.md`**（= `topmind/SKILL.md`） |
| Pack 索引 | `skills.md` / `topmind-pack.json`（人类 + 机器） |
| 共享资源 | `shared/` 与 skill 目录**同级** |

```text
topmind-skills-<ver>/          ← Release zip 顶层
├── SKILL.md                   ← pack 根入口（router；zip 单 skill 加载器用）
├── skills.md · topmind-pack.json
├── topmind/SKILL.md           ← 日常入口（完整安装后的 discovery 目标）
├── topmind-capture/ …         ← 子 skill
├── shared/                    ← 跨 skill 资源
└── …
```

### 安装形状（正确）

```text
{host-skills-root}/
├── topmind/
│   └── SKILL.md
├── topmind-capture/
│   └── SKILL.md
├── …（其余 7 个）
├── shared/                 ← 与 skill 同级！相对链接 ../shared/ 才能解析
│   ├── capability-degradation.md
│   ├── project-model-brief.md
│   ├── output-language.md
│   ├── host-loading.md
│   └── …
└── topmind-pack.json       ← 推荐保留
```

**不要**只把 zip 解压成一个目录当「单 skill」却不拆子目录——除非 host 明确只支持单 `SKILL.md`（此时用根 `SKILL.md` router 即可跑通核心路由）。

### 错误形状

- 只拷了 9 个目录、**没有** `shared/` → 渐进链接 404  
- 把 monorepo 整仓当 skill 根 → host 扫到无关目录  
- 只装 `topmind` 却期望 weread/x 触发 → connector 未装  
- Host 报 `SKILL.md not found`：请用 `topmind-skills-*.zip`（含根 `SKILL.md`），或装到 `{skillsRoot}/topmind/SKILL.md`  


## 两套安装器

| 工具 | 是否带 shared/ | 适用 |
|------|----------------|------|
| `npx skills add topmindspace/topmind -g` | **否**（仅 SKILL 目录） | 快速试用；装后需补 shared |
| `node scripts/install-skills.mjs add …` | **是**（pack-aware） | **推荐生产** |

补 shared：

```bash
# pack-aware 重装
node scripts/install-skills.mjs add topmindspace/topmind -g

# 或手动
cp -R skills/shared ~/.agents/skills/shared
```

## Router vs 子 skill（Host 路由策略）

| 场景 | 应激活 |
|------|--------|
| 单一清晰动词（记一下 / 写一稿 / doctor） | 对应 `topmind-*` 子 skill |
| 多意图 / 模糊 / 只说「topmind」 | `topmind` router |
| Host **只装了** topmind 一个 skill | router 内嵌 Action Map 完成全部语义 |
| 9 个全装 | description 消歧；router **不抢** 已匹配的子 skill |

实现提示：discovery 阶段只比 `description` 文本相似度 / 关键词；**不要**用 triggers 数组作为唯一标准（triggers 是 topmind 扩展，开放标准不要求）。

## description 写作规范（本 pack 已遵循）

1. **What** — 做什么（含 topmind / category·topic 心智）  
2. **Use when** — 用户真实中英短语  
3. **Do NOT use** — 负向边界（降误触发）  
4. ≤ **1024** 字符（Agent Skills 硬限）  
5. Router 不得写「any knowledge task」一类过宽句，以免淹没子 skill  

## 工作区前提（Host 须满足）

- 用户数据在 **workspace root**（含 `{NN-Name}/`），不是 engine 仓  
- Skills **不**写 engine 代码  
- 可选 UTR：有则加速，无则 Host 文件工具（见 capability-degradation）  
- 类别解析语义：`list-categories` 或扫盘 + `topmind.yaml` v4  

## Desktop 内置

topmind Desktop 从 engine `skills/` 加载同一 pack（`skills-runtime.mjs`），默认 **skill-first**：

- Discovery 注入 system prompt  
- `list_skills` / `load_skill` / `load_skill_resource`  
- 设置 → Skills：总开关 · 清单勾选 · 扩展目录 · 安装回执；AI 面板可钉选  

**扩展 roots 合并顺序**：`ai.extraSkillsRoots`（设置）→ 已同步的配置缓存 → 环境变量 `topmind_SKILLS_EXTRA`（`:` / Windows `;`）。同名 skill 以后加载的 external 覆盖 bundled。

```bash
export topmind_SKILLS_EXTRA="$HOME/my-extra-skills:$HOME/other-skills"
```

| UI 动作 | 行为 |
|---------|------|
| 添加目录 | 路径写入 `extraSkillsRoots`（不复制；确认框展示 version / skill 数） |
| 安装到本地 | 拷贝到 `{desktopHome}/skills-extra/` + `.topmind-skills-extra-install.json` 回执；同 id 重装前移入 `skills-extra/.trash/` |
| 列表移除 | 只改设置，不删磁盘 |

**够用边界**：CLI 装到 Claude/Codex 见 [`../INSTALL.md`](../INSTALL.md)；Desktop 管理「本机 AI 用的」扩展 skills，不必与 host 全局目录强制统一。

## 验收清单

```bash
# 每个 skill 可被独立打开
test -f ~/.agents/skills/topmind/SKILL.md
test -f ~/.agents/skills/topmind-capture/SKILL.md
# shared 相对链接可解析
test -f ~/.agents/skills/shared/project-model-brief.md
# pack 契约
test -f ~/.agents/skills/topmind-pack.json   # 若用 pack-aware 安装
```
