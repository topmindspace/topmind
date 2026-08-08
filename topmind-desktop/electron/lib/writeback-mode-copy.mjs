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
 * One-line policy for system prompt / agent instructions (Chinese, shipped to model).
 * @param {string} [mode]
 * @returns {string}
 */
export function describeWritebackModeForPrompt(mode) {
  if (normalizeWritebackMode(mode) === "confirm") {
    return (
      "写回: 保存前问我 — 可调用 write 工具（save_file/edit_file 等）；" +
      "工具结果会进入「待确认写入」队列，用户在面板中接受或拒绝后才落盘；" +
      "需要改文件时必须调用工具，禁止只做口头改写而不走工具。"
    );
  }
  return (
    "写回: 自动保存 — 可调用 write 工具；" +
    "仅高影响写入备份/回执（锁定文件覆盖、删除/归档）；多文件轮次汇总路径回执。"
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

/** Forbidden Model-A phrases (for tests / docs:guard). */
export const MODEL_A_FORBIDDEN_RE =
  /只读\s*[—\-–].*只分析|可粘贴草稿|no write tools|不注册写工具/iu;
