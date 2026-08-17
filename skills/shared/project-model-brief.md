# Project Model Brief（Skills 共享摘要）

> 完整真源：引擎根 `PROJECT-MODEL.md`。本文件只给 skill 运行时最小约定，避免 9 份 SKILL 全文复制。  
> 代码解析：`lib/workspace-model.mjs` 等（UTR / Desktop；Skills 用同一语义）。  
> 写回：`auto | confirm` only；提升/记忆类**建议须用户确认**（见 `docs/ARCHITECTURE-RESET.md`）。

## 心智（用户词 ≤5 → 系统）

```text
记一下            默认 append 动态周期本；低信心 → 收件箱
动态              stream packing（默认 weekly）+ loose-stream；yearDir: true（按年分组）
专题              {类别}/{YYYY-主题}/
我的情况          memory/profile.md（global；完成/过期确认后归档到 ## 历史记录）
写出来            role:delivery（常 88-输出）
```

```text
类别（Category）  {NN-Name}/     文件系统自发现
专题（Topic）     {类别}/{YYYY-主题}/
周期本            YYYY-Www.md / YYYY-MM-DD.md（stream.packing）；yearDir: true → {YYYY}/ 周期本
对象              topic.md · *.md · images/
交付              role:delivery 扁平文件
安全层            role:system
```

默认模板 **`stream`**：收件箱 · 动态 · 专题 · 输出 · 归档。4 种 Profile：stream / balanced / research / periodic。

## 6 条核心规约（不可破 · 见 PROJECT-MODEL.md §3）

1. **大类不重叠** — 同一主题只落一个类别  
2. **专题自然涌现** — 默认不建专题；反复出现时**建议**升专题（勿对用户说「涌现」）  
3. **动态类** — loose-stream / flat-default：默认周期本或平铺，不强建专题  
4. **兜底清理** — `catchAll: true` 约 30 天回顾  
5. **参考资料** — `referenceOnly: true` 只放反复引用素材  
6. **类别命名稳定** — 改名走 migration  

## stream / memory 配置（v4 contract）

读 `topmind.yaml`（contract_version 4）：

```yaml
stream:
  packing: weekly      # atom | daily | weekly | monthly
  append_heading: day  # day | none
  year_dir: true       # true | false（默认 true；按年分组）

memory:
  dir: memory
  layers:
    global:   { file: profile.md, update: on-suggest }
    periodic: { dir: periodic, cadence: weekly, style: brief }  # 反思非摘要
    topics:   { dir: topics, auto_create: false }
  promotion: { enabled: true, min_occurrences: 2, require_confirm: true }
```

- packing: `atom` | `daily` | `weekly` | `monthly`  
- 记一下 → loose-stream 且 packing≠atom → **append 当前周期本**  
- 我的情况 → `memory.append-profile`；周期反思 → `memory/periodic/{YYYY}/`；**开专题** → 内容大类 `{YYYY-主题}/`（非默认 memory/topics）  
- **输出语言**：文档 AI（改写笔记 / Agent 写入）= 用户本轮要求 → 原文 → `workspace.locale`；产品 AI（建议条 / 待办 / memory_organize）= 用户本轮要求 → 当前宿主 UI（`auto` 不算）→ 工作区 locale。见 [`output-language.md`](./output-language.md)。


## 命名

- 专题目录：`YYYY-主题`（kebab-case）  
- **不用** `YYYY-类型-项目名`、`project_type`  
- 类型由物理类别位置表达；笔记 frontmatter 用 `category`（目录名）+ `topic`  

## 专题形状

```text
{类别}/{YYYY-主题}/
├── topic.md     # 可选；缺失不得报错
├── *.md           # 笔记在专题根
└── images/        # 可选
```

**不要默认创建**：`outline.md` / `setting.md` / `style.md`、专题内 `outputs/` / `notes/`、`INDEX.md` 硬索引、`entities/` 默认树、平行 `raw/`/`wiki/` 目录。

## 复利纪律（行为，不改结构）

导航靠**类别+专题树 + 搜索 + 可选 topic.md**，不维护硬索引。

| 动作 | 纪律 |
|------|------|
| organize | 整理/总结默认落盘专题根笔记（按 writeback）；不只回话；可建议 memory 候选，不自动写 topic.md |
| write | 有 `topic.md` 先读再写；无则不强制创建 |
| memory | 仅用户明确沉淀；禁止 capture 自动改 memory/topics/ |
| capture | 只写材料笔记；不改 topic.md、不自动链式 |
| loop | 材料多而首页空时只**建议** organize/memory，不代写记忆/不建 INDEX |

## source_type

| 值 | 含义 |
|----|------|
| `user-original` | 用户原文，保字句 |
| `external-capture` | URL/文件/外部源 |
| `ai-derived` | AI 总结/草稿 |

## 配置与解析（必读）

1. 工作区根由 host 提供，不硬编码绝对路径  
2. 读 `{workspace}/topmind.yaml`（contract_version **4**）：
   - `workspace.template` · `workspace.category_separator` · `presentation.views` · `ingest.connectors`
   - **`categories.extensions`**：用户新增一级类的 name / role / specialBehavior  
   - **`categories.overrides`**：对已有 slot 的 role / hidden 覆盖  
3. **扫盘**所有 `^\d{2}[ -].+` 目录 = 活跃类别（FS 真源）  
4. 角色合并：overrides > extensions > `templates/{template}.json` > 默认 `deep-work`  
5. 有 UTR 时优先：`workspace-read.list-categories`（返回完整 CategoryDescriptor）  
6. **禁止**把固定表（如旧 `00 收件箱`…）当合法类别白名单；自定义 `11-健康/` 合法  

### CategoryDescriptor（最小字段）

```text
slot · name · directory · role · specialBehavior? · catchAll? · referenceOnly?
source: fs+config | fs+template | fs-only | …
```

### 智能体入口协议

```text
任何 capture / organize / write / maintain / loop 开始前：
  1) 解析类别表（list-categories 或 扫盘 + 读 config）
  2) 跳过 hidden；按 role / specialBehavior 路由
  3) 再写回
新建个性化大类时：
  mkdir {NN}{sep}{名称}/  且  写入 categoryExtensions[NN]
重命名大类时（规约 6）：
  必须 rename 目录 + 更新树内 frontmatter.category + config
  禁止 silent 改名；loop 不得改类别名
可选加速（非真源）：
  .topmind/workspace-map.json — 可删，随时 rebuild
```
