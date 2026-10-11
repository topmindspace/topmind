/**
 * Host-side query evidence injection.
 *
 * Problem: some models (and some turns) answer "what are my tasks / memories"
 * from training priors and never call tools — the reply is pure chat.
 *
 * Fix (industry "forced grounding"): when the turn matches a known workspace
 * lookup, the host executes the read tools itself and injects the results into
 * the system prompt BEFORE generation. The model is then instructed to answer
 * from this evidence, not from priors. Tool-calling remains available for
 * follow-ups; this path guarantees grounding for the canonical intents.
 *
 * Pure orchestration — no I/O policy, no writeback. Callers pass the built
 * tool set so this stays inside the same fence as the agent loop.
 */
import { matchQueryIntents, classifyTurn } from "./agent-goal-protocol.mjs";

/** Map tool name → human label for the injected block. */
const TOOL_LABELS = {
  list_recent_memories: { zh: "最近记忆（我的情况）", en: "Recent memories (my profile)" },
  list_recent_stream: { zh: "最近动态", en: "Recent stream" },
  list_todos: { zh: "待办清单", en: "Todos" },
  list_inbox: { zh: "Inbox", en: "Inbox" },
  list_outputs: { zh: "交付物", en: "Outputs" },
};

/**
 * Execute a registered AI tool by name and stringify its result.
 * @param {Record<string, { execute?: Function }>} tools
 * @param {string} name
 * @param {object} [args]
 * @returns {Promise<string>}
 */
async function runTool(tools, name, args = {}) {
  const t = tools?.[name];
  if (!t || typeof t.execute !== "function") return "";
  try {
    const raw = await t.execute(args, { abortSignal: undefined });
    if (raw == null) return "";
    if (typeof raw === "string") return raw;
    return JSON.stringify(raw, null, 0);
  } catch (err) {
    return JSON.stringify({ ok: false, error: err?.message || String(err) });
  }
}

/**
 * Trim a tool payload so a giant listing cannot blow the prompt.
 * @param {string} s
 * @param {number} max
 */
function clamp(s, max) {
  const t = String(s || "");
  return t.length <= max ? t : `${t.slice(0, max)}…(truncated)`;
}

/**
 * Build the evidence block to prepend into the system prompt.
 * Returns null when the turn is not a workspace lookup or tools are absent.
 *
 * @param {{
 *   userText: string,
 *   tools: Record<string, { execute?: Function }> | null,
 *   locale?: string,
 *   maxCharsPerTool?: number,
 * }} p
 * @returns {Promise<string|null>}
 */
export async function buildQueryEvidence(p) {
  const userText = String(p?.userText || "").trim();
  const tools = p?.tools;
  if (!userText || !tools) return null;

  const kind = classifyTurn(userText);
  // Light turns never get evidence (a greeting needs none).
  if (kind === "light") return null;

  const hit = matchQueryIntents(userText);
  // Only known lookup intents — free-form task text stays the agent's job.
  if (!hit || !Array.isArray(hit.tools) || hit.tools.length === 0) return null;

  const zh = !String(p?.locale || "").startsWith("en");
  const maxChars = Math.max(400, Math.min(Number(p?.maxCharsPerTool) || 3500, 8000));
  /** @type {string[]} */
  const parts = [];
  for (const name of hit.tools) {
    const payload = await runTool(tools, name, {});
    if (!payload) continue;
    const label = TOOL_LABELS[name] || { zh: name, en: name };
    parts.push(`### ${zh ? label.zh : label.en} (\`${name}\`)\n${clamp(payload, maxChars)}`);
  }
  if (parts.length === 0) return null;

  const head = zh
    ? [
        "## 本轮工作区查询证据（系统已调用工具，必须优先引用）",
        "下方是工具真实返回。回答用户的任务/记忆/动态类问题时**只能**基于这些数据；",
        "禁止用训练知识编造个人任务、记忆或待办。若数据为空，如实说「目前没有」。",
        "",
      ]
    : [
        "## Workspace query evidence (host-fetched — cite this first)",
        "The data below is real tool output. Answer task/memory/stream questions **only** from it.",
        "Never invent personal todos or memories from training priors. If empty, say there are none.",
        "",
      ];
  return [...head, ...parts].join("\n");
}

/**
 * Convenience: decide whether this turn is a lookup the host should ground.
 * @param {string} userText
 */
export function wantsQueryEvidence(userText) {
  if (classifyTurn(userText) === "light") return false;
  return Boolean(matchQueryIntents(userText));
}
