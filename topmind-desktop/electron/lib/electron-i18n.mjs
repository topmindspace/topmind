/**
 * Lightweight i18n for Electron main process.
 *
 * The main process can't use react-i18next, so this module provides a minimal
 * translation function with a flat key→value map per locale.
 *
 * Locale is resolved from:
 *   1. Explicit setLocale() call (from settings.ui.locale)
 *   2. topmind_LOCALE env var
 *   3. app.getLocale() (Chromium OS locale)
 *   4. Default: "zh-CN"
 */

const STRINGS = {
  "zh-CN": {
    "menu.view": "显示",
    "menu.window": "窗口",
    "menu.develop": "开发",
    "menu.openLogs": "打开日志目录",
    "tray.show": "显示 topmind",
    "tray.capture": "记一下…",
    "tray.ingest": "知识加工…",
    "tray.quitMac": "退出 topmind",
    "tray.quit": "退出",
    "tray.hiddenMessage": "topmind 仍在托盘运行。点击托盘图标可重新打开。",
    "capture.title": "记一下",
    "capture.loadFail": "捕获窗加载失败 ({{code}}): {{desc}}",
    "capture.errorTitle": "无法打开记一下",
    "capture.errorHint": "请确认应用已 build，或通过桌面端开发脚本启动（dev server）。",

    "workspace.missingPath": "缺少工作区路径",
    "workspace.openFail": "无法打开工作区: {{resolved}}",
    "workspace.emptyPath": "路径为空",
    "workspace.notExist": "目录不存在",
    "workspace.accessFail": "无法访问（{{code}}）",
    "workspace.notDirectory": "路径不是文件夹",
    "workspace.readFail": "目录无法读取",
    "workspace.usable": "可用",
    "workspace.emptyFolder": "空文件夹（打开时将初始化类别）",
    "workspace.forbiddenRuntime": "不能把应用运行目录 / Desktop 状态目录当作内容工作区",
    "workspace.openFileFail": "无法打开文件: {{error}}",

    "ingest.fileNotFound": "文件不存在",
    "ingest.overLimit": "超过转换上限 {{limit}}MB（将导入原件）",
    "ingest.createFail": "未能创建导入任务",

    "ai.cancelled": "用户取消。",
    "ai.timeout": "超时（4 分钟）。",
    "ai.stalled": "中断（120 秒无数据，可能是工具链过长）。",
    "ai.steer": "[用户中途指示 · 立即遵从，可中止原计划中未完成步骤]\n{{body}}",
    "ai.stepLimit": "[系统] 步骤将尽：优先完成当前目标并给出路径回执；勿再开无关大范围搜索。",
    "ai.noProvider": "未配置 AI 提供商",
    "ai.noSelection": "请先选中或提供文本",
    "ai.textTooLong": "文本过长（上限约 3.2 万字），请缩短后重试",
    "ai.polish": "润色：更通顺、专业，不改变原意与信息量；只输出应替换选区/目标段的正文；贴合全文文风与 Markdown 结构（标题层级、列表标记、段落密度），不要复述未选中全文，不要另起一套写法或加前言后语。",
    "ai.shorter": "更简洁：删冗余，保留关键信息；保持与全文一致的列表/标题风格。",
    "ai.expand": "扩写：在不编造事实的前提下稍作展开与衔接；语气与结构贴合全文。",
    "ai.bullets": "改成清晰的 Markdown 无序列表（若已是列表则整理层级）；列表标记与全文一致。",
    "ai.formal": "语气更正式、书面；仍贴合全文版式。",
    "ai.casual": "语气更口语、轻松；仍贴合全文版式。",
    "ai.fix": "修正错别字、标点与明显语法问题，尽量少改表述；保持全文 Markdown 结构。",
    "ai.format": "格式优化：按整篇文档的既有版式整理 Markdown——统一标题层级、列表标记、段落间距与空行习惯；与上下文结构一致，不另起冲突的标题体系；不改变原意与事实；不要加前言后语。",
    "ai.continue": "续写：根据上下文自然往下写 1～3 段，不重复已有内容。",
    "ai.summarize": "总结：提炼要点，可用无序列表，保留关键事实。",
    "ai.generate": "生成：根据指令和上下文创作新内容，贴合全文文风与 Markdown 结构；只输出应替换选区/目标段的正文。",
    "ai.translate": "翻译：自动检测中英文并互译；保持 Markdown 结构、标题层级和格式不变；只输出应替换选区/目标段的正文。",
    "ai.enhanceNoContent": "增强渲染后仍几乎无正文，请手动粘贴或检查登录墙。",
    "ai.enhanceFail": "增强渲染失败（{{reason}}）。已回退静态抓取。{{warning}}",

    "utr.unavailable": "UTR 不可用（引擎未打包 utr 或加载失败）。日常编辑/保存不依赖 UTR。",
    "utr.nativeHealth": "Desktop 原生健康检查完成（UTR 未加载）。",
    "utr.noWorkspaceHealth": "未打开工作区，跳过原生健康检查。",

    "window.closeTitle": "关闭窗口",
    "window.closeMessage": "关闭窗口时要做什么？",
    "window.hideMac": "隐藏到程序坞",
    "window.hideTray": "最小化到系统托盘",
    "window.hideOther": "隐藏到托盘/任务栏",
    "window.quit": "退出 topmind",
    "window.cancel": "取消",
    "window.hideMacHint": "隐藏后应用仍在运行，可从程序坞或全局 ⌘⇧N 打开。",
    "window.hideTrayHint": "最小化后 topmind 仍在系统托盘运行（右下角图标）。点击托盘图标可重新打开；右键可捕获/退出。",
    "window.hideOtherHint": "隐藏后应用仍在运行，可从托盘图标或全局快捷键打开。",
    "window.rememberChoice": "记住我的选择",
    "window.trayHiddenMac": "topmind 已最小化到托盘。点击托盘图标可重新打开。",
    "window.trayHiddenOther": "topmind 已最小化到托盘。点击托盘图标可重新打开。",

    "dialog.selectPluginFolder": "选择插件文件夹（含 topmind-plugin.json）",
    "dialog.selectPluginZip": "选择插件 zip",
    "dialog.selectWorkspace": "选择 topmind 工作区",
    "dialog.selectSkillsDir": "选择 Skills 目录（含 SKILL.md 或 topmind-pack.json）",
    "dialog.publishedTweet": "已发布推文",

    "pathOps.frontmatterMdOnly": "仅支持 .md 文件的 frontmatter 更新。",
    "pathOps.editMdOnly": "仅支持编辑 .md 文件。",
    "pathOps.newTextNotString": "newText 必须是字符串。",
    "pathOps.newTextTooLong": "newText 过长。",
    "pathOps.sameTextNoWrite": "oldText 与 newText 相同，未写入",
    "pathOps.fileNotExist": "文件不存在: {{path}}",
    "pathOps.oldTextNoMatch": "oldText 未命中（精确 + 换行/行尾空白规范化后仍无唯一片段）。请看下方 nearby/context，或用 read_file around= 再试。路径: {{path}}",
    "pathOps.oldTextMultiMatch": "oldText 匹配 {{count}} 处；请扩大上下文使唯一，或设 replaceAll=true。路径: {{path}}",
    "pathOps.contentUnchanged": "内容未变化",
    "pathOps.replacedCount": "已替换 {{count}} 处（经 Kernel 写闸；未写 Archive 快照）",
    "pathOps.saveMdOrHtml": "仅支持编辑 .md 文件（交付 HTML 导出除外）。",
    "pathOps.htmlOutputsOnly": "HTML 导出仅允许写入「写出来」目录。",
    "pathOps.offsetBeyondEnd": "offset {{start}} 超出文件末尾（共 {{total}} 行）",
    "pathOps.returnedLinesContinue": "已返回第 {{start}}–{{end}} 行 / 共 {{total}} 行；用更大 offset 继续读",
    "pathOps.returnedLines": "已返回第 {{start}}–{{end}} 行 / 共 {{total}} 行",
    "pathOps.permanentlyDeleted": "已永久删除（不可恢复）",
    "pathOps.deletedWithMedia": "已删除（含 {{count}} 处关联资源进 trash；经 Kernel 写闸）",
    "pathOps.deleted": "已删除（经 Kernel 写闸）",
    "pathOps.newNameNoSeparator": "新文件名不能包含路径分隔符。",
    "pathOps.targetExists": "目标已存在: {{path}}",
    "pathOps.renamedWithMedia": "已重命名；关联资源夹 → {{dir}}",
    "pathOps.publishMdOnly": "仅支持发布 Markdown 笔记。",
    "pathOps.publishedWithMedia": "已发布交付副本（含 {{count}} 处资源）；原文保留",
    "pathOps.published": "已发布交付副本；原文保留",
    "pathOps.topicNameYearPrefix": "专题名需以 YYYY- 开头，如 2026-示例研究",
    "pathOps.aboutToCreateTopic": "即将创建专题: {{topicId}}",
    "pathOps.topicExists": "专题已存在: {{topicId}}",
    "pathOps.topicTrashCopyFailed": "回收拷贝未通过校验，已保留原目录未删除: {{topicId}}",
    "pathOps.topicNameNoSeparator": "专题名不能包含路径分隔符。",
    "pathOps.invalidTopicId": "无效的 topicId: {{topicId}}",
    "pathOps.sameName": "新名称与当前相同。",
    "pathOps.topicRenamed": "已重命名专题；{{count}} 个文件 frontmatter 已更新",
    "pathOps.appendedToStream": "已增补到动态",
    "pathOps.appendContentEmpty": "增补内容不能为空",
    "pathOps.appendNoChange": "增补未改变文件内容",
    "pathOps.coreMemoryUpdated": "已更新「我的情况」· {{section}}",
    "pathOps.coreMemoryPathFail": "无法解析「我的情况」路径：请先有动态类或配置 memory.dir",
    "pathOps.archiveCurrentOrFuture": "不能归档当前或未来年份",
    "pathOps.archiveYearNotFound": "该年份目录不存在",
    "pathOps.archiveNoPeriodFiles": "该年份无周期本文件",
    "pathOps.archiveAlreadyArchived": "该年份已归档",
    "pathOps.archiveNoStreamCategory": "找不到动态类目录",
    "pathOps.archiveNoArchiveCategory": "找不到归档目录",
    "pathOps.archiveFailed": "归档失败",
    "pathOps.archiveDone": "已归档 {{year}} 年动态（{{count}} 个周期本）→ {{path}}",
    "pathOps.reconcileAtomPacking": "当前为「每条一卡」，请改用每周一本或指定文件路径",
    "pathOps.reconcileNoPeriod": "找不到当前周期本",
    "pathOps.reconcilePeriodMissing": "周期本不存在：{{path}}",
    "pathOps.reconcileApplied": "本周动态已理顺（{{count}} 处）",
    "pathOps.reconcilePreview": "预览：{{count}} 处可理顺",
    "pathOps.reconcileClean": "本周动态已较整齐，无需改动",

    "fetch.spaHint": "正文极少，可能是需 JavaScript 渲染的页面。可点「增强渲染」或手动粘贴。",
    "fetch.truncated": "正文已截断（上限 {{cap}} 字符）。可改用「完整抓取」提高上限，或拆成多条笔记。",
    "fetch.noContent": "未能提取有效正文，请手动粘贴内容。",
    "fetch.urlScheme": "URL 需以 http:// 或 https:// 开头。",
    "fetch.timeout": "抓取超时（20s）：{{msg}}",
    "fetch.networkError": "网络错误：{{msg}}",
    "fetch.unsupportedContentType": "不支持的内容类型: {{ct}}（仅网页/文本）",
    "fetch.tooLarge": "页面过大（>5MB），未抓取。",
    "fetch.renderTimeout": "增强渲染超时（{{sec}}s）",
    "fetch.renderFail": "渲染加载失败: {{desc}}",
    "fetch.renderNoHtml": "增强渲染未得到有效 HTML",
    "fetch.mdTruncated": "\n\n...(内容已截断)",

    "inbox.fileReadFail": "无法读取拖入的文件。",
    "inbox.fileOverLimit": "文件 {{mb}}MB 超过导入上限 {{max}}MB（请用「知识加工」队列，可在设置中调高上限）。",
    "inbox.moveToTopicMdOnly": "仅支持移动 Markdown 笔记。",
    "inbox.moveToTopicFileNotExist": "文件不存在: {{path}}",
    "inbox.alreadyInTopic": "已在目标专题，未移动",
    "inbox.movedWithMedia": "已移入专题（含 {{count}} 处关联资源）",
    "inbox.moved": "已移入专题",
    "inbox.recordedTo": "已记到{{label}}",
    "inbox.streamTitleFallback": "动态",

    "batch.multiFileWrite": "本轮多文件写回 {{items}} 处 · 目标 {{paths}} · 备份 {{backups}}",
    "ingest.originalImported": "原件已导入：`{{fn}}`",
    "ingest.convertFailed": "转换失败：{{error}}",
    "ingest.retryHint": "可安装 anydoc（推荐，无需 Python）或 markitdown / pandoc 后在「知识加工」中重试，或手动整理。",

    "weread.apiKeyMissing": "WeRead API Key 未配置。请在设置中填写。",
    "weread.invalidJson": "WeRead API 返回了无效的 JSON 响应",
    "weread.upgradeNeeded": "WeRead 需要升级 Skill：{{msg}}",
    "weread.keyInvalid": "（API Key 无效或已过期，请重新获取）",
    "weread.paramError": "（接口调用参数错误）",
    "weread.errorWithCode": "WeRead: {{msg}}",
    "weread.fetchingBooks": "正在获取有划线/笔记的书籍…",
    "weread.pagingNotebooks": "正在翻页笔记本… ({{page}})",
    "weread.fetchListFail": "无法获取有笔记的书籍列表：{{msg}}",
    "weread.noExportableBooks": "所选书籍中没有可导出的划线/想法",
    "weread.noNoteBooks": "没有带划线/想法的书籍（无笔记的书默认不同步）",
    "weread.syncProgress": "有笔记 {{count}} 本{{overview}} · → {{category}}/ · 想法{{thoughts}}",
    "weread.batchProgress": "本轮处理 {{processed}}/{{total}} 本，剩余 {{remaining}} 本下次继续（无变化会自动跳过）",
    "weread.highlightsFile": "划线笔记.md",
    "weread.backupFile": "{{stamp}}__划线笔记.md",
    "weread.highlightsTitle": "{{title}} - 划线笔记",
    "weread.sourceLine": "# {{title}}\n\n> 来源: 微信读书\n> 作者: {{author}}\n> 同步时间: {{syncedAt}}\n",
    "weread.highlightsRel": "{{category}}/{{topic}}/划线笔记.md",

    "x.xurlMissing": "xurl 不可用。安装: brew install --cask xdevplatform/tap/xurl 或 npm i -g @xdevplatform/xurl",
    "x.xurlReady": "xurl 可用 ({{cmd}}{{ver}})",
    "x.xurlNotFound": "未检测到 xurl — 发帖不可用。请按 installHints 安装并 xurl auth oauth2。",
    "x.agentMcpHint": "Agent 宿主用 xurl mcp 桥接官方 MCP；Desktop 内用 Bearer(读) + xurl(写)",
    "x.connected": "连接正常{{api}}{{cli}}",
    "x.connectedApi": " · API 只读",
    "x.connectedCli": " · xurl 可用(可发帖)",
    "x.notConnected": "未检测到可用接入层。配置 Bearer Token 或安装 xurl。",
    "x.textRequired": "需要推文正文。",
    "x.overLimit": "推文超过 280 字符限制。",
    "x.noWriteChannel": "缺少发帖通道（需要本机 xurl 用户 OAuth）",
    "x.cannotPostDraft": "无法发帖：App-only Bearer 不能写。请安装并登录 xurl（brew install --cask xdevplatform/tap/xurl && xurl auth oauth2）。草稿已保存: {{path}}",
    "x.replyNeedsRest": "回复须走官方 REST：xurl -X POST /2/tweets",
    "x.queryRequired": "需要搜索词。",
    "x.notConfiguredRead": "X 未配置。请填入 Bearer Token 或安装 xurl。",
    "x.notConfigured": "X 未配置。",
    "x.usernameRequired": "需要用户名。",
    "x.userNotFound": "用户 @{{handle}} 未找到。",
    "x.tweetsRequired": "需要推文列表。",

    "aiContext.topicCount": "{{count}} 专题",
    "aiContext.truncated": "…(截断)",

    "writeback.viewTarget": "查看 {{path}}",
    "writeback.restoreIfNeeded": "必要时从 {{path}} 恢复",
    "writeback.viewPreview": "查看预览结果"
  },
  "en-US": {
    "menu.view": "View",
    "menu.window": "Window",
    "menu.develop": "Develop",
    "menu.openLogs": "Open Logs Folder",
    "tray.show": "Show topmind",
    "tray.capture": "Note it…",
    "tray.ingest": "Knowledge Ingest…",
    "tray.quitMac": "Quit topmind",
    "tray.quit": "Quit",
    "tray.hiddenMessage": "topmind is still running in the tray. Click the tray icon to reopen.",
    "capture.title": "Note it",
    "capture.loadFail": "Capture window load failed ({{code}}): {{desc}}",
    "capture.errorTitle": "Cannot open Note it",
    "capture.errorHint": "Make sure the app is built, or start via the desktop dev script (dev server).",

    "workspace.missingPath": "Missing workspace path",
    "workspace.openFail": "Cannot open workspace: {{resolved}}",
    "workspace.emptyPath": "Path is empty",
    "workspace.notExist": "Directory does not exist",
    "workspace.accessFail": "Cannot access ({{code}})",
    "workspace.notDirectory": "Path is not a directory",
    "workspace.readFail": "Directory cannot be read",
    "workspace.usable": "Usable",
    "workspace.emptyFolder": "Empty folder (categories will be initialized on open)",
    "workspace.forbiddenRuntime": "Cannot use app runtime / Desktop state folder as a content workspace",
    "workspace.openFileFail": "Cannot open file: {{error}}",

    "ingest.fileNotFound": "File does not exist",
    "ingest.overLimit": "Over conversion limit {{limit}}MB (original will be imported)",
    "ingest.createFail": "Could not create import task",

    "ai.cancelled": "User cancelled.",
    "ai.timeout": "Timeout (4 minutes).",
    "ai.stalled": "Stalled (120s no data, possibly tool chain too long).",
    "ai.steer": "[User steering · comply immediately, may abort remaining planned steps]\n{{body}}",
    "ai.stepLimit": "[System] Steps nearing limit: prioritize current goal and give path receipt; do not open unrelated broad searches.",
    "ai.noProvider": "No AI provider configured",
    "ai.noSelection": "Please select or provide text first",
    "ai.textTooLong": "Text too long (limit ~32k chars), please shorten and retry",
    "ai.polish": "Polish: smoother, more professional; keep meaning and density; output only the replacement for the selection/target span; match the whole document’s voice and Markdown structure (heading levels, list markers, spacing) — do not restate unselected text, invent a conflicting style, or add preamble/footer.",
    "ai.shorter": "More concise: trim redundancy, keep key info; keep list/heading style consistent with the full document.",
    "ai.expand": "Expand: elaborate and connect without fabricating facts; match whole-document tone and structure.",
    "ai.bullets": "Convert to clear Markdown bullet list (if already a list, organize hierarchy); use the same list markers as the document.",
    "ai.formal": "More formal, written tone; still match whole-document layout.",
    "ai.casual": "More casual, relaxed tone; still match whole-document layout.",
    "ai.fix": "Fix typos, punctuation and obvious grammar, minimal wording changes; preserve whole-document Markdown structure.",
    "ai.format": "Format: align Markdown with the whole document’s existing layout — heading levels, list markers, paragraph gaps and blank-line habits; do not invent a conflicting heading scheme; keep meaning and facts; no preamble or footer.",
    "ai.continue": "Continue: write 1-3 paragraphs naturally from context, no repetition.",
    "ai.summarize": "Summarize: extract key points, may use bullet list, keep key facts.",
    "ai.generate": "Generate: create new content from instruction and context, matching whole-document voice and Markdown structure; output only the replacement for the selection/target span.",
    "ai.translate": "Translate: auto-detect Chinese/English and translate to the other; preserve Markdown structure, heading levels and formatting; output only the replacement for the selection/target span.",
    "ai.enhanceNoContent": "Almost no content after enhanced render; paste manually or check for login wall.",
    "ai.enhanceFail": "Enhanced render failed ({{reason}}). Fell back to static fetch.{{warning}}",

    "utr.unavailable": "UTR unavailable (engine did not bundle utr or load failed). Daily editing/saving does not depend on UTR.",
    "utr.nativeHealth": "Desktop native health check complete (UTR not loaded).",
    "utr.noWorkspaceHealth": "No workspace open, native health check skipped.",

    "window.closeTitle": "Close Window",
    "window.closeMessage": "What to do when closing the window?",
    "window.hideMac": "Hide to Dock",
    "window.hideTray": "Minimize to tray",
    "window.hideOther": "Hide to tray/taskbar",
    "window.quit": "Quit topmind",
    "window.cancel": "Cancel",
    "window.hideMacHint": "App stays running after hiding; reopen from Dock or global ⌘⇧N.",
    "window.hideTrayHint": "topmind stays in the system tray after minimizing. Click the tray icon to reopen; right-click for capture/quit.",
    "window.hideOtherHint": "App stays running after hiding; reopen from tray icon or global shortcut.",
    "window.rememberChoice": "Remember my choice",
    "window.trayHiddenMac": "topmind minimized to tray. Click the tray icon to reopen.",
    "window.trayHiddenOther": "topmind minimized to tray. Click the tray icon to reopen.",

    "dialog.selectPluginFolder": "Select plugin folder (with topmind-plugin.json)",
    "dialog.selectPluginZip": "Select plugin zip",
    "dialog.selectWorkspace": "Select topmind workspace",
    "dialog.selectSkillsDir": "Select Skills directory (with SKILL.md or topmind-pack.json)",
    "dialog.publishedTweet": "Published tweet",

    "pathOps.frontmatterMdOnly": "Only .md files support frontmatter updates.",
    "pathOps.editMdOnly": "Only .md files can be edited.",
    "pathOps.newTextNotString": "newText must be a string.",
    "pathOps.newTextTooLong": "newText is too long.",
    "pathOps.sameTextNoWrite": "oldText and newText are identical, nothing written",
    "pathOps.fileNotExist": "File does not exist: {{path}}",
    "pathOps.oldTextNoMatch": "oldText not found (exact + newline/trailing-space normalize). Use nearby/context below, or read_file around=. Path: {{path}}",
    "pathOps.oldTextMultiMatch": "oldText matched {{count}} times; widen context for uniqueness or set replaceAll=true. Path: {{path}}",
    "pathOps.contentUnchanged": "Content unchanged",
    "pathOps.replacedCount": "Replaced {{count}} occurrence(s) (via Kernel write gate; no Archive snapshot)",
    "pathOps.saveMdOrHtml": "Only .md files can be edited (HTML export for delivery is allowed).",
    "pathOps.htmlOutputsOnly": "HTML export is only allowed in the Outputs directory.",
    "pathOps.offsetBeyondEnd": "offset {{start}} is beyond end of file ({{total}} lines total)",
    "pathOps.returnedLinesContinue": "Returned lines {{start}}–{{end}} / {{total}} total; use a larger offset to continue reading",
    "pathOps.returnedLines": "Returned lines {{start}}–{{end}} / {{total}} total",
    "pathOps.permanentlyDeleted": "Permanently deleted (irrecoverable)",
    "pathOps.deletedWithMedia": "Deleted ({{count}} associated media to trash; via Kernel write gate)",
    "pathOps.deleted": "Deleted (via Kernel write gate)",
    "pathOps.newNameNoSeparator": "New file name must not contain path separators.",
    "pathOps.targetExists": "Target already exists: {{path}}",
    "pathOps.renamedWithMedia": "Renamed; associated media folder → {{dir}}",
    "pathOps.publishMdOnly": "Only Markdown notes can be published.",
    "pathOps.publishedWithMedia": "Published delivery copy (with {{count}} media assets); original retained",
    "pathOps.published": "Published delivery copy; original retained",
    "pathOps.topicNameYearPrefix": "Topic name must start with YYYY- (e.g. 2026-example-research)",
    "pathOps.aboutToCreateTopic": "About to create topic: {{topicId}}",
    "pathOps.topicExists": "Topic already exists: {{topicId}}",
    "pathOps.topicTrashCopyFailed": "Trash copy verification failed; original topic kept: {{topicId}}",
    "pathOps.topicNameNoSeparator": "Topic name must not contain path separators.",
    "pathOps.invalidTopicId": "Invalid topicId: {{topicId}}",
    "pathOps.sameName": "New name is the same as the current one.",
    "pathOps.topicRenamed": "Topic renamed; {{count}} files' frontmatter updated",
    "pathOps.appendedToStream": "Appended to stream",
    "pathOps.appendContentEmpty": "Append content cannot be empty",
    "pathOps.appendNoChange": "Append did not change file content",
    "pathOps.coreMemoryUpdated": "Updated “My Profile” · {{section}}",
    "pathOps.coreMemoryPathFail": "Cannot resolve “My Profile” path: ensure a stream category exists or configure memory.dir",
    "pathOps.archiveCurrentOrFuture": "Cannot archive the current or future year",
    "pathOps.archiveYearNotFound": "Year directory does not exist",
    "pathOps.archiveNoPeriodFiles": "No period files in that year",
    "pathOps.archiveAlreadyArchived": "That year is already archived",
    "pathOps.archiveNoStreamCategory": "Stream category directory not found",
    "pathOps.archiveNoArchiveCategory": "Archive directory not found",
    "pathOps.archiveFailed": "Archive failed",
    "pathOps.archiveDone": "Archived {{year}} stream ({{count}} period notes) → {{path}}",
    "pathOps.reconcileAtomPacking": "Current packing is “one card per entry”; switch to weekly or specify a file path",
    "pathOps.reconcileNoPeriod": "Cannot find the current period note",
    "pathOps.reconcilePeriodMissing": "Period note does not exist: {{path}}",
    "pathOps.reconcileApplied": "This week's stream tidied up ({{count}} changes)",
    "pathOps.reconcilePreview": "Preview: {{count}} changes can be tidied",
    "pathOps.reconcileClean": "This week's stream is already tidy, no changes needed",

    "fetch.spaHint": "Very little content; the page may need JavaScript rendering. Try “Enhanced Render” or paste manually.",
    "fetch.truncated": "Content truncated (limit {{cap}} chars). Use “Full Fetch” to raise the limit, or split into multiple notes.",
    "fetch.noContent": "Could not extract valid content; please paste manually.",
    "fetch.urlScheme": "URL must start with http:// or https://.",
    "fetch.timeout": "Fetch timeout (20s): {{msg}}",
    "fetch.networkError": "Network error: {{msg}}",
    "fetch.unsupportedContentType": "Unsupported content type: {{ct}} (web/text only)",
    "fetch.tooLarge": "Page too large (>5MB), not fetched.",
    "fetch.renderTimeout": "Enhanced render timeout ({{sec}}s)",
    "fetch.renderFail": "Render load failed: {{desc}}",
    "fetch.renderNoHtml": "Enhanced render returned no valid HTML",
    "fetch.mdTruncated": "\n\n...(content truncated)",

    "inbox.fileReadFail": "Cannot read the dropped file.",
    "inbox.fileOverLimit": "File {{mb}}MB exceeds import limit {{max}}MB (use the “Knowledge Ingest” queue, or raise the limit in settings).",
    "inbox.moveToTopicMdOnly": "Only Markdown notes can be moved.",
    "inbox.moveToTopicFileNotExist": "File does not exist: {{path}}",
    "inbox.alreadyInTopic": "Already in target topic, not moved",
    "inbox.movedWithMedia": "Moved to topic (with {{count}} associated media assets)",
    "inbox.moved": "Moved to topic",
    "inbox.recordedTo": "Recorded to {{label}}",
    "inbox.streamTitleFallback": "Stream",

    "batch.multiFileWrite": "This batch wrote {{items}} items · {{paths}} targets · {{backups}} backups",
    "ingest.originalImported": "Original imported: `{{fn}}`",
    "ingest.convertFailed": "Conversion failed: {{error}}",
    "ingest.retryHint": "Install anydoc (recommended, no Python) or markitdown / pandoc and retry in “Knowledge Ingest”, or organize manually.",

    "weread.apiKeyMissing": "WeRead API Key not configured. Please set it in Settings.",
    "weread.invalidJson": "WeRead API returned invalid JSON response",
    "weread.upgradeNeeded": "WeRead Skill upgrade required: {{msg}}",
    "weread.keyInvalid": "(API Key invalid or expired, please re-obtain)",
    "weread.paramError": "(API parameter error)",
    "weread.errorWithCode": "WeRead: {{msg}}",
    "weread.fetchingBooks": "Fetching books with highlights/notes…",
    "weread.pagingNotebooks": "Paging notebooks… ({{page}})",
    "weread.fetchListFail": "Cannot fetch books with notes: {{msg}}",
    "weread.noExportableBooks": "Selected books have no exportable highlights/thoughts",
    "weread.noNoteBooks": "No books with highlights/thoughts (books without notes are skipped by default)",
    "weread.syncProgress": "{{count}} books with notes{{overview}} · → {{category}}/ · thoughts {{thoughts}}",
    "weread.batchProgress": "Processed {{processed}}/{{total}} books this round, {{remaining}} remaining for next round (unchanged books auto-skipped)",
    "weread.highlightsFile": "highlights.md",
    "weread.backupFile": "{{stamp}}__highlights.md",
    "weread.highlightsTitle": "{{title}} - highlights",
    "weread.sourceLine": "# {{title}}\n\n> Source: WeRead\n> Author: {{author}}\n> Synced: {{syncedAt}}\n",
    "weread.highlightsRel": "{{category}}/{{topic}}/highlights.md",

    "x.xurlMissing": "xurl is unavailable. Install: brew install --cask xdevplatform/tap/xurl or npm i -g @xdevplatform/xurl",
    "x.xurlReady": "xurl ready ({{cmd}}{{ver}})",
    "x.xurlNotFound": "xurl not found — posting unavailable. Install via installHints and run xurl auth oauth2.",
    "x.agentMcpHint": "Agent hosts bridge official MCP with xurl mcp; Desktop uses Bearer (read) + xurl (write)",
    "x.connected": "Connected{{api}}{{cli}}",
    "x.connectedApi": " · API read-only",
    "x.connectedCli": " · xurl ready (can post)",
    "x.notConnected": "No access layer. Configure a Bearer Token or install xurl.",
    "x.textRequired": "Tweet text required.",
    "x.overLimit": "Tweet exceeds the 280 character limit.",
    "x.noWriteChannel": "No posting channel (local xurl user OAuth required)",
    "x.cannotPostDraft": "Cannot post: App-only Bearer cannot write. Install and sign in to xurl (brew install --cask xdevplatform/tap/xurl && xurl auth oauth2). Draft saved: {{path}}",
    "x.replyNeedsRest": "Replies must use official REST: xurl -X POST /2/tweets",
    "x.queryRequired": "Search query required.",
    "x.notConfiguredRead": "X is not configured. Add a Bearer Token or install xurl.",
    "x.notConfigured": "X is not configured.",
    "x.usernameRequired": "Username required.",
    "x.userNotFound": "User @{{handle}} not found.",
    "x.tweetsRequired": "tweets array required.",

    "aiContext.topicCount": "{{count}} topics",
    "aiContext.truncated": "…(truncated)",

    "writeback.viewTarget": "View {{path}}",
    "writeback.restoreIfNeeded": "Restore from {{path}} if needed",
    "writeback.viewPreview": "View preview"
  },
};

