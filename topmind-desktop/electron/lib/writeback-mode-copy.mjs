/**
 * Single copy source for writeback (保存设置) semantics — graded confirm only.
 *
 * auto: write tools execute immediately (protection still applies)
 * confirm（删除/归档前问我）: content create/update/edit land immediately;
 *   only delete/archive return pending + full previewContent;
 *   Desktop stashes → AiPanel「待确认写入」accept/reject
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
 * confirm is **graded**: content edits land immediately; only delete/archive pending.
 * Honest about the delete path: delete is blocked with pending evidence (user
 * must confirm); archive/content pending can be stashed for accept/reject.
 * @param {string} [mode]
 * @param {string} [locale] — "zh"|"en"|"zh-CN"|"en-US" (default zh)
 * @returns {string}
 */
export function describeWritebackModeForPrompt(mode, locale) {
  const lang = resolveCopyLocale(locale);
  if (normalizeWritebackMode(mode) === "confirm") {
    if (lang === "en") {
      return (
        "Writeback: graded ask-before-save — content create/update/edit land immediately;" +
        " delete/archive enter pending confirmation and run only after the user accepts (delete has no auto-accept path);" +
        " locked notes are editable with a one-time task snapshot; permanent locked/core delete is user-only;" +
        " when files must change, you must call tools — never only rewrite verbally without tools."
      );
    }
    return (
      "写回: 分级「删除/归档前问我」— 内容新建/更新/编辑直接落盘；" +
      "删除/归档进入待确认，需用户接受后才执行（删除没有自动接受路径）；" +
      "锁定笔记可编辑（任务内首写快照一次）；永久删除 locked/core 仅用户；" +
      "需要改文件时必须调用工具，禁止只做口头改写而不走工具。"
    );
  }
  if (lang === "en") {
    return (
      "Writeback: auto-save — you may freely call write tools inside the workspace;" +
      " locked notes are editable (not forbidden): the first overwrite in this task takes a one-time snapshot + receipt; further edits in the same task update in place;" +
      " locked/core delete/archive is recoverable (trash/destination + receipt) and allowed in auto; irreversible permanent delete of locked/core is user-only;" +
      " open notes write immediately (path receipt only, no YAML backup);" +
      " archive moves content to the system archive dir as its new home (not a backup);" +
      " multi-file turns summarize path receipts."
    );
  }
  return (
    "写回: 自动保存 — 工作区内可自由调用 write 工具；" +
    "锁定笔记可编辑（不是禁区）：本任务对该文件的首次覆盖会做一次快照+回执，同任务后续编辑原地更新；" +
    "锁定/核心笔记的删除与归档在 auto 下允许，走可恢复 trash/归档目的地+回执；永久删除仅用户；" +
    "开放笔记直接写入（仅路径回执，无 YAML 备份）；" +
    "归档是迁入系统归档目录的新家（不是备份）；多文件轮次汇总路径回执。"
  );
}

/**
 * Short English/internal comment for batch collector docs.
 * @param {string} [mode]
 */
export function describeWritebackModeBrief(mode) {
  if (normalizeWritebackMode(mode) === "confirm") {
    return "confirm (graded): content edits land immediately; delete/archive pending until user accept/reject";
  }
  return "auto: write tools execute immediately; locked = one snapshot per task; multi-path turns get batch path receipts";
}

/** Forbidden Model-A phrases (for tests / docs:guard). Works for both locales. */
export const MODEL_A_FORBIDDEN_RE =
  /只读\s*[—\-–].*只分析|可粘贴草稿|no write tools|不注册写工具/iu;
