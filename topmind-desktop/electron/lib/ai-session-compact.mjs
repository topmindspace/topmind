/**
 * Smart session compaction for AI model context.
 *
 * Goals:
 * - Keep recent dialogue intact (working memory)
 * - Compress older turns so long sessions stay within budget
 * - Preserve tool-turn gist and path receipts without full dumps
 * - Never invent user content
 *
 * Defaults are tuned for broad model compatibility (128K–1M token context windows).
 */

export const COMPACT_DEFAULT_MAX_MESSAGES = 60;
export const COMPACT_DEFAULT_KEEP_RECENT = 24;
/** Total content char budget (~80K tokens; leaves room for system + tools + response). */
export const COMPACT_DEFAULT_MAX_CHARS = 240_000;
export const COMPACT_DEFAULT_MAX_PER_MESSAGE = 16_000;

/**
 * Scale compaction budgets by the model's actual context window.
 * Large-window models keep more history; small windows compress earlier.
 * Overrides from settings still win when provided by the caller.
 *
 * @param {number} [contextWindow] model context window in tokens (0 / unknown → defaults)
 * @returns {{ maxMessages: number, keepRecent: number, maxChars: number, maxPerMessage: number, maxTokens: number }}
 */
export function resolveCompactBudget(contextWindow) {
  const cw = Number(contextWindow);
  const known = Number.isFinite(cw) && cw > 0;
  // Reserve ~40% of the window for system + tools + tools results + response.
  const usableTokens = known ? Math.floor(cw * 0.55) : Math.floor(COMPACT_DEFAULT_MAX_CHARS / 3);
  const maxChars = known
    ? Math.max(40_000, Math.min(1_200_000, Math.floor(usableTokens * 2.2)))
    : COMPACT_DEFAULT_MAX_CHARS;
  const maxMessages = known
    ? Math.max(24, Math.min(160, Math.round(usableTokens / 900)))
    : COMPACT_DEFAULT_MAX_MESSAGES;
  const keepRecent = known
    ? Math.max(8, Math.min(48, Math.round(maxMessages * 0.4)))
    : COMPACT_DEFAULT_KEEP_RECENT;
  const maxPerMessage = known
    ? Math.max(4_000, Math.min(64_000, Math.floor(maxChars / 12)))
    : COMPACT_DEFAULT_MAX_PER_MESSAGE;
  return {
    maxMessages,
    keepRecent,
    maxChars,
    maxPerMessage,
    maxTokens: usableTokens,
  };
}

/** @typedef {{
 *   role: string,
 *   content?: string,
 *   reasoning?: string,
 *   toolCalls?: Array<{ name?: string, summary?: string, status?: string }>
 * }} CompactMessage */

/** Rough token estimate: CJK denser than Latin (~1.5 chars/token vs ~4). */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * @param {CompactMessage[]} messages
 * @param {object} [opts]
 * @param {number} [opts.maxMessages] hard cap on turns sent to the model (default COMPACT_DEFAULT_MAX_MESSAGES)
 * @param {number} [opts.keepRecent] full-fidelity recent messages (default COMPACT_DEFAULT_KEEP_RECENT)
 * @param {number} [opts.maxChars] total content char budget (default COMPACT_DEFAULT_MAX_CHARS)
 * @param {number} [opts.maxTokens] optional token budget (default ~80k ≈ maxChars/3)
 * @param {number} [opts.maxPerMessage] truncate single message body (default COMPACT_DEFAULT_MAX_PER_MESSAGE)
 * @param {string} [opts.locale] "zh-CN" | "en-US" — language for injected compaction markers (default zh-CN)
 * @returns {{ messages: CompactMessage[], compacted: boolean, dropped: number, note: string|null, estimatedTokens: number }}
 */
