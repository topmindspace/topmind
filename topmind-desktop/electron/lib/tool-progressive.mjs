/**
 * Progressive / on-demand tool exposure.
 *
 * Industry practice (Claude Code, Cursor, Assistants v2): never dump the full
 * tool catalog into every turn. A greeting does not need 47 schemas; a
 * workspace lookup needs read tools; a write task needs the full set.
 *
 * Benefits:
 * - smaller system prompt → better instruction-following (esp. mid-size models)
 * - fewer phantom tool calls (model cannot reach a destructive tool from a query)
 * - faster first token on light turns
 *
 * The builder still registers everything — we filter the *advertised + callable*
 * set per turn. Follow-up turns in the same agent loop re-resolve from the
 * running goal kind so a query that grows into a write still gets write tools.
 */
import { classifyTurn } from "./agent-goal-protocol.mjs";
import { AI_TOOL_NAMES_READ, AI_TOOL_NAMES_WRITE } from "./ai-tool-names.mjs";

/** Always available (routing / meta), even on light turns. */
const ALWAYS = new Set(["list_skills", "load_skill"]);

/** Read-side discovery tools useful for query turns. */
const QUERY_READ = new Set([
  "workspace_overview",
  "list_categories",
  "list_topics",
  "list_topic_files",
  "get_topic",
  "read_file",
  "search",
  "list_inbox",
  "list_outputs",
  "list_todos",
  "list_recent_memories",
  "list_recent_stream",
  "list_files",
  "glob_files",
  "stat_path",
  "web_search",
  "fetch_url",
  "workspace_health",
  "list_pending_writes",
  "load_skill_resource",
]);

/**
 * Filter a tool map down to the surface appropriate for this turn kind.
 * @param {Record<string, unknown>} tools
 * @param {"light"|"query"|"task"} kind
 * @returns {Record<string, unknown>}
 */
export function filterToolsForTurn(tools, kind) {
  if (!tools || typeof tools !== "object") return {};
  if (kind === "task") return { ...tools };
  /** @type {Record<string, unknown>} */
  const out = {};
  if (kind === "light") {
    for (const [name, t] of Object.entries(tools)) {
      if (ALWAYS.has(name)) out[name] = t;
    }
    // Light turns still get zero domain tools — reply is conversational.
    return {};
  }
  // query: read tools only (no writes — prevents accidental mutation)
  for (const [name, t] of Object.entries(tools)) {
    if (ALWAYS.has(name) || QUERY_READ.has(name) || AI_TOOL_NAMES_READ.includes(name)) {
      out[name] = t;
    }
  }
  return out;
}

/**
 * Names advertised in the system prompt for this turn (drives the Tools
 * section filter and the inventory contract).
 * @param {"light"|"query"|"task"} kind
 * @returns {string[]}
 */
export function advertisedToolNames(kind) {
  if (kind === "light") return [];
  if (kind === "task") return [...AI_TOOL_NAMES_READ, ...AI_TOOL_NAMES_WRITE];
  return [...AI_TOOL_NAMES_READ];
}

/**
 * Resolve turn kind from the latest user text (falsy → task = full surface).
 * @param {string} userText
 * @returns {"light"|"query"|"task"}
 */
export function resolveTurnKind(userText) {
  return classifyTurn(userText || "");
}
