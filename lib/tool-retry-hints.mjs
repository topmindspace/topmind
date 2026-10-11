/**
 * Tool retry hints — adaptive, actionable recovery guidance.
 *
 * When a tool fails, the agent needs one precise next step, not a generic
 * "try again". This module maps error classes to concrete recovery calls
 * (same language as the Desktop/Obsidian tool surfaces) so the loop can
 * self-heal in one hop instead of thrashing.
 *
 * Pure strings — no I/O. Shared by Desktop `ai-tools.mjs` and Obsidian
 * `kernel-workspace-ops.ts`.
 */

/**
 * @param {string} toolName
 * @param {string} message - error message (lowercased inside)
 * @param {{ relativePath?: string, args?: Record<string, unknown>, locale?: string }} [opts]
 * @returns {string|undefined} hint for the model, or undefined when no special case
 */
export function buildRetryHint(toolName, message, opts = {}) {
  const msg = String(message || "");
  const low = msg.toLowerCase();
  const zh = !String(opts.locale || "").startsWith("en");
  const rel = String(opts.relativePath || opts.args?.relativePath || opts.args?.path || "");
  const relArg = rel ? `{ relativePath: "${rel}", ` : "{ ";
  const around = zh ? "关键词" : "keyword";

  // ── edit_file family ──────────────────────────────────────────────────
  if (toolName === "edit_file") {
    const isNoMatch = /未能找到|no-match|not found|no match/iu.test(msg);
    const isAmbiguous = /多处|ambiguous|multiple/iu.test(msg);
    const isHashStale = /expectedHash|hashMismatch|已被修改|hash-mismatch|stale/iu.test(msg);
    if (isHashStale) {
      return zh
        ? `编辑被拒绝：文件在你上次读取后已被修改。先调用 read_file(${relArg}around: "${around}", limit: 80 }) 刷新 contentHash 与 oldText，再用新的 contentHash 重试 edit_file。`
        : `Edit refused: file changed since your last read. Call read_file(${relArg}around: "${around}", limit: 80 }) to refresh contentHash and oldText, then retry edit_file with the new contentHash.`;
    }
    if (isNoMatch) {
      return zh
        ? `编辑失败：未匹配到 oldText。先调用 read_file(${relArg}around: "${around}", limit: 100 }) 取带行号的真实内容，复制精确 oldText（多带前后 1-2 行），或传 startLine/endLine 重试。`
        : `Edit failed: oldText was not found. Call read_file(${relArg}around: "${around}", limit: 100 }) and copy exact lines (1-2 extra context lines), then retry with startLine/endLine if needed.`;
    }
    if (isAmbiguous) {
      return zh
        ? "编辑失败：oldText 命中多处。给 oldText 加前后 1-2 行上下文保证唯一，或传 startLine/endLine / heading；确需全部替换可设 replaceAll: true。"
        : "Edit failed: oldText matched multiple times. Add 1-2 surrounding lines for uniqueness, or pass startLine/endLine / heading; set replaceAll: true if you mean every occurrence.";
    }
  }

  // ── save / capture writes ─────────────────────────────────────────────
  if (toolName === "save_file" || toolName === "save_note" || toolName === "capture_to_inbox" || toolName === "capture_url") {
    if (/outside|escapes|围栏|path-escapes/iu.test(msg)) {
      return zh
        ? "写入失败：路径在工作区围栏之外。改用工作区相对路径（如 20-专题/2026-主题/note.md）。"
        : "Write failed: path is outside the workspace fence. Use a workspace-relative path.";
    }
    if (/write-blocked|thinking|json dump|写入已拦截/iu.test(msg)) {
      return zh
        ? "写入被拦截：正文像思考过程/JSON dump。请只输出最终正文（Markdown），不要包含推理、工具调用痕迹或 ```json 块。"
        : "Write blocked: payload looked like thinking/JSON dump. Reply with the final Markdown body only — no reasoning, no tool traces, no ```json blocks.";
    }
    if (/empty|空/iu.test(msg) && toolName !== "edit_file") {
      return zh
        ? "写入失败：正文为空。请提供非空正文后再调用。"
        : "Write failed: empty content. Provide a non-empty body and retry.";
    }
    if (/atom-packing/iu.test(msg)) {
      return zh
        ? "周期本为 atom 模式，无法追加。改用 capture_url/forceAtom=true 或 target=inbox 单开文件。"
        : "Stream is atom-packed (no period append). Use forceAtom=true or target=inbox for a standalone file.";
    }
  }

  // ── capture_url / fetch ───────────────────────────────────────────────
  if (toolName === "capture_url" || toolName === "fetch_url") {
    if (/http-\d|status|timeout|fetch failed|network/iu.test(low)) {
      return zh
        ? "抓取失败（网络或 HTTP 错误）。稍后重试一次；仍失败则换来源或用 web_search 另找链接。"
        : "Fetch failed (network/HTTP). Retry once; if it still fails, switch sources or use web_search for another link.";
    }
    if (/empty|too short|过短/iu.test(msg)) {
      return zh
        ? "正文过短（可能是 SPA 空壳或反爬）。可先 fetch_url 并设 render:true 确认内容，或换来源。"
        : "Body empty/too short (SPA shell or anti-bot). Try fetch_url with render:true to confirm, or pick another source.";
    }
  }

  // ── search ────────────────────────────────────────────────────────────
  if (toolName === "search" || toolName === "glob_files" || toolName === "web_search") {
    if (/invalid|无效正则|regex/iu.test(low)) {
      return zh
        ? "查询/正则无效。简化关键词（去掉特殊符号）或设 regex=false 后重试。"
        : "Invalid query/regex. Simplify keywords (drop special chars) or set regex=false and retry.";
    }
    if (/HTTP \d|timeout|unavailable/iu.test(low) && toolName === "web_search") {
      return zh
        ? "搜索服务暂不可用。稍后重试；也可用 fetch_url 打开已知网址。"
        : "Search service unavailable. Retry later, or fetch a known URL directly.";
    }
  }

  // ── delete / move ─────────────────────────────────────────────────────
  if (toolName === "delete_path" || toolName === "rename_path" || toolName === "move_to_topic") {
    if (/locked|protected|核心|permission|仅用户/iu.test(msg)) {
      return zh
        ? "该路径受保护（locked/core），AI 不能执行此删除/移动。请说明原因让用户手动操作，或改目标为普通开放笔记。"
        : "Path is protected (locked/core). Explain to the user and ask them to act, or target an ordinary open note instead.";
    }
    if (/pending|待确认|confirm/iu.test(low)) {
      return zh
        ? "删除/归档已进入待确认。告知用户在建议面板接受，不要重复调用同一删除。"
        : "Delete/archive is pending confirmation. Tell the user to accept it in the Suggest pane — do not repeat the same delete.";
    }
  }

  // ── generic ───────────────────────────────────────────────────────────
  if (/not found|不存在|missing/iu.test(low) && rel) {
    return zh
      ? `路径不存在或已被移动：${rel}。先用 list_files / glob_files / stat_path 确认真实路径，再重试。`
      : `Path missing: ${rel}. Use list_files / glob_files / stat_path to confirm the real path, then retry.`;
  }
  return undefined;
}
