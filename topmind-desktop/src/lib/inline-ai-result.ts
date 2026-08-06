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
      /\n+(?:希望(?:对你)?有帮助[！!。.]?|Hope this helps[!.,]?)+\s*$/iu,
      "",
    );

  return out
    .replace(/\r\n/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
