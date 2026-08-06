# DESIGN.md — 产品设计与交互原则

> **设计北极星**：任意外部工具打开工作区都能一眼看清结构；交互贴近口语；文件系统即真源；Desktop 是**富工作台**（非薄聊天壳）。  
> **产品北极星**：**最低摩擦个人动态流** — 记下来尽可能简单；AI 默认可生成建议；用户确认后再沉淀。  
> 三体边界：`PRODUCT-BOUNDARIES.md` · 内容约定：`PROJECT-MODEL.md` · 实施锁：`docs/ARCHITECTURE-RESET.md`  
> Desktop 像素 / IA 细节：`topmind-desktop/DESIGN.md`（UI 唯一真源，本文不复制线框）。

---

## 1. 用户概念硬上限（≤5）

| 用户说 | 含义 | 系统落点 |
|--------|------|----------|
| **记一下** | 存下来 | 动态周期本 / 收件箱 / 专题 |
| **动态** | 日常流水 | `role:loose-stream`；默认每周一本 |
| **专题** | 长期主题夹 | `{大类}/{YYYY-主题}/` |
| **我的情况** | 关于我的稳定信息 | `memory/profile.md` |
| **写出来** | 出成品 | role:delivery（常为 88-输出） |

**不要**在产品 UI 教用户：沉淀、涌现、protection、derived、writeback_mode、schema、engine、UTR 命令名。  
设置白话：「保存前问我」「重要文件不让 AI 直接改」「自动准备 AI 建议」「自动 AI 整理待办（默认关）」。

工作流：

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

用户动词：`记一下 → 继续做 → 整理本周 / 写出来 → 找回`。

---

## 2. Desktop 定位

topmind Desktop 是**本地富个人工作台**。它不是：

- ❌ 特定领域写作工具独占  
- ❌ 项目管理软件  
- ❌ AI Chatbot 界面 / 薄聊天壳  
- ❌ UTR 的图形壳  

它是：

- ✅ 浏览 · **深度编辑** · 捕获 · AI **副驾** · 恢复 · 可扩展  
- ✅ 文件系统智能视图层  
- ✅ 导航与概念面**清晰、简单**（默认动态；树/标签/看板二级）  
- ✅ 无 UTR 也能完整使用  

### 2.1 心智模型（个人 Stream）

topmind 的主表面是**个人动态流**——不是文件夹管理器、不是社交时间线、不是聊天机器人。

```text
打开 → 看见「我的 Stream」：按日时间线 + 随便「记下」
  → 随手记进周期本；对旧条「增补」（像备注/评论 · 同文件续写）
  → 不必先分类：整理/建议在活动窗口上跑（近期动态 + 改过的笔记 + 增补原文）
  → 有建议时标题栏灯泡 / 画布顶条提醒 → 点开 **全局建议面板** 确认
  → 确认后：待办 · 我的情况/周期摘要 · 内容大类专题 · 写出来
  → 文件永远是真源；不需要复杂思考与操作
```

**产品特色一句话**：随便记 → 自动建议 / 整理 / 待办 / 记忆 → **你点头再落盘**。

### 2.2 导航变薄（Done · Phase B）

```text
标题栏主锚点：动态（默认） · 收件箱 · 写出来 · 搜索 · 记一下 · AI
侧栏默认：本周动态 / 周期本
二级：专题树 · 我的情况 · 归档
高级（折叠 / ⌘K）：标签 · 看板 · 插件 · Tools
```

- **富**：编辑器、阅读 Aa、插件槽、连接器、多视图能力保留  
- **薄**：同屏 chrome 与概念一次摊开的数量下降  
- Desktop `PrimaryNav` 默认 selection = **动态**；legacy `kind:home` soft-heal → stream（见 `topmind-desktop/DESIGN.md`）  

### 2.3 保存设置（AI 写回）

协议：`writeback_mode: auto | confirm`。

| 档位 | 白话 | 语义 |
|------|------|------|
| `auto` | 自动保存（默认） | 单文件直接写 + 路径回执（receipt）；危险改动备份 |
| `confirm` | 保存前问我 | AI 写工具仍注册；结果进入**审阅入口**（待确认写入 / SuggestPopover），用户接受后再落盘 |

**优先级**：`protection` > `writeback.mode`（locked 时 AI 禁止直接写）。

**主动智能（Reset D · Done）**：

| 模式 | 行为 |
|------|------|
| **自动准备 AI 建议**（默认开 · 可关） | 工作区就绪后可扫描并生成建议卡片；已配置模型时可能调用 AI 提炼；**不静默执行高影响写** |
| **自动 AI 整理待办**（默认**关**） | 可选：就绪后从动态提取/更新 `memory/todo.md`；关则仅 Stream ✨ / 待办面板手动触发，省 Token |
| **手动触发** | 「整理本周」/ loop / 命令面板 / 建议刷新 / 待办 ✨ 随时可跑同一管线 |
| **确认后执行** | 用户接受建议 → 再写；仍过 protection + writeback |

