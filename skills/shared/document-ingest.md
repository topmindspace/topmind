# 本地文档与统一捕获

> Desktop：统一捕获 + 知识加工管道。网页分层见 [`long-url-capture.md`](./long-url-capture.md)。

## 心智模型

```text
笔记 / 链接 / 剪贴板 / 文档
         ↓
   智能分流
    ├─ 文本·URL  → 收件箱笔记
    ├─ 本地路径  → 管道批次（路径引用，不预拷贝）
    │                 ├─ confirm 关（默认）→ 自动入处理队列
    │                 └─ confirm 开       → 待确认列表 → 入队
    │                        ↓
    │                 转 Markdown → Inbox / 专题
    └─ 复合     → 两者都做
```

| 入口 | 适合 |
|------|------|
| **⌘N** | 应用内速记、贴链接 |
| **⌘⇧N** | 全局便签（任意 App 上浮出） |
| **拖入窗口** | 路径进入加工管道（默认自动入队） |
| **侧栏「知识加工」** | 看队列、批处理、本机工具 |

**确认策略**（设置 → 知识加工 →「转换前确认」）：

- **关闭（默认）**：与历史一致，拖入/导入后进入处理队列并转换  
- **开启**：先显示待转换列表，可剔除/改选后再一键确认  

剪贴板文件 = **路径引用**进管道，不是把原件再复制一份到工作区（除非开启「保留原件」归档）。

## 剪贴板

| 内容 | 行为 |
|------|------|
| 纯文本 / 链接 | 进捕获正文；URL 可抓取 |
| HTML | 作摘录 |
| 资源管理器 / Finder 复制的文件 | 入加工管道 |
| 粘贴 FileList | 优先 `getPathForFile` |

Windows 以捕获窗粘贴与路径文本为主；路径须真实存在。

## 全局便签

轻量独立窗（可置顶）· 设置 → 通用 → **统一捕获**：`float`（默认）| `overlay`。

## 落点

默认 **Inbox**。转换后 frontmatter 示例：

```yaml
source_type: external-capture
source: original.pptx
ingest_kind: pptx
ingest_converter: pptx-ooxml | markitdown@…
```

失败时原件导入 + 说明笔记；可选原件进 `99-归档/ingest-originals/`。

相关：网页剪藏分层见 [`long-url-capture.md`](./long-url-capture.md)；能力勾选见 [`../../docs/capture-clip-matrix.md`](../../docs/capture-clip-matrix.md)。

## 格式与本机工具

| 能力 | 说明 |
|------|------|
| **内置** | md/txt/html · docx · pdf 文本 · xlsx/csv · pptx 文本 · eml |
| **可选增强** | [markitdown](https://github.com/microsoft/markitdown) · [pandoc](https://pandoc.org/) |
| **不做** | 扫描件 OCR（会提示文本过少） |
| **单文件上限** | 默认 **80MB**（可在设置 → 知识加工调到 200MB）。含图 PPT 常超 25MB；超限时**原件仍导入**，不自动转 MD |

### 安装命令（务必带 `[all]`）

PPTX 等格式依赖扩展包；**不要**只装裸 `markitdown`。

| 系统 | 推荐 |
|------|------|
| **Windows** | `py -3 -m pip install "markitdown[all]"` |
| **macOS** | `pipx install 'markitdown[all]'` |
| **Linux** | `pipx install 'markitdown[all]'` |

备选：`python -m pip install "markitdown[all]"` / `pip3 install --user 'markitdown[all]'`。  
pandoc（可选）：Windows `winget install --id JohnMacFarlane.Pandoc -e` · macOS `brew install pandoc` · Linux `apt/dnf install pandoc`。

装完后：**设置 → 知识加工 → 重新检测**。仍未检出 → 完全退出再开 Desktop。

**检测时机**：首次打开知识加工设置会自动检测一次并**缓存**结果；之后打开设置/Hub **不会**反复扫 PATH，需手动「重新检测」。

### Desktop 如何找到工具

GUI 往往不继承终端 PATH。探测会：

1. 合并 Python `Scripts`、Homebrew、Pandoc 安装目录等  
2. 查找 `markitdown` / `pandoc` 绝对路径  
3. markitdown 回退：`py -3 -m` → `python -m` → `python3 -m`  
4. **探测与转换用同一调用方式**  
5. Windows：`PYTHONUTF8=1`；`.cmd` 经 `cmd.exe` 正确引号  

仅装基础 markitdown 时，PPTX 会回退内置 `pptx-ooxml` 抽文本。队列会显示具体失败原因（悬停看全文）。

## Agent（topmind-capture）

1. 文本/URL → 常规 capture  
2. 本地路径 → 转 MD 或请用户用 Desktop 知识加工  
3. frontmatter + 路径回执；不自动 organize  

触发：记一下 · 导入文档 · 粘贴文件 · 转 md · 快速笔记。
