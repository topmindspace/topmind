/**
 * Sanitize one-shot inline AI completion text before preview / apply.
 *
 * Models (especially reasoners) often leak chain-of-thought tags, fence wrappers,
 * or meta preambles into `text`. Inline edit must replace the document with the
 * *result only* — never thinking traces or instructional wrappers.
 */

const THINK_BLOCK_TAGS = [
  "think",
  "thinking",
  "reasoning",
  "reflection",
  "thought",
  "scratchpad",
  "analysis",
];

/**
 * Remove paired XML-like thinking blocks (case-insensitive, multiline).
 * @param {string} text
 */
function stripThinkTagBlocks(text) {
  let out = String(text || "");
  for (const tag of THINK_BLOCK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu");
    out = out.replace(re, "");
    // Unclosed open tag → drop from open tag to end (or to a clear result marker)
    const openRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "iu");
    out = out.replace(openRe, "");
  }
  // Orphan close tags
  out = out.replace(/<\/(?:think|thinking|reasoning|reflection|thought|scratchpad|analysis)\s*>/giu, "");
  return out;
}

/**
 * Strip fenced "thinking" / "reasoning" code blocks.
 * @param {string} text
 */
function stripThinkFences(text) {
  return String(text || "").replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad)\s*\n[\s\S]*?```/giu,
    "",
  );
}

/**
 * Strip a single outer markdown fence (```lang … ```) if the whole payload is one.
 * @param {string} text
 */
function stripOuterFence(text) {
  const t = String(text || "").trim();
  const m = t.match(/^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/u);
  return m ? m[1].trim() : t;
}

/**
 * Drop common meta preambles / postambles that models add despite system prompt.
 * @param {string} text
 */
function stripMetaWrappers(text) {
  let out = String(text || "").trim();

  // Leading labels (EN + ZH) — multiline-safe first line only
  const leadRes = [
    /^(?:here(?:'s| is) (?:the |my )?(?:rewritten|revised|polished|improved|final|edited|updated|generated|summarized|summary|result|output|answer)(?: version| text| content)?)\s*[:：]\s*/iu,
    /^(?:以下是|如下是)?(?:改写结果|润色结果|扩写结果|总结结果|生成结果|输出结果|最终结果|结果如下|修改后的(?:文本|内容|版本)?|改写后的(?:文本|内容)?)\s*[:：]\s*/u,
    /^(?:思考过程|推理过程|分析过程)\s*[:：][\s\S]*?(?:\n{2,}|(?=^#{1,6}\s)|(?=^[-*•]))/mu,
  ];
  for (const re of leadRes) {
    out = out.replace(re, "").trim();
  }

  // Trailing "希望对你有帮助" style footers (last 1–2 lines only)
  out = out.replace(
    /\n+(?:希望(?:对你)?有帮助[！!。.]?|Hope this helps[!.,]?)+\s*$/iu,
    "",
  );

  // Separator then explanation dump after the result
  out = out.replace(/\n---+\n[\s\S]*?(?:解释|说明|改动|变更说明|Why I|I (?:changed|rewrote)|Note:)/iu, "");

  // Ensure blank line between different list types (bullet → ordered or vice-versa)
  // so the markdown parser creates separate list nodes instead of merging.
  out = out.replace(/(^|\n)([-*+]\s.*)\n(\d+\.\s)/gmu, "$1$2\n\n$3");
  out = out.replace(/(^|\n)(\d+\.\s.*)\n([-*+]\s)/gmu, "$1$2\n\n$3");
  // Drop extra blank paragraphs between same-type list items (repeat: non-overlap).
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/(^|\n)([-*+]\s.*)\n\n+([ \t]*[-*+]\s)/gmu, "$1$2\n$3");
    out = out.replace(/(^|\n)(\d+\.\s.*)\n\n+([ \t]*\d+\.\s)/gmu, "$1$2\n$3");
  }

  return out.trim();
}

/**
 * Collapse excess blank lines and trim.
 * @param {string} text
 */
function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r\n/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Full sanitize pipeline for inline complete results.
 * Pure — no I/O. Safe to call on already-clean text (idempotent for normal prose).
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeInlineAiResult(raw) {
  let out = String(raw ?? "");
  if (!out.trim()) return "";

  out = stripThinkTagBlocks(out);
  out = stripThinkFences(out);
  out = stripOuterFence(out);
  // Second pass: models sometimes nest fence after think tags
  out = stripOuterFence(out);
  out = stripMetaWrappers(out);
  out = normalizeWhitespace(out);
  return out;
}