建议类型示例：提升到「我的情况」或主题记忆、Inbox 归位、陈旧专题归档、周期摘要。

全局 **SuggestPopover**（标题栏灯泡 / 有条目时顶条）为主确认面；AI 面板 **ActionBar 芯片** 为次入口。状态栏显示 AI 工作中 / 后台任务 / 待办整理。

### 2.4 专题内极简 `*.md`

```text
{类别}/{YYYY-专题}/
├── topic.md          可选首页
├── *.md
├── images/           可选
└── .derived/         可选 AI 衍生
```

无 outline / entity / section 强制 tabs。

### 2.5 可逆恢复

危险写回前备份；恢复需确认。数据在 `99-归档/backups/` 等。  
**状态**：**Partial**（写闸备份已开；`edit` 故意 `skipBackup`，全覆盖非本阶段目标）。

### 2.6 模板 4 Profile

新建工作区：stream（默认）· balanced · research · periodic → 生成 `topmind.yaml`。

---

## 3. 交互口径

**6 条核心规约**（见 `PROJECT-MODEL.md` §2）：大类不重叠 / 专题自然涌现 / 动态类特殊 / 兜底类清理 / 参考资料定位 / 类别命名稳定。

- **口语化**：「记一下」而非工具命令名  

- **三种状态**：Loading / Success / Error（可重试 + 诊断）  
- **证据可见**：保存路径 + 可在 Finder 定位  
- **口语词**：类别 · 专题 · 笔记 · 动态 · 我的情况 · 写出来  

---

## 4. 用户工作流映射

```text
收进来 -> 继续做 -> 交付/沉淀 -> 找回/调整
```

- **类别目录** — 物理载体  
- **00-收件箱** — 缓冲（role:buffer）  
- **99-归档** — 历史安全层（仅找回时访问）  
- **pending** — 前端/运行时审阅队列，**不是**目录或类别  

### 4.1 写回证据

每次写入返回：

- **target path** / `target_path`  
- **affected files** / `affected_files`  
- **receipt** / 回执（operation · writeback_mode · saved_at · next_actions）  

完整契约：`TOOLS.md` §Writeback Contract。  
**状态**：Desktop / UTR / AI 耐久 `.md` 主路径经 Kernel `writeback-engine`（**Done**）；非 `.md` 二进制 copy 可仍直写。

---

## 5. 文件系统感知

Desktop 是文件系统的智能视图层：

- 监听工作区变更（排除归档内部噪音与隐藏文件）  
- 外部编辑器改文件应反映到 UI  
- **不**维护第二套内容数据库  
- 派生索引可重建，非真源  

兼容：Obsidian · VS Code · 任意编辑器 · Git · grep。

---

## 6. 多工作区

- 一次一个活跃工作区  
- 切换 = 重新扫描 FS  
- 切换器：当前 + 最近 + 打开其他  

---

## 7. AI 内生原则（产品）

1. **副驾不是主角** — 正文区优先；AI 面板可折叠  
2. **默认带上下文** — 当前文件 · 本周流 · profile 短摘  
3. **建议默认、写入受约束** — 见 §2.3  
4. **skill-first** — 与可移植 Skills 同构  
5. **不内嵌通用 coding-agent 内核** — 领域工具写回工作区  
6. **路径回执** — 每次写让用户知道写到哪  

状态：对话 · 领域工具 · 建议条 · 待确认写入 · open/locked 写闸 **Done**（语义索引 / Ask → Phase C **Target**）。

---

## 8. 可扩展性

```text
核心主路径: 记一下 · 动态 · 编辑 · 建议确认 · 写出来 · 找回
富能力:     行内 AI · 多视图 · 插件 · 连接器 · 知识加工
高级:       Tools/UTR · 标签/看板 · 深度设置
```

- 扩展不进默认主 chrome  
- 扩展不改变三平面文件结构  
- 新能力先问是否 Kernel 动词，再问 UI 槽  

插件：`topmind-desktop/PLUGIN.md`。

---

## 9. 设计硬约束

- 导航按**类别 + 专题**，不用平行「项目类型」字段  
- 用户概念 ≤5；UI 白话  
- 不默认创建 outline / setting / style；专题极简 `*.md`  
- 交付 `88-输出/`；安全层 `99-归档/`  
- 不新增全局 `references/` · `sources/` · `library/` 根  
- Loop / 建议可感知；UTR 域为 `workspace-*` / `memory.*` / `contract.*` / `lifecycle.*` / `derived.*`  
- **pending 不是目录或类别**  

同步：`PROJECT-MODEL.md` · `SKILL-ARCHITECTURE.md` · `TOOLS.md` · `PRODUCT-BOUNDARIES.md` · `docs/ARCHITECTURE-RESET.md`。
