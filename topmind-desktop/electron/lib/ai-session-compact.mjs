/**
 * Smart session compaction for AI model context.
 *
 * Goals:
 * - Keep recent dialogue intact (working memory)
 * - Compress older turns so long sessions stay within budget
 * - Preserve tool-turn gist and path receipts without full dumps
 * - Never invent user content
 *
 * Defaults are tuned for modern models (128K+ token context windows):
 * - maxMessages: 40 (up from 28 — more turns before compaction)
 * - keepRecent: 16 (up from 12 — deeper working memory)
 * - maxChars: 80_000 (up from 56K — ~20K tokens, leaves ample room for system prompt + tools)
 */

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
 * @param {number} [opts.maxMessages] hard cap on turns sent to the model (default 40)
 * @param {number} [opts.keepRecent] full-fidelity recent messages (default 16)
 * @param {number} [opts.maxChars] total content char budget (default 80000)
 * @param {number} [opts.maxTokens] optional token budget (default ~22k ≈ maxChars/3.5)
 * @param {number} [opts.maxPerMessage] truncate single message body (default 8000)
 * @returns {{ messages: CompactMessage[], compacted: boolean, dropped: number, note: string|null, estimatedTokens: number }}
 */
export function compactMessagesForModel(messages, opts = {}) {
  const maxMessages = Math.max(6, Number(opts.maxMessages) || 40);
  const keepRecent = Math.max(4, Number(opts.keepRecent) || 16);
  const maxChars = Math.max(8000, Number(opts.maxChars) || 80_000);
  const maxTokens = Math.max(2000, Number(opts.maxTokens) || Math.floor(maxChars / 3.5));
  const maxPerMessage = Math.max(800, Number(opts.maxPerMessage) || 8000);

  const cleaned = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role,
      content: flattenMessageContent(m),
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
    // Preserve a short "goal" line from first user message for orientation
    const goalLine = head[0]?.content?.replace(/\s+/gu, " ").trim().slice(0, 200) || "";
    const tail = working.slice(-keepRecent);
    const middle = working.slice(1, working.length - keepRecent);
    dropped = middle.length;
    const summary = summarizeMiddle(middle);
    working = [
      ...head,
      {
        role: "user",
        content: [
          goalLine ? `[本会话初始目标] ${goalLine}` : null,
          `[会话压缩] 更早 ${middle.length} 轮已折叠：`,
          summary,
        ].filter(Boolean).join("\n"),
      },
      {
        role: "assistant",
        content: "已了解初始目标与摘要；以最近对话与工具结果为准继续。",
      },
      ...tail,
    ];
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
      content: `${m.content.slice(0, limit)}\n…(已截断，共 ${m.content.length} 字)`,
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

  const estimatedTokens = working.reduce((n, m) => n + estimateTokens(m.content), 0);
  return { messages: working, compacted, dropped, note, estimatedTokens };
}

/**
 * Flatten assistant content + tool timeline into one model-visible string.
 * @param {CompactMessage} m
 */
function flattenMessageContent(m) {
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
  const block = `[本轮工具]\n${lines.join("\n")}`;
  if (!body.trim()) return block;
  // Avoid duplicating if body already embeds tool dump
  if (body.includes("[本轮工具]")) return body;
  return `${body}\n\n${block}`;
}

/**
 * @param {CompactMessage[]} middle
 */
function summarizeMiddle(middle) {
  const lines = [];
  const paths = new Set();
  const toolNames = new Set();

  for (const m of middle) {
    const role = m.role === "user" ? "用户" : "助手";
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
    lines.push(`- 涉及路径: ${[...paths].slice(0, 12).join(", ")}`);
  }
  if (toolNames.size > 0) {
    lines.push(`- 曾用工具: ${[...toolNames].slice(0, 12).join(", ")}`);
  }
  if (middle.length > lines.length) {
    lines.push(`- …另有较早轮次已折叠`);
  }
  return lines.length ? lines.join("\n") : "(无实质内容)";
}
