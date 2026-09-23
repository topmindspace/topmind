/**
 * Split assistant stream/chat text into visible body vs folded reasoning.
 *
 * Algorithm is locked to Kernel `lib/ai-content-sanitize.mjs` (`splitAssistantVisible`)
 * by `tests/stream-ai-cross-surface.test.mjs` + Desktop ingest tests.
 * Renderer ingest uses this module so CoT in text-delta never becomes the bubble body.
 */

const THINK_BLOCK_TAGS = [
  "think",
  "thinking",
  "reasoning",
  "reflection",
  "thought",
  "scratchpad",
  "analysis",
  "redacted_reasoning",
] as const;

const THINK_LEAD_RE =
  /^(?:思考过程|推理过程|分析过程|思维链|(?:Reasoning|Thinking|Analysis)\s*[:：]|(?:Chain of [Tt]hought|Let me (?:think|analyze)|I'll (?:think|analyze|reason))\b)/iu;

function hasMarkdownResultStructure(text: string): boolean {
  return /(?:^|\n)#{1,6}\s+\S/u.test(text) || /(?:^|\n)[-*•]\s+\S/u.test(text) || /(?:^|\n)\d+\.\s+\S/u.test(text);
}

function tidyChatBody(text: string): string {
  return String(text || "")
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export type AssistantVisible = {
  body: string;
  reasoning: string;
};

export function splitAssistantVisible(raw: unknown): AssistantVisible {
  let text = String(raw ?? "");
  if (!text) return { body: "", reasoning: "" };
  const reasoningParts: string[] = [];

  for (const tag of THINK_BLOCK_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "giu");
    text = text.replace(paired, (_m, inner: string) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "\n";
    });
    const open = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)$`, "iu");
    text = text.replace(open, (_m, inner: string) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "";
    });
  }
  text = text.replace(
    /<\/(?:think|thinking|reasoning|reflection|thought|scratchpad|analysis|redacted_reasoning)\s*>/giu,
    "",
  );

  text = text.replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad|redacted_reasoning)[^\n]*\n([\s\S]*?)```/giu,
    (_m, inner: string) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "\n";
    },
  );
  text = text.replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad|redacted_reasoning)[^\n]*\n?([\s\S]*)$/iu,
    (_m, inner: string) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "";
    },
  );

  let body = text;
  const trimmed = body.trim();
  if (THINK_LEAD_RE.test(trimmed)) {
    if (!hasMarkdownResultStructure(trimmed)) {
      reasoningParts.push(trimmed);
      body = "";
    } else {
      const lead = trimmed.match(
        /^(?:思考过程|推理过程|分析过程|思维链|Reasoning|Thinking|Analysis|Chain of [Tt]hought|Let me (?:think|analyze)|I'll (?:think|analyze|reason))[\s\S]*?(?=\n#{1,6}\s|\n[-*•]\s|\n\d+\.\s|\n\n#{1,6}|\n\n[-*•])/iu,
      );
      if (lead && lead[0].trim()) {
        reasoningParts.push(lead[0].trim());
        body = trimmed.slice(lead[0].length);
      } else {
        const cut = trimmed.search(/(?:^|\n)(?:#{1,6}\s|[-*•]\s|\d+\.\s)/u);
        if (cut > 0) {
          reasoningParts.push(trimmed.slice(0, cut).trim());
          body = trimmed.slice(cut);
        }
      }
    }
  }

  return {
    body: tidyChatBody(body),
    reasoning: reasoningParts.filter(Boolean).join("\n\n"),
  };
}

export function ingestAssistantTextDelta(
  acc: { raw?: string; body?: string; reasoning?: string } | null | undefined,
  delta: string,
): {
  raw: string;
  body: string;
  reasoning: string;
  bodyDelta: string;
  reasoningDelta: string;
  resetBody: boolean;
  resetReasoning: boolean;
} {
  const prev = acc && typeof acc === "object" ? acc : {};
  const raw = String(prev.raw || "") + String(delta ?? "");
  const { body, reasoning } = splitAssistantVisible(raw);
  const prevBody = String(prev.body || "");
  const prevReasoning = String(prev.reasoning || "");
  const resetBody = Boolean(prevBody) && !body.startsWith(prevBody);
  const resetReasoning = Boolean(prevReasoning) && !reasoning.startsWith(prevReasoning);
  return {
    raw,
    body,
    reasoning,
    bodyDelta: resetBody ? "" : body.slice(prevBody.length),
    reasoningDelta: resetReasoning ? reasoning : reasoning.slice(prevReasoning.length),
    resetBody,
    resetReasoning,
  };
}

/** Display parts for ChatMessage / store — never fall back to a thinking-only raw payload. */
export function visibleAssistantMessage(
  raw: unknown,
  extraReasoning?: string,
): AssistantVisible {
  const split = splitAssistantVisible(raw);
  return {
    body: split.body,
    reasoning: mergeReasoning(extraReasoning, split.reasoning),
  };
}

export function mergeReasoning(provider: string | undefined, extracted: string | undefined): string {
  const a = String(provider || "").trim();
  const b = String(extracted || "").trim();
  if (a && b) {
    if (a.includes(b)) return a;
    if (b.includes(a)) return b;
    return `${a}\n\n${b}`;
  }
  return a || b;
}
