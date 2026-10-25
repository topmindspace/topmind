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

/** Advertised and callable subsets come from the canonical Kernel contract. */
export { filterAgentToolsForTurn as filterToolsForTurn } from "./ai-tool-names.mjs";

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

/** Prepare only the resources this turn can use; independent reads overlap. */
export async function prepareTurnResources({ userText, enableTools, loadFiles, buildTools, loadContext }) {
  const turnKind = resolveTurnKind(userText);
  const emptyContext = { overview: "", profile: "", topicContext: "" };
  if (turnKind === "light") return { turnKind, files: [], tools: null, context: emptyContext };
  const [files, tools, context] = await Promise.all([
    loadFiles(),
    enableTools ? buildTools() : null,
    enableTools ? loadContext() : emptyContext,
  ]);
  return { turnKind, files, tools, context };
}
