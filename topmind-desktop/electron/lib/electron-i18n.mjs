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
    "tray.capture": "快速捕获…",
    "tray.ingest": "知识加工…",
    "tray.quitMac": "退出 topmind",
    "tray.quit": "退出",
    "tray.hiddenMessage": "topmind 仍在托盘运行。点击托盘图标可重新打开。",
    "capture.title": "topmind 捕获",
    "capture.loadFail": "捕获窗加载失败 ({{code}}): {{desc}}",
    "capture.errorTitle": "无法打开快速捕获",
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
    "dialog.publishedTweet": "已发布推文"
  },
  "en-US": {
    "menu.view": "View",
    "menu.window": "Window",
    "menu.develop": "Develop",
    "menu.openLogs": "Open Logs Folder",
    "tray.show": "Show topmind",
    "tray.capture": "Quick Capture…",
    "tray.ingest": "Knowledge Ingest…",
    "tray.quitMac": "Quit topmind",
    "tray.quit": "Quit",
    "tray.hiddenMessage": "topmind is still running in the tray. Click the tray icon to reopen.",
    "capture.title": "topmind Capture",
    "capture.loadFail": "Capture window load failed ({{code}}): {{desc}}",
    "capture.errorTitle": "Cannot open Quick Capture",
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
    "dialog.publishedTweet": "Published tweet"
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
