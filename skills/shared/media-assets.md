# 媒体资源约定（图片 / 附件）

> 内容真源：工作区文件系统。图片与笔记同树，Markdown 用**相对路径**关联。

## 目录

```text
{dest}/                          # Inbox 根 或 类别根 或 专题根
├── note-title.md                # 笔记
└── images/
    └── {slug}/                  # 按笔记标题或 clip slug 分夹
        ├── img-{sha1-12}.png
        └── img-{sha1-12}.webp
```

| 落点 | `dest` | 笔记示例 | 图片目录 |
|------|--------|----------|----------|
| Inbox | **role:buffer**（常 `00-收件箱/` / `00-Inbox/`） | `{buffer}/2026-07-21-foo.md` | `{buffer}/images/{slug}/` |
| 类别根 | `20-研究/` | `20-研究/散记.md` | `20-研究/images/{slug}/` |
| 专题 | `20-研究/2026-主题/` | `…/note.md` | `…/images/{slug}/` |
| 交付 | `88-输出/` | `88-输出/YYYY-MM-DD-标题.md` | `88-输出/images/{slug}/`（发布时复制） |

## Markdown 写法

```markdown
![说明](images/{slug}/img-a1b2c3d4e5f6.png)
```

- 路径相对**笔记文件所在目录**（不是工作区根）。
- 不要写 `file://` 绝对路径；不要默认内嵌 base64（会撑爆笔记与会话）。
- 同一远程图多次出现时，本地化应去重（同 hash 同文件）。
- **Desktop 编辑器**加载时会把相对图改写为 `topmind-asset://local/{工作区相对路径}` 以便预览；**写回磁盘时再改回相对路径**（内容真源始终是相对路径）。

## 工作流：移动 / 发布 / 删除

| 操作 | 原文 | 关联 `images/` | 说明 |
|------|------|----------------|------|
| **移入专题**（整理） | 移动到 `{类别}/{专题}/` | **一并移动** | MD 内相对路径不变；更新 frontmatter `category`/`topic` |
| **发布交付副本** | **保留** | **复制**到 `88-输出/images/` | 在 `88-输出/` 生成扁平 `YYYY-MM-DD-标题.md`；需用户确认 |
| **删除笔记** | `.md` 文本进 trash | **关联 `images/{slug}/` 进 trash** | 可逆；空 `images/` 父目录会清理 |
| **重命名笔记** | 改 `.md` 文件名 | **`images/{旧stem}/` → `images/{新stem}/`**，并改写正文引用 | 仅改 stem 约定夹；其它 slug 夹不碰 |

### 发布（publish）语义

```text
发布 ≠ 移走
发布 = 交付层快照副本 → 88-输出/
```

- 适合：定稿、对外分享、归档交付物索引  
- 不适合：代替「整理到专题」  
- UI：必须确认；文案说明「原文保留 + 资源复制」

### 整理（move）语义

```text
整理 = 笔记 + images/{slug}/ 迁入目标专题根
```

- Inbox / 任意笔记位置 → 专题  
- Desktop：Inbox「整理」· 编辑器工具栏「整理」· 右键「移入专题…」  
- AI 工具 `move_to_topic` 走同一路径（含资源）

## 谁负责下载

| 通道 | 行为 |
|------|------|
| Desktop Clip Bridge | `html-to-markdown` 解析 img/lazy/srcset → 绝对 URL → `localizeMarkdownImages` 写入 `images/{slug}/` 并改写 MD |
| 扩展工作区直写 | 同上（`localize-images.js`）；需 `host_permissions` 允许拉取图片域名 |
| Desktop URL 抓取 | `fetch-article` + baseUrl 解析后同样可走本地化（若调用方启用） |
| 编辑器粘贴/拖入图片 | `workspace.saveBinary` → `images/{noteStem}/` + 插入相对 `![](…)` |

## 开关

- Bridge / 设置：`clipBridge.downloadImages`（默认 **开**）
- 请求体：`download_images: false` 可单次关闭
- 选区 / 高亮 / 书签模式：默认**不**下图

## 限制（防滥用）

- 单篇最多约 **40** 张
- 单张约 **8MB**
- 下载超时约 **15s**；带 `Referer: 源页` 降低 CDN 防盗链失败
- 失败时保留原远程 URL，不阻塞剪藏正文

## 不做

- 不把图片二进制塞进 frontmatter  
- 不建全局 `assets/` / `media/` 根目录（用专题/笔记旁 `images/`）  
- 不把「发布」做成静默移入 Outputs  