const COMPACT_L10N = {
  "zh-CN": {
    goal: (line) => `[本会话初始目标] ${line}`,
    folded: (n) => `[会话压缩] 更早 ${n} 轮已折叠：`,
    ack: "已了解初始目标与历史摘要；以最近对话与工具结果为准继续。",
    truncated: (len) => `…(已截断，共 ${len} 字)`,
    toolsBlock: "[本轮工具]",
    user: "用户",
    assistant: "助手",
    paths: "涉及路径",
    toolsUsed: "曾用工具",
    moreFolded: "…另有较早轮次已折叠",
    noContent: "(无实质内容)",
  },
  "en-US": {
    goal: (line) => `[Session goal] ${line}`,
    folded: (n) => `[Session compacted] ${n} earlier turns folded:`,
    ack: "Acknowledged the initial goal and history summary; continuing from recent dialogue and tool results.",
    truncated: (len) => `…(truncated, ${len} chars total)`,
    toolsBlock: "[Tools this turn]",
    user: "User",
    assistant: "Assistant",
    paths: "Paths",
    toolsUsed: "Tools used",
    moreFolded: "…(earlier turns folded)",
    noContent: "(no substantive content)",
  },
};
function compactL10n(locale) {
  return COMPACT_L10N[locale] || COMPACT_L10N["zh-CN"];
}
export function compactMessagesForModel(messages, opts = {}) {
  const maxMessages = Math.max(6, Number(opts.maxMessages) || COMPACT_DEFAULT_MAX_MESSAGES);
  const keepRecent = Math.max(4, Number(opts.keepRecent) || COMPACT_DEFAULT_KEEP_RECENT);
  const maxChars = Math.max(8000, Number(opts.maxChars) || COMPACT_DEFAULT_MAX_CHARS);
  const maxTokens = Math.max(2000, Number(opts.maxTokens) || Math.floor(maxChars / 3));
  const maxPerMessage = Math.max(800, Number(opts.maxPerMessage) || COMPACT_DEFAULT_MAX_PER_MESSAGE);
  const L = compactL10n(opts.locale);

  const cleaned = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: flattenMessageContent(m, L),
    }))
    .filter((m) => m.content.trim().length > 0 || m.role === "user");

  if (cleaned.length === 0) {
    return {
      messages: [],
      compacted: false,
      dropped: 0,
      note: null,
      estimatedTokens: 0,
    };
  }

  let working = cleaned;
  let dropped = 0;
  let compacted = false;
  let note = null;

  // 1) Cap message count: keep head (first user = often the goal) + recent tail
  if (working.length > maxMessages) {
    const head = working.slice(0, 1);
    const firstMsg = head[0];
    const goalLine = firstMsg?.content?.replace(/\s+/gu, " ").trim().slice(0, 200) || "";
    const tail = working.slice(-keepRecent);
    const middle = working.slice(1, working.length - keepRecent);
    dropped = middle.length;
    const summary = summarizeMiddle(middle, L);

    const summaryBlock = [
      goalLine ? L.goal(goalLine) : null,
      L.folded(middle.length),
      summary,
    ].filter(Boolean).join("\n");

    // If head[0] is user, merge summaryBlock into it so we never emit two consecutive user messages
    if (firstMsg?.role === "user") {
      working = [
        {
          role: "user",
          content: [firstMsg.content, summaryBlock].filter(Boolean).join("\n\n---\n\n"),
        },
        {
          role: "assistant",
          content: L.ack,
        },
        ...tail,
      ];
    } else {
      working = [
        ...head,
        {
          role: "user",
          content: summaryBlock,
        },
        {
          role: "assistant",
          content: L.ack,
        },
        ...tail,
      ];
    }
    compacted = true;
    note = `compacted ${dropped} older turns`;
  }

  // 2) Per-message trim (prefer long assistant bodies)
  working = working.map((m, i) => {
    const isRecent = i >= working.length - keepRecent;
    const limit = isRecent ? maxPerMessage : Math.min(maxPerMessage, 2400);
    if (m.content.length <= limit) return m;
    compacted = true;
    return {
      ...m,
      content: `${m.content.slice(0, limit)}\n${L.truncated(m.content.length)}`,
    };
  });

  // 3) Char + token budget — drop from oldest after head until under budget
  let totalChars = working.reduce((n, m) => n + m.content.length, 0);
  let totalTokens = working.reduce((n, m) => n + estimateTokens(m.content), 0);
  if ((totalChars > maxChars || totalTokens > maxTokens) && working.length > 4) {
    const head = working[0];
    const rest = working.slice(1);
    while (rest.length > keepRecent && (totalChars > maxChars || totalTokens > maxTokens)) {
      const removed = rest.shift();
      totalChars -= removed?.content?.length || 0;
      totalTokens -= estimateTokens(removed?.content);
      dropped += 1;
      compacted = true;
    }
    working = [head, ...rest];
    note = note ? `${note}; budget trim` : "budget trim";
  }

  // Guarantee strict role alternation (required by Anthropic, OpenAI, etc.)
  working = ensureRoleAlternation(working);

  const estimatedTokens = working.reduce((n, m) => n + estimateTokens(m.content), 0);
  return { messages: working, compacted, dropped, note, estimatedTokens };
}

