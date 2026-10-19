# ADR: 库边界与本地缓存上限（2026-10-19）

> **状态**：Accepted  
> **日期**：2026-10-19  
> **范围**：Kernel `lib/vault-walk.mjs` · Desktop 监听与遍历 · UTR · Obsidian 插件代理文件遍历 · 本机状态目录

## 背景

工作区是 Obsidian 库。库内一个指向 `/Applications` 的符号链接（名字是单个空格）让 chokidar 默认 `followSymlinks: true`，对应用包里每个目录 `fs.watch`。macOS 上每个目录占用一个文件描述符，耗尽后抛 `EMFILE`。这个错误从 watcher 的 `error` 事件变成 `unhandledRejection`，启动框对每个 framework 弹一次「topmind crashed」。

同一条路径上，用 `stat` 跟随链接的全量遍历（索引、搜索、图片列表、清理）也会走进应用包。本机状态目录里，Chromium `Cache` / `Code Cache` 和崩溃留下的 `app-settings.json.tmp.*` 没有上限。

## 决策

- 监听 `followSymlinks: false`。指向库外的符号链接忽略；悬空链接同样视为越界。已经存在的路径如果 realpath 落在库外（中间某一段是越界链接），列出和搜索也停住。这与写路径 `isPathInsideWorkspace` 是同一条围栏。
- 不递归 macOS / 编辑器包（`.app` `.framework` 等）以及 `node_modules`、`dist`、`__pycache__`、`__MACOSX`、`venv`。
- `.obsidian/app.json` 的 `userIgnoreFilters` 是 JavaScript 正则，匹配库内相对路径。监听、索引和全量遍历都认这一份，不另建忽略文件。
- `EMFILE` / `ENFILE` 记日志、关掉 watcher、不弹崩溃框。其他未处理拒绝仍只弹一次。
- 单实例锁拿到之后、窗口打开之前，裁剪可重建缓存：`Cache` 128 MB、`Code Cache` 64 MB，GPU 相关缓存各 32 MB。不碰 `state/`、日志、Cookies。
- 设置原子写的 `*.tmp.*`：空文件立刻删；非空文件超过 2 分钟删。`rename` 失败时删掉临时文件。
- 远程图片缓存 `.topmind/media-cache` 上限 80 MB 或 400 个文件，按最旧优先删。
- 支持日志本来就有 2 MB × 3 的轮转，这次不改。

Desktop 不能静态引用 monorepo `lib/`（asar 会崩），所以名字和忽略规则在 `electron/lib/file-filter.mjs` 里有一份锁定副本，符号链接判断在 `electron/lib/path-safety.mjs`。测试要求两边一致。

## 不变项

- 不删除用户库里的符号链接或 `.app`。Obsidian 文件列表仍可能显示它们，除非用户自己写 `userIgnoreFilters`。
- 笔记树可以不展开这些目录。`images/` 仍可见。
- 归档复制的文件计数不改，避免和 `fs.cp` 对不齐。

## 验收

- 打开含库外链接和应用包的工作区不再因 `EMFILE` 弹崩溃框。
- 真实笔记的变更仍能收到；包内和库外文件的变更不会进来。
- 清理空目录不会进入包或库外链接。
