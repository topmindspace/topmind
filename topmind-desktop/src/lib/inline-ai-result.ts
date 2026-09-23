/**
 * Renderer mirror of electron/lib/inline-ai-result.mjs — keep patterns in sync.
 * Defense-in-depth: complete() already sanitizes on the main process.
 */

const THINK_TAGS = [
  "think",
  "thinking",
  "reasoning",
  "reflection",
  "thought",
  "scratchpad",
  "analysis",
] as const;

export function sanitizeInlineAiResult(raw: unknown): string {
  let out = String(raw ?? "");
  if (!out.trim()) return "";

  for (const tag of THINK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu");
    out = out.replace(re, "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "iu"), "");
  }
  out = out.replace(
    /<\/(?:think|thinking|reasoning|reflection|thought|scratchpad|analysis)\s*>/giu,
    "",
  );
  out = out.replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad)\s*\n[\s\S]*?```/giu,
    "",
  );

  const fence = out.trim().match(/^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/u);
  if (fence) out = fence[1];
  const fence2 = out.trim().match(/^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/u);
  if (fence2) out = fence2[1];

  out = out
    .replace(
      /^(?:here(?:'s| is) (?:the |my )?(?:rewritten|revised|polished|improved|final|edited|updated|generated|summarized|summary|result|output|answer)(?: version| text| content)?)\s*[:：]\s*/iu,
      "",
    )
    .replace(
      /^(?:以下是|如下是)?(?:改写结果|润色结果|扩写结果|总结结果|生成结果|输出结果|最终结果|结果如下|修改后的(?:文本|内容|版本)?|改写后的(?:文本|内容)?)\s*[:：]\s*/u,
      "",
    )
    .replace(
      /^(?:思考过程|推理过程|分析过程)\s*[:：][\s\S]*?(?:\n{2,}|(?=^#{1,6}\s)|(?=^[-*•]))/mu,
      "",
    )
    .replace(
      /\n+(?:希望(?:对你)?有帮助[！!。.]?|Hope this helps[!.,]?)+\s*$/iu,
      "",
    )
    .replace(/\n---+\n[\s\S]*?(?:解释|说明|改动|变更说明|Why I|I (?:changed|rewrote)|Note:)/iu, "");

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

  return out
    .replace(/\r\n/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Normalize whitespace for selection-drift compare (trailing spaces / extra blanks). */
export function normalizeInlineAiCompare(s: string): string {
  return String(s || "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** True when the live selection no longer matches the text captured at generate time. */
export function inlineAiSelectionDrifted(live: string, snap: string): boolean {
  return normalizeInlineAiCompare(live) !== normalizeInlineAiCompare(snap);
}
