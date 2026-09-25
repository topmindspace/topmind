/**
 * Memory-plane fence for generic AI file tools.
 *
 * Generic writes must not raw-rewrite memory/profile|periodic|topics|todo —
 * those go through the memory tools so fusion / dedupe / writeback gates run.
 * `memory/ledgers/` is a sanctioned generic-write plane (ledger notes).
 *
 * Every path-shaped arg must be checked: `copy_file` sends source AND dest,
 * and an `||` short-circuit on the first truthy path leaves the other open.
 */

export const MEMORY_WRITE_TOOLS = new Set([
  "append_core_memory", "update_core_memory", "retire_core_memory",
  "append_topic_memory", "add_todo", "toggle_todo",
]);

export const MEMORY_PATH_KEYS = ["relativePath", "destRelativePath", "inboxRelativePath"];

/** True when `p` is inside the fenced memory plane (ledgers/ is NOT fenced). */
export function isFencedMemoryPath(p) {
  const rel = String(p || "").replace(/\\/g, "/");
  if (!/(^|\/)memory\//u.test(rel)) return false;
  return !/(^|\/)memory\/ledgers(\/|$)/u.test(rel);
}

/**
 * @returns {null | {ok:false, tool:string, operation:string, error:string, note:string}}
 */
export function memoryFence(toolName, args, note) {
  if (MEMORY_WRITE_TOOLS.has(toolName)) return null;
  const hit = MEMORY_PATH_KEYS.some((k) => isFencedMemoryPath(args?.[k]));
  if (!hit) return null;
  return {
    ok: false,
    tool: toolName,
    operation: toolName,
    error: "write-blocked:memory-plane",
    note: note?.blocked ??
      "memory/ is gated (except memory/ledgers/). Use append_core_memory / update_core_memory / retire_core_memory / append_topic_memory / add_todo / toggle_todo instead of generic file writes.",
  };
}
