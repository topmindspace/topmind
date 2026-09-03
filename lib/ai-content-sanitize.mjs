// ── topmind AI content sanitize (Kernel pure policy) ───────────────────────
// Shared by suggest apply, memory_organize materialization, todo maintain parse,
// and derived-builder. Strips model thinking/meta and rejects placeholder pollution
// so durable memory paths never receive "待 AI 生成" / CoT dumps / raw JSON noise.

const THINK_BLOCK_TAGS = [
  "think",
  "thinking",
  "reasoning",
  "reflection",
  "thought",
  "scratchpad",
  "analysis",
  "redacted_reasoning",
];

/** Placeholder / pollution patterns that must never be written as durable body. */
const PLACEHOLDER_RES = [
  /待\s*AI\s*生成/u,
  /待摘要/u,
  /待填写/u,
  /此处(?:填写|补充|添加)/u,
  /配置\s*AI\s*provider/u,
  /配置\s*AI\s*后自动填充/u,
  /\(待\s*AI/u,
  /（待\s*AI/u,
  /TODO:\s*generate/iu,
  /placeholder/iu,
  /lorem\s+ipsum/iu,
];

/** Leading untagged chain-of-thought / reasoning labels (ZH + EN).
 *  Bare "Analysis/Reasoning/Thinking …" as the start of a real sentence is NOT a lead —
 *  require a label colon (Thinking:) or an explicit process/Let-me phrase. */
const THINK_LEAD_RE =
  /^(?:思考过程|推理过程|分析过程|思维链|(?:Reasoning|Thinking|Analysis)\s*[:：]|(?:Chain of [Tt]hought|Let me (?:think|analyze)|I'll (?:think|analyze|reason))\b)/iu;

/**
 * Remove paired XML-like thinking blocks (case-insensitive, multiline).
 * @param {string} text
 */
function stripThinkTagBlocks(text) {
  let out = String(text || "");
  for (const tag of THINK_BLOCK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "giu");
    out = out.replace(re, "");
    const openRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, "iu");
    out = out.replace(openRe, "");
  }
  out = out.replace(
    /<\/(?:think|thinking|reasoning|reflection|thought|scratchpad|analysis|redacted_reasoning)\s*>/giu,
    "",
  );
  return out;
}

/**
 * Strip fenced thinking / reasoning code blocks.
 * @param {string} text
 */
function stripThinkFences(text) {
  let out = String(text || "").replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad|redacted_reasoning)[^\n]*\n[\s\S]*?```/giu,
    "",
  );
  // Unclosed thinking fence → drop from the opener to EOS (same as unclosed <think>).
  out = out.replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad|redacted_reasoning)[^\n]*\n?[\s\S]*$/iu,
    "",
  );
  return out;
}

/**
 * Strip a single outer markdown fence if the whole payload is one.
 * @param {string} text
 */
function stripOuterFence(text) {
  const t = String(text || "").trim();
  const m = t.match(/^```(?:[\w+-]+)?\s*\n?([\s\S]*?)\n?```$/u);
  return m ? m[1].trim() : t;
}

/**
 * Whether text has a clear markdown "result" structure (heading / list).
 * @param {string} text
 */
function hasMarkdownResultStructure(text) {
  return /(?:^|\n)#{1,6}\s+\S/u.test(text) || /(?:^|\n)[-*•]\s+\S/u.test(text) || /(?:^|\n)\d+\.\s+\S/u.test(text);
}

/**
 * Drop common meta preambles / postambles and untagged thinking dumps.
 * If the body is *only* thinking (no result structure), returns empty string.
 * @param {string} text
 */
function stripMetaWrappers(text) {
  let out = String(text || "").trim();

  const leadRes = [
    /^(?:here(?:'s| is) (?:the |my )?(?:rewritten|revised|polished|improved|final|edited|updated|generated|summarized|summary|result|output|answer|digest)(?: version| text| content)?)\s*[:：]\s*/iu,
    /^(?:以下是|如下是)?(?:改写结果|润色结果|扩写结果|总结结果|生成结果|输出结果|最终结果|结果如下|周期摘要如下|周期反思如下|修改后的(?:文本|内容|版本)?|改写后的(?:文本|内容)?)\s*[:：]\s*/u,
  ];
  for (const re of leadRes) {
    out = out.replace(re, "").trim();
  }

  // Untagged thinking: strip lead block up to first real MD structure;
  // if no structure exists, drop entire dump.
  if (THINK_LEAD_RE.test(out)) {
    if (!hasMarkdownResultStructure(out)) {
      return "";
    }
    // Cut from thinking label through the character before first heading/list
    out = out
      .replace(
        /^(?:思考过程|推理过程|分析过程|思维链|Reasoning|Thinking|Analysis|Chain of [Tt]hought|Let me (?:think|analyze)|I'll (?:think|analyze|reason))[^\n]*(?:\n(?!#{1,6}\s|[-*•]\s|\d+\.\s)[^\n]*)*/iu,
        "",
      )
      .trim();
    // Fallback: if still starts with think label, drop all before first MD marker
    if (THINK_LEAD_RE.test(out)) {
      const cut = out.search(/(?:^|\n)(?:#{1,6}\s|[-*•]\s|\d+\.\s)/u);
      out = cut >= 0 ? out.slice(cut).replace(/^\n+/, "").trim() : "";
    }
  }

  // Inline "思考过程：…\n\n## real" form (structure after blank lines)
  out = out
    .replace(
      /^(?:思考过程|推理过程|分析过程|思维链)\s*[:：][\s\S]*?(?=\n#{1,6}\s|\n[-*•]\s|\n\d+\.\s|\n\n#{1,6}|\n\n[-*•])/mu,
      "",
    )
    .trim();
  out = out
    .replace(
      /^(?:Reasoning|Thinking|Analysis)\s*[:：][\s\S]*?(?=\n#{1,6}\s|\n[-*•]\s|\n\d+\.\s|\n\n#{1,6}|\n\n[-*•])/imu,
      "",
    )
    .trim();

  out = out.replace(
    /\n+(?:希望(?:对你)?有帮助[！!。.]?|Hope this helps[!.,]?)+\s*$/iu,
    "",
  );

  out = out.replace(
    /\n---+\n[\s\S]*?(?:解释|说明|改动|变更说明|Why I|I (?:changed|rewrote)|Note:)/iu,
    "",
  );

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

export {
  resolveOutputLanguage,
  resolveAiLocale,
  detectSourceScript,
  extractExplicitLanguageRequest,
  resolveWorkspaceOutputLocale,
  pickDocumentSourceForOutputLanguage,
  resolveAgentOutputLanguage,
  resolveProductAiLanguage,
  normalizeSurfaceUiLocale,
} from "./ai-output-locale.mjs";

/**
 * True when body is (or is primarily) an unparsed JSON tool/schema dump.
 * Any size — Criterion 1 rejects raw JSON as durable memory body.
 * @param {string} text
 */
export function looksLikeJsonDump(text) {
  const s = String(text || "").trim();
  if (!s) return false;

  // Whole payload parses as JSON object/array
  if (/^[\[{]/.test(s) && /[\]}]$/.test(s)) {
    try {
      const parsed = JSON.parse(s);
      if (parsed !== null && typeof parsed === "object") return true;
    } catch {
      /* fall through structural heuristics */
    }
  }

  // Truncated / pretty-printed tool payloads with known keys
  if (
    /^\s*[{\[]/u.test(s) &&
    /"(?:profile|periodic|add|complete|update|topics?|suggestions?|analysis|period)"\s*:/u.test(s)
  ) {
    return true;
  }

  // High structural density of JSON tokens (pretty-printed objects)
  if (/^\s*\{/u.test(s)) {
    const keys = (s.match(/"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/gu) || []).length;
    const braces = (s.match(/[{}\[\]]/gu) || []).length;
    if (keys >= 2 && braces >= 4) return true;
    // Single-key object still a dump if it is the whole body
    if (keys >= 1 && braces >= 2 && s.length < 2000 && !hasMarkdownResultStructure(s)) {
      return true;
    }
  }

  return false;
}

/**
 * True when body is untagged chain-of-thought / reasoning meta (not a digest).
 * @param {string} text
 */
export function looksLikeThinkingDump(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  if (THINK_LEAD_RE.test(s) && !hasMarkdownResultStructure(s)) return true;
  // Residual labels mid-body with no usable MD
  if (
    /(?:^|\n)(?:思考过程|推理过程|分析过程|思维链|Reasoning|Thinking)\s*[:：]/u.test(s) &&
    !hasMarkdownResultStructure(s)
  ) {
    return true;
  }
  return false;
}

/**
 * Full sanitize pipeline for model text destined for durable writes or apply.
 * Pure — no I/O. Safe on already-clean text.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeAiContent(raw) {
  let out = String(raw ?? "");
  if (!out.trim()) return "";

  // Reject whole JSON dumps early (do not "clean" into partial garbage)
  if (looksLikeJsonDump(out)) return "";

  out = stripThinkTagBlocks(out);
  out = stripThinkFences(out);
  out = stripOuterFence(out);
  out = stripOuterFence(out);
  out = stripMetaWrappers(out);
  out = normalizeWhitespace(out);

  // Second pass: strip left empty thinking-only residue
  if (looksLikeJsonDump(out) || looksLikeThinkingDump(out)) return "";

  return out;
}

/**
 * True when a single line is a placeholder / meta-only line.
 * @param {string} line
 */
function isPlaceholderLine(line) {
  const s = String(line || "").trim().replace(/^[-*+]\s+/u, "");
  if (!s) return true;
  for (const re of PLACEHOLDER_RES) {
    if (re.test(s)) return true;
  }
  if (/<\/?(?:think|thinking|reasoning|redacted_reasoning)\b/iu.test(s)) return true;
  if (THINK_LEAD_RE.test(s)) return true;
  if (/^[{}\[\],]+$/u.test(s)) return true;
  if (/^"[a-zA-Z_]+"\s*:/u.test(s)) return true;
  return false;
}

/**
 * True when text is empty, primarily placeholder, or still looks like model meta/pollution.
 * Multi-line bodies that mix real content with one bad bullet are NOT wholly rejected —
 * callers should filter lines via extractCleanLines / strip per-line.
 * @param {unknown} text
 * @returns {boolean}
 */
export function isPlaceholderOrPolluted(text) {
  const s = String(text ?? "").trim();
  if (!s) return true;

  // Unstripped think tags remaining after sanitize → polluted
  if (/<\/?(?:think|thinking|reasoning|redacted_reasoning)\b/iu.test(s)) return true;

  // Unparsed JSON dumps (any size) — never durable memory body
  if (looksLikeJsonDump(s)) return true;

  // Untagged thinking / CoT dumps
  if (looksLikeThinkingDump(s)) return true;

  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;

  // Single-line / short: full placeholder match
  if (lines.length === 1 || s.length < 80) {
    for (const re of PLACEHOLDER_RES) {
      if (re.test(s)) return true;
    }
  }

  // Multi-line: polluted only if *all* substantive lines are placeholders
  // (ignore pure headings / blockquote chrome)
  const substantive = lines.filter((l) => {
    if (/^#{1,6}\s+/u.test(l)) return false;
    if (/^>\s*/u.test(l)) return false;
    if (/^[-*+]\s*$/u.test(l)) return false;
    return true;
  });
  if (substantive.length === 0) return true;
  const bad = substantive.filter((l) => isPlaceholderLine(l));
  if (bad.length === substantive.length) return true;

  // Only heading + empty scaffold
  const bodyOnly = s
    .replace(/^#+\s+.*$/gmu, "")
    .replace(/^>\s*.*$/gmu, "")
    .replace(/^[-*]\s*$/gmu, "")
    .trim();
  if (!bodyOnly || bodyOnly.length < 3) return true;

  return false;
}

/**
 * Whether sanitized AI body is usable for a durable write.
 * @param {unknown} raw
 * @param {{ minLength?: number }} [opts]
 * @returns {{ ok: boolean, text: string, reason?: string }}
 */
export function usableAiBody(raw, opts = {}) {
  const minLength = opts.minLength ?? 10;
  // Pre-check raw JSON before sanitize (sanitize returns "" for dumps)
  if (looksLikeJsonDump(raw)) {
    return { ok: false, text: "", reason: "json-dump" };
  }
  if (looksLikeThinkingDump(String(raw ?? ""))) {
    // May still salvage if sanitize can cut to MD structure
    const salvaged = sanitizeAiContent(raw);
    if (!salvaged || salvaged.length < minLength || isPlaceholderOrPolluted(salvaged)) {
      return { ok: false, text: "", reason: "thinking-dump" };
    }
    return { ok: true, text: salvaged };
  }

  const text = sanitizeAiContent(raw);
  if (!text || text.length < minLength) {
    return { ok: false, text: "", reason: "empty-or-short" };
  }
  if (isPlaceholderOrPolluted(text)) {
    return { ok: false, text: "", reason: "placeholder-or-polluted" };
  }
  if (looksLikeJsonDump(text) || looksLikeThinkingDump(text)) {
    return { ok: false, text: "", reason: "meta-pollution" };
  }
  return { ok: true, text };
}

/**
 * Normalize a profile bullet line for dedupe comparison.
 * Strips date prefixes like `- （2026-08-03）` and list markers.
 * @param {string} line
 * @returns {string}
 */
export function normalizeProfileFactKey(line) {
  return String(line || "")
    .replace(/^[-*+]\s+/u, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}\s*归档\]\s*/u, "")
    .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/u, "")
    .replace(/^（\d{4}-\d{2}-\d{2}\s*归档）\s*/u, "")
    .replace(/^（\d{4}-\d{2}-\d{2}）\s*/u, "")
    .replace(/^\(\d{4}-\d{2}-\d{2}\)\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * True if `entry` is already present (or near-duplicate) in section body text.
 * @param {string} sectionBody
 * @param {string} entryContent
 * @returns {boolean}
 */
export function profileSectionHasFact(sectionBody, entryContent) {
  const key = normalizeProfileFactKey(entryContent);
  if (!key || key.length < 2) return true;
  const lines = String(sectionBody || "").split("\n");
  for (const line of lines) {
    const existing = normalizeProfileFactKey(line);
    if (!existing) continue;
    if (existing === key) return true;
    // Substring match for near-dupes (stable facts re-phrased slightly)
    if (existing.length >= 6 && key.length >= 6) {
      if (existing.includes(key) || key.includes(existing)) return true;
    }
  }
  return false;
}

/**
 * Filter AI-extracted bullet/lines for profile or todo candidates.
 * @param {string} raw
 * @param {{ max?: number, maxLen?: number, minLen?: number }} [opts]
 * @returns {string[]}
 */
export function extractCleanLines(raw, opts = {}) {
  const max = opts.max ?? 8;
  const maxLen = opts.maxLen ?? 200;
  const minLen = opts.minLen ?? 3;
  // Whole JSON dumps → no profile lines
  if (looksLikeJsonDump(raw)) return [];
  const cleaned = sanitizeAiContent(raw);
  if (!cleaned) return [];

  return cleaned
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/u, "").replace(/^\d+[.)]\s*/u, "").trim())
    .filter((l) => {
      if (l.length < minLen || l.length > maxLen) return false;
      if (isPlaceholderLine(l) || isPlaceholderOrPolluted(l)) return false;
      // Skip pure JSON/meta
      if (/^[{}\[\],]+$/u.test(l)) return false;
      if (/^(?:profile|periodic|add|complete|update)\s*[:：]/iu.test(l)) return false;
      if (/^"[a-zA-Z_]+"\s*:/u.test(l)) return false;
      return true;
    })
    .slice(0, max);
}

// ── Layer-aware AI content policy (single entry point) ─────────────────────

/**
 * Per-layer validation presets. One policy table instead of each call site
 * hand-picking usableAiBody / extractCleanLines / isPlaceholderOrPolluted.
 */
const LAYER_POLICIES = Object.freeze({
  /** .derived/ summaries & digests — rebuildable body text */
  derived: { mode: "body", minLength: 8 },
  /** memory/ profile & periodic — durable semantic body */
  memory: { mode: "body", minLength: 4 },
  /** suggest cards — short summaries shown for confirmation */
  suggest: { mode: "body", minLength: 4 },
  /** profile fact bullets — line-extracted candidates */
  "profile-lines": { mode: "lines", max: 8 },
  /** todo extraction — line-extracted candidates */
  "todo-lines": { mode: "lines", max: 12 },
});

/**
 * Validate + clean AI output for a durable target layer.
 * Single policy gate for suggest / memory / derived / ai-op call sites.
 *
 * - body layers → `{ ok, text, reason? }` (same shape as usableAiBody)
 * - line layers → `{ ok, lines }` (ok=false when nothing usable)
 *
 * @param {unknown} raw - model output
 * @param {keyof typeof LAYER_POLICIES | string} targetLayer
 * @param {{ minLength?: number, max?: number, minLen?: number, maxLen?: number }} [overrides]
 */
export function validateAiOutput(raw, targetLayer = "derived", overrides = {}) {
  const policy = LAYER_POLICIES[targetLayer] || LAYER_POLICIES.derived;
  if (policy.mode === "lines") {
    const lines = extractCleanLines(raw, {
      max: overrides.max ?? policy.max,
      minLen: overrides.minLen,
      maxLen: overrides.maxLen,
    });
    return { ok: lines.length > 0, lines };
  }
  return usableAiBody(raw, { minLength: overrides.minLength ?? policy.minLength });
}

// ── Chat ingest: fold thinking out of the user-visible body ────────────────

function tidyChatBody(text) {
  return String(text || "")
    .replace(/\r\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Split provider/chat text into visible answer vs folded reasoning.
 * Extracts tagged think blocks, fenced thinking, and untagged CoT prefixes.
 * Does not drop the real answer. Safe on already-clean text.
 *
 * @param {unknown} raw
 * @returns {{ body: string, reasoning: string }}
 */
export function splitAssistantVisible(raw) {
  let text = String(raw ?? "");
  if (!text) return { body: "", reasoning: "" };
  const reasoningParts = [];

  for (const tag of THINK_BLOCK_TAGS) {
    const paired = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "giu");
    text = text.replace(paired, (_, inner) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "\n";
    });
    const open = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)$`, "iu");
    text = text.replace(open, (_, inner) => {
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
    (_, inner) => {
      const bit = String(inner || "").trim();
      if (bit) reasoningParts.push(bit);
      return "\n";
    },
  );
  // Unclosed thinking fence → remainder is reasoning, not the visible body.
  text = text.replace(
    /```(?:thinking|reasoning|thought|analysis|scratchpad|redacted_reasoning)[^\n]*\n?([\s\S]*)$/iu,
    (_, inner) => {
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

/**
 * Incremental ingest helper for stream text-deltas.
 * @param {{ raw?: string, body?: string, reasoning?: string } | null | undefined} acc
 * @param {string} delta
 */
export function ingestAssistantTextDelta(acc, delta) {
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

/**
 * Scan text for balanced JSON bracket pairs ({...} or [...]), properly
 * ignoring brackets inside string literals and escaped quotes.
 *
 * @param {string} text
 * @param {"any"|"object"|"array"} type
 * @returns {string[]}
 */
function scanBalancedBrackets(text, type = "any") {
  const results = [];
  const wantObject = type === "any" || type === "object";
  const wantArray = type === "any" || type === "array";

  let inString = false;
  let escaped = false;
  let depth = 0;
  let startIdx = -1;
  let targetOpen = "";
  let targetClose = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (depth === 0) {
      if ((wantObject && ch === "{") || (wantArray && ch === "[")) {
        targetOpen = ch;
        targetClose = ch === "{" ? "}" : "]";
        startIdx = i;
        depth = 1;
      }
    } else {
      if (ch === targetOpen) {
        depth++;
      } else if (ch === targetClose) {
        depth--;
        if (depth === 0 && startIdx !== -1) {
          results.push(text.slice(startIdx, i + 1));
          startIdx = -1;
        }
      }
    }
  }

  return results;
}

/**
 * Attempt to parse a string as JSON, with resilient auto-repairs for common LLM quirks.
 *
 * @param {string} raw
 * @param {"any"|"object"|"array"} expectedType
 * @returns {any|undefined}
 */
function tryParseJson(raw, expectedType = "any") {
  if (!raw || typeof raw !== "string") return undefined;
  let s = raw.trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(s);
    if (validateParsedType(parsed, expectedType)) return parsed;
  } catch {
    /* proceed to repairs */
  }

  // Repair 1: Remove trailing commas before } or ]
  let repaired = s.replace(/,\s*([\]}])/gu, "$1");

  // Repair 2: Remove single-line comments // ...
  repaired = repaired.replace(/(^|[^:])\/\/[^\n]*/gu, "$1");

  try {
    const parsed = JSON.parse(repaired);
    if (validateParsedType(parsed, expectedType)) return parsed;
  } catch {
    /* try further repair */
  }

  // Repair 3: If wrapped in stray backticks or quotes, trim them
  if ((repaired.startsWith("`") && repaired.endsWith("`")) ||
      (repaired.startsWith("'") && repaired.endsWith("'"))) {
    repaired = repaired.slice(1, -1).trim();
    try {
      const parsed = JSON.parse(repaired);
      if (validateParsedType(parsed, expectedType)) return parsed;
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

/**
 * Validate that parsed JSON matches the requested root type.
 * @param {any} val
 * @param {"any"|"object"|"array"} expectedType
 * @returns {boolean}
 */
function validateParsedType(val, expectedType) {
  if (val === undefined) return false;
  if (expectedType === "any") return true;
  if (expectedType === "object") {
    return typeof val === "object" && val !== null && !Array.isArray(val);
  }
  if (expectedType === "array") {
    return Array.isArray(val);
  }
  return true;
}

/**
 * Robustly extract and parse JSON payload from raw LLM output.
 * Handles:
 * - Leading/trailing markdown or conversational text
 * - <think> ... </think> or unclosed thinking blocks
 * - ```json ... ``` code fences (including unclosed fences)
 * - Trailing commas in objects/arrays (common LLM flaw)
 * - Balanced bracket scanning to prevent greedy cross-match of multiple blocks
 *
 * @template T
 * @param {string} text - Raw LLM output
 * @param {object} [options]
 * @param {"any"|"object"|"array"} [options.type="any"] - Expected JSON root type
 * @param {T} [options.fallback=null] - Fallback value if parsing fails
 * @returns {T|any} Parsed JSON or fallback
 */
export function extractJsonPayload(text, { type = "any", fallback = null } = {}) {
  if (typeof text !== "string" || !text.trim()) return fallback;

  // 1. First priority: check for explicit ```json ... ``` blocks directly from raw text
  // This ensures unclosed <think> or preambles don't swallow explicit code blocks.
  const jsonCodeBlockRegex = /```json\s*\n?([\s\S]*?)(?:```|$)/giu;
  let blockMatch;
  while ((blockMatch = jsonCodeBlockRegex.exec(text)) !== null) {
    const candidate = blockMatch[1]?.trim();
    if (candidate) {
      const parsed = tryParseJson(candidate, type);
      if (parsed !== undefined) return parsed;
    }
  }

  // 2. Secondary cleanup: strip think blocks and thinking fences
  let cleaned = stripThinkTagBlocks(text);
  cleaned = stripThinkFences(cleaned).trim();

  // If stripping empty due to unclosed think tag, fall back to extracting after the think tag
  if (!cleaned) {
    const thinkTagClose = text.search(/<\/(?:think|thinking|reasoning|reflection|thought|scratchpad|analysis|redacted_reasoning)>/iu);
    if (thinkTagClose >= 0) {
      cleaned = text.slice(thinkTagClose).replace(/^<[^>]+>/u, "").trim();
    } else {
      // Unclosed think opener: try to find first json bracket after the opener
      const firstBracket = text.search(/[{\[]/u);
      if (firstBracket >= 0) {
        cleaned = text.slice(firstBracket).trim();
      }
    }
  }
  if (!cleaned) return fallback;

  // 3. Candidate strings to try parsing
  const candidates = [];

  // 3a. Generic ``` ... ``` blocks
  const genericFenceRegex = /```\w*\s*\n?([\s\S]*?)(?:```|$)/giu;
  let genericMatch;
  while ((genericMatch = genericFenceRegex.exec(cleaned)) !== null) {
    const candidate = genericMatch[1]?.trim();
    if (candidate) candidates.push(candidate);
  }

  // 3b. Balanced bracket extraction from the whole text
  const bracketCandidates = scanBalancedBrackets(cleaned, type);
  // Reverse order: models usually output explanations first, then final JSON near the bottom
  candidates.push(...bracketCandidates.reverse());

  // 3c. Fallback candidate: cleaned string itself
  candidates.push(cleaned);

  // 4. Try parsing candidates in order
  for (const rawCandidate of candidates) {
    const parsed = tryParseJson(rawCandidate, type);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return fallback;
}

