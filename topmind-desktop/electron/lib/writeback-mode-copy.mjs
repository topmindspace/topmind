/**
 * Single copy source for writeback (保存设置) semantics — Model B only.
 *
 * auto: write tools execute immediately (protection still applies)
 * confirm（保存前问我）: write tools STILL registered; Kernel returns pending +
 * full previewContent; Desktop stashes → AiPanel「待确认写入」accept/reject
 *
 * NEVER use Model A phrases: 只读 / 可粘贴草稿 / no write tools / 不注册写工具
 */

export const WRITEBACK_MODES = Object.freeze(["auto", "confirm"]);

/**
 * @param {string} [mode]
 * @returns {"auto"|"confirm"}
 */
export function normalizeWritebackMode(mode) {
  return mode === "confirm" ? "confirm" : "auto";
}

/**
 * Normalize locale to "zh" | "en" for prompt copy.
 * @param {string} [locale]
 * @returns {"zh"|"en"}
 */
function resolveCopyLocale(locale) {
  if (locale == null || locale === "") return "zh";
  return String(locale).startsWith("en") ? "en" : "zh";
}

/**
 * One-line policy for system prompt / agent instructions (bilingual).
 * @param {string} [mode]
 * @param {string} [locale] — "zh"|"en"|"zh-CN"|"en-US" (default zh)
 * @returns {string}
 */
export function describeWritebackModeForPrompt(mode, locale) {
  const lang = resolveCopyLocale(locale);
  if (normalizeWritebackMode(mode) === "confirm") {
    if (lang === "en") {
      return (
        "Writeback: ask before save — you may call write tools (save_file/edit_file, etc.);" +
        " tool results enter the pending-writes queue; the user accepts or rejects in the panel before disk write;" +
        " locked notes refuse unconfirmed AI overwrite (protection outranks writeback);" +
        " when files must change, you must call tools — never only rewrite verbally without tools."
      );
    }
    return (
      "写回: 保存前问我 — 可调用 write 工具（save_file/edit_file 等）；" +
      "工具结果会进入「待确认写入」队列，用户在面板中接受或拒绝后才落盘；" +
      "锁定笔记拒绝未确认的 AI 覆盖（保护级别优先于写回模式）；" +
      "需要改文件时必须调用工具，禁止只做口头改写而不走工具。"
    );
  }
  if (lang === "en") {
    return (
      "Writeback: auto-save — you may call write tools;" +
      " locked notes refuse unconfirmed AI overwrite (protection outranks writeback);" +
      " only high-impact writes get backup/receipt (locked overwrite; locked/core delete);" +
      " archive moves content to the system archive dir as its new home (not a backup);" +
      " multi-file turns summarize path receipts."
    );
  }
  return (
    "写回: 自动保存 — 可调用 write 工具；" +
    "锁定笔记拒绝未确认的 AI 覆盖（保护级别优先于写回模式）；" +
    "仅高影响写入备份/回执（锁定覆盖、锁定/核心删除）；归档是迁入系统归档目录的新家（不是备份）；多文件轮次汇总路径回执。"
  );
}

/**
 * Short English/internal comment for batch collector docs.
 * @param {string} [mode]
 */
export function describeWritebackModeBrief(mode) {
  if (normalizeWritebackMode(mode) === "confirm") {
    return "confirm: write tools registered; results pending until user accept/reject in 待确认写入";
  }
  return "auto: write tools execute immediately; multi-path turns get batch path receipts";
}

/** Forbidden Model-A phrases (for tests / docs:guard). Works for both locales. */
export const MODEL_A_FORBIDDEN_RE =
  /只读\s*[—\-–].*只分析|可粘贴草稿|no write tools|不注册写工具/iu;
