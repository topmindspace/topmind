/** The same semantic-memory fence is applied by every host before a generic tool writes. */
import path from 'node:path';
import { buildAgentToolCatalog } from './agent-tool-catalog.mjs';
import { resolveMemoryDir } from './memory-engine.mjs';
import { resolveWorkspacePath } from './model-core.mjs';
export const MEMORY_WRITE_TOOLS = new Set(['append_core_memory','update_core_memory','retire_core_memory','restore_core_memory','compact_core_memory_history','append_topic_memory','add_todo','toggle_todo','update_todo','set_todo_due','delete_todo','propose_memory_change']);
export const MEMORY_PATH_KEYS = ['relativePath','destRelativePath','inboxRelativePath','newPath','targetTopicId','category','topicId'];
export function isFencedMemoryPath(value, options = {}) {
  if (!value) return false;
  let relative = path.posix.normalize(String(value).replace(/\\/gu,'/')).toLowerCase();
  let prefix = 'memory';
  if (options.workspaceRoot) {
    relative = resolveWorkspacePath(options.workspaceRoot, String(value), { allowRoot: true }).relativePath.toLowerCase();
    prefix = resolveWorkspacePath(options.workspaceRoot, resolveMemoryDir(options.workspaceRoot), { allowRoot: true }).relativePath.toLowerCase();
  }
  const inside = relative === prefix || relative.startsWith(`${prefix}/`) || /(^|\/)memory(\/|$)/u.test(relative);
  const ledger = relative === `${prefix}/ledgers` || relative.startsWith(`${prefix}/ledgers/`) || /(^|\/)memory\/ledgers(\/|$)/u.test(relative);
  return inside && !ledger;
}
const readTools = new Set(Object.entries(buildAgentToolCatalog()).filter(([, spec]) => spec.effect === 'read').map(([name]) => name));
export function memoryFence(toolName, args, options = {}) {
  if (readTools.has(toolName) || MEMORY_WRITE_TOOLS.has(toolName)) return null;
  let hit;
  try { hit = MEMORY_PATH_KEYS.some(key => isFencedMemoryPath(args?.[key], options)); }
  catch { return { ok:false, tool:toolName, operation:toolName, error:'path-outside-workspace' }; }
  if (!hit) return null;
  return { ok:false, tool:toolName, operation:toolName, error:'write-blocked:memory-plane', note: options.blocked || 'Use semantic memory tools or propose a reviewed memory change instead of generic file writes.' };
}