const SUPPORTED = Object.keys(STRINGS);
let _locale = null;

/**
 * Match a BCP-47 tag against supported locales.
 */
function matchLocale(tag) {
  if (!tag) return "zh-CN";
  const lower = tag.toLowerCase();
  for (const loc of SUPPORTED) {
    if (lower === loc.toLowerCase()) return loc;
  }
  const lang = lower.split("-")[0];
  for (const loc of SUPPORTED) {
    if (loc.toLowerCase().startsWith(lang + "-")) return loc;
  }
  return "zh-CN";
}

/**
 * Resolve locale from env, Electron app, or default.
 */
function resolveLocale() {
  const env = typeof process !== "undefined" ? process.env?.topmind_LOCALE : null;
  if (env && SUPPORTED.includes(env)) return env;
  try {
    const { app } = require("electron");
    if (app?.getLocale) return matchLocale(app.getLocale());
  } catch {
    /* electron not available yet */
  }
  return "zh-CN";
}

/**
 * Set the active locale for subsequent t() calls.
 * Call this from main.mjs after settings load.
 * @param {string} locale — e.g. "zh-CN", "en-US", or "auto"
 */
export function setLocale(locale) {
  if (!locale || locale === "auto") {
    _locale = resolveLocale();
  } else {
    _locale = matchLocale(locale);
  }
}

/**
 * Get the current active locale.
 */
export function getLocale() {
  if (!_locale) _locale = resolveLocale();
  return _locale;
}

/**
 * Translate a key with optional interpolation.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const locale = getLocale();
  const table = STRINGS[locale] || STRINGS["en-US"];
  let s = table[key] || STRINGS["en-US"][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}
