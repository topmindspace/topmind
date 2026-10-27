/** Portable context accounting. Host snapshots, never model prose, own budgets. */
export function estimateTokens(text) {
  let tokens = 0;
  for (const char of String(text || '')) tokens += /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char) ? 2 / 3 : 1 / 4;
  return Math.ceil(tokens);
}

export function needsActiveDocument(text) {
  return /这(?:篇|段|份|个)|当前|这儿|这里|笔记|稿件|文档|\b(?:this|current|the article|the note|the draft)\b/iu.test(String(text || ''));
}

/** A user ceiling can reduce a known model window, never enlarge it. */
export function resolveContextWindow(modelWindow, ceiling) {
  const known = Number(modelWindow) > 0 ? Number(modelWindow) : 32768;
  const limit = Number(ceiling);
  return Math.floor(Number.isFinite(limit) && limit >= 4096 ? Math.min(known, limit) : known);
}

export function resolveContextBudget(contextWindow, { fixedTokens = 0, responseTokens } = {}) {
  const window = resolveContextWindow(contextWindow);
  const response = Math.min(Math.max(256, Number(responseTokens) || 8192), Math.floor(window * 0.2));
  const reserve = Math.max(256, Math.floor(window * 0.08));
  const available = Math.max(0, window - fixedTokens - response - reserve);
  const maxTokens = Math.max(0, Math.min(Math.floor(window * 0.55), available));
  const maxChars = Math.max(256, Math.min(1200000, Math.floor(maxTokens * 1.5)));
  const maxMessages = Math.max(6, Math.min(160, Math.round(maxTokens / 900)));
  return { window, responseTokens: response, maxTokens, maxChars, maxMessages,
    keepRecent: Math.max(2, Math.min(48, Math.round(maxMessages * 0.4))),
    maxPerMessage: Math.max(256, Math.min(64000, Math.floor(maxChars / 6))) };
}

export function clipContext(text, maxTokens) {
  const input = String(text || '');
  if (estimateTokens(input) <= maxTokens) return input;
  let tokens = 0, result = '';
  for (const char of input) {
    tokens += /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char) ? 2 / 3 : 1 / 4;
    if (tokens > Math.max(0, maxTokens - 40)) break;
    result += char;
  }
  return `${result}\n[Context window truncated; use a targeted read for missing content.]`;
}

/** Preserve the request, recent evidence and explicit omission markers every step. */
export function compactPromptBlocks(blocks, maxTokens) {
  const list = blocks.map(String);
  if (!list.length) return { blocks: [], compacted: false, overflow: false };
  if (estimateTokens(list[0]) + 96 > maxTokens) return { blocks: list, compacted: false, overflow: true };
  if (estimateTokens(list.join('\n\n')) <= maxTokens) return { blocks: list, compacted: false, overflow: false };
  const marker = '[Earlier conversation/tool bodies folded. The host task, completed writes and execution budget remain unchanged. Read exact missing source windows before edits.]';
  let remaining = maxTokens - estimateTokens(list[0]) - estimateTokens(marker) - 24;
  const tail = [];
  for (let i = list.length - 1; i > 0 && remaining > 64; i--) {
    const part = clipContext(list[i], remaining);
    tail.unshift(part); remaining -= estimateTokens(part) + 8;
    if (part !== list[i]) break;
  }
  return { blocks: [list[0], marker, ...tail], compacted: true, overflow: false };
}

/** Only recent exchanges explicitly bound to this article belong in its history. */
export function articleHistory(messages, targetPath) {
  const result = [];
  let bound = false;
  for (const message of messages || []) {
    if (message.role === 'user') bound = (message.focusPath || message.focus?.path) === targetPath;
    if (bound && ['user', 'assistant'].includes(message.role)) result.push({ role: message.role, content: clipContext(message.content, 600) });
  }
  return result.slice(-4);
}

/** Keep host receipts intact; only the model-facing copy is shortened. */
export function boundToolResult(result, maxTokens) {
  if (estimateTokens(JSON.stringify(result)) <= maxTokens) return result;
  const summary = {};
  for (const key of ['ok', 'error', 'pending', 'needsConfirm', 'relativePath', 'targetPath', 'path', 'contentHash', 'wroteFiles', 'affectedFiles']) {
    if (result?.[key] !== undefined) summary[key] = result[key];
  }
  return { ...summary, content: clipContext(result?.content || result?.text || JSON.stringify(result), Math.max(128, maxTokens - 128)), truncated: true,
    hint: 'Request a smaller source window or narrower query. This is not the complete source; do not infer omitted text.' };
}

/** Fold only complete old SDK tool cycles. Keep user requests and the newest cycle. */
export function fitSdkContext(messages, maxTokens) {
  const next = [...messages];
  let folded = false;
  const size = () => estimateTokens(JSON.stringify(next));
  const hasCalls = m => m?.role === 'assistant' && Array.isArray(m.content) && m.content.some(p => p.type === 'tool-call');
  while (size() > maxTokens) {
    const cycles = next.map((m, i) => hasCalls(m) ? i : -1).filter(i => i >= 0);
    if (cycles.length < 2) break;
    const start = cycles[0];
    let end = start + 1;
    while (next[end]?.role === 'tool') end++;
    if (end === start + 1) break;
    next.splice(start, end - start);
    folded = true;
  }
  if (folded) {
    const first = next.findIndex(m => m.role === 'user' && typeof m.content === 'string');
    if (first >= 0) next[first] = { ...next[first], content: next[first].content + '\n[Older completed tool cycles folded. Host write receipts and task budget remain authoritative. Do not repeat completed writes.]' };
  }
  return { messages: next, compacted: folded, overflow: size() > maxTokens };
}