/**
 * Ensure strict role alternation (user <-> assistant) required by Anthropic, OpenAI, etc.
 * Consecutive messages of the same role are merged with a clean separator.
 * @param {CompactMessage[]} msgs
 * @returns {CompactMessage[]}
 */
export function ensureRoleAlternation(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return [];
  const result = [];
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const last = result[result.length - 1];
    if (last && last.role === m.role) {
      // Merge consecutive same-role messages
      last.content = [last.content, m.content].filter(Boolean).join("\n\n---\n\n");
    } else {
      result.push({ role: m.role, content: m.content || "" });
    }
  }
  return result;
}

/**
 * Flatten assistant content + tool timeline into one model-visible string.
 * @param {CompactMessage} m
 * @param {object} L - locale strings
 */
function flattenMessageContent(m, L) {
  const body = typeof m.content === "string" ? m.content : "";
  const tools = Array.isArray(m.toolCalls) ? m.toolCalls : [];
  if (tools.length === 0) return body;
  const lines = tools
    .map((t) => {
      const name = t?.name || "tool";
      const sum = t?.summary ? String(t.summary).slice(0, 160) : t?.status || "";
      return `- ${name}${sum ? `: ${sum}` : ""}`;
    })
    .slice(0, 16);
  const toolsLabel = L.toolsBlock || "[本轮工具]";
  const block = `${toolsLabel}\n${lines.join("\n")}`;
  if (!body.trim()) return block;
  if (body.includes(toolsLabel)) return body;
  return `${body}\n\n${block}`;
}

/**
 * @param {CompactMessage[]} middle
 * @param {object} L - locale strings
 */
function summarizeMiddle(middle, L) {
  const lines = [];
  const paths = new Set();
  const toolNames = new Set();

  for (const m of middle) {
    const role = m.role === "user" ? (L.user || "用户") : (L.assistant || "助手");
    const oneLine = m.content.replace(/\s+/gu, " ").trim().slice(0, 160);
    if (oneLine) lines.push(`- ${role}: ${oneLine}`);

    // Harvest paths / tool names from content for index
    for (const match of m.content.matchAll(
      /\b(?:\d{2}-[^/\s]+\/[^\s`]+\.md|\d{2}-[^/\s]+\/\d{4}-[^\s`/]+)/gu,
    )) {
      paths.add(match[0]);
    }
    for (const match of m.content.matchAll(
      /\b(list_\w+|load_\w+|save_\w+|edit_file|capture_to_inbox|move_to_topic|publish_to_outputs|read_file|search|fetch_url)\b/gu,
    )) {
      toolNames.add(match[1]);
    }
    if (lines.length >= 20) break;
  }

  if (paths.size > 0) {
    lines.push(`- ${L.paths || "涉及路径"}: ${[...paths].slice(0, 12).join(", ")}`);
  }
  if (toolNames.size > 0) {
    lines.push(`- ${L.toolsUsed || "曾用工具"}: ${[...toolNames].slice(0, 12).join(", ")}`);
  }
  if (middle.length > lines.length) {
    lines.push(`- ${L.moreFolded || "…另有较早轮次已折叠"}`);
  }
  return lines.length ? lines.join("\n") : "(无实质内容)";
}
