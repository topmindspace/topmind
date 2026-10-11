/**
 * Pure prompt assembly for Desktop `ai.complete` (inline rewrite / polish / format).
 * Unit-testable without Electron, network, or generateText.
 *
 * Goal: selection rewrites match the **whole document's** structure and style
 * (headings, list markers, density, language) — not selection-only isolation.
 *
 * Locale-aware: pass `locale` ("zh"|"en" or "zh-CN"|"en-US"). Default zh.
 */

/**
 * @param {string} [locale]
 * @returns {"zh"|"en"}
 */
function resolveInlineLocale(locale) {
  if (locale == null || locale === "") return "zh";
  return String(locale).startsWith("en") ? "en" : "zh";
}

/**
 * System rules for one-shot complete calls (bilingual).
 * @param {string} [locale]
 * @returns {string}
 */
export function getInlineSystem(locale) {
  const lang = resolveInlineLocale(locale);
  if (lang === "en") {
    return `You are the topmind editor writing assistant (inline capability similar to Notion AI).
Rules:
- Output only the body text that can be written into the editor; do not output thinking, reasoning steps, analysis, or self-checks
- Do not use <think> / <thinking> / <reasoning> tags or \`\`\`thinking code fences
- Do not add prefixes like "Here is the result" / "Here is the rewritten version" or suffixes like "Hope this helps"
- Do not wrap the entire result in quotes; do not wrap the whole result in a markdown code fence (unless the user explicitly wants a code block)
- Output language: explicit user request this turn wins; else keep the source/document language; else the workspace locale. Do not follow the UI language.
- Preserve necessary Markdown structure (headings, lists, links, bold, etc.) when the context needs it
- Do not invent facts absent from the source; when continuing, connect naturally without unrelated settings
- For summaries, output concise bullets; for continuation, pick up from the break point
- **Whole-document format consistency (critical)**: when "full document / document context" is provided, the rewrite must match the whole document's style and layout — heading levels, list markers (- / * / 1.), task lists, paragraph density, blank-line habits, link/bold style, mixed CJK/Latin habits; do not invent a separate structure or tone from the selection alone. Output only the replacement for the selection — do not restate the full document.\n- **List format rules**: preserve the original document's list marker style (if it uses dash, keep dash; if asterisk, keep asterisk); maintain indentation for nested lists (2-space indent for children); separate different list types with a blank line; do not add extra blank lines between list items; do not mix ordered list markers inside unordered lists unless the original has nested ordered lists.
- Do not invent extra leading indent versus the source block; do not wrap the result in extra blank paragraphs
- Output the complete replacement — do not truncate mid-sentence or omit later list items`;
  }
  return `你是 topmind 编辑器的写作助手（类似 Notion AI 的行内能力）。
规则：
- 只输出可直接写入编辑器的正文结果；不要输出思考过程、推理步骤、分析、自我检查
- 禁止使用 <think> / <thinking> / <reasoning> 等标签或 \`\`\`thinking 代码围栏
- 不要加「以下是结果」「Here is the rewritten version」等前缀或「希望对你有帮助」等后缀
- 不加引号包裹全文；不要用 markdown 代码围栏包裹整段结果（除非用户明确要代码块）
- 输出语言：本轮用户明确要求优先；否则保持原文/文档语言；再否则跟随工作区 locale。不要跟随 UI 语言。
- 保留必要的 Markdown 结构（标题、列表、链接、加粗等）若语境需要
- 不要编造原文没有的事实；续写时合理衔接，不引入无关设定
- 若是总结，输出简洁要点；若是续写，从断点自然接上
- **整篇格式一致（关键）**：若提供了「全文/文档上下文」，改写结果必须贴合整篇文档的写法与版式——标题层级、列表标记（- / * / 1.）、任务列表、段落密度、空行习惯、链接/加粗风格、中英文混排习惯；禁止只按选区局部另起一套结构或语气。只输出替换选区的那一段，不要复述全文。\n- **列表格式约束**：保持原文档的列表标记符号（用短横线就继续用短横线，用星号就继续用星号）；嵌套列表保持原有缩进层级（子项用 2 空格缩进）；不同列表类型之间用空行分隔；列表项之间不加多余空行；不要在无序列表中混入数字列表标记（除非原文档有嵌套数字列表）。
- 不要相对原文块额外增加前导缩进；不要在结果前后或中间塞入多余空段落
- 输出完整替换正文——不要半句截断，也不要漏掉后面的列表项`;
}

/** System rules shared by all one-shot complete calls (default zh for backward compat). */
export const INLINE_SYSTEM = getInlineSystem("zh");

/** Max chars of document context embedded in the user prompt. */
export const DOCUMENT_CONTEXT_MAX = 6_000;

/**
 * Clip a document to a budget, preferring a window around the selection when
 * the selection appears inside the full text; otherwise head + tail samples.
 *
 * @param {string} documentText
 * @param {string} [selectionText]
 * @param {number} [maxChars]
 * @returns {string}
 */
export function clipDocumentContext(
  documentText,
  selectionText = "",
  maxChars = DOCUMENT_CONTEXT_MAX,
) {
  const doc = String(documentText || "");
  if (!doc.trim()) return "";
  if (doc.length <= maxChars) return doc;

  const sel = String(selectionText || "").trim();
  if (sel.length >= 8) {
    const idx = doc.indexOf(sel);
    if (idx >= 0) {
      const half = Math.floor((maxChars - sel.length) / 2);
      const start = Math.max(0, idx - Math.max(400, half));
      const end = Math.min(doc.length, idx + sel.length + Math.max(400, half));
      let slice = doc.slice(start, end);
      if (start > 0) slice = `…\n${slice}`;
      if (end < doc.length) slice = `${slice}\n…`;
      if (slice.length > maxChars) slice = `${slice.slice(0, maxChars - 1)}…`;
      return slice;
    }
  }

  // Head + tail sample so structure (frontmatter, headings) and ending style both show
  const headBudget = Math.floor(maxChars * 0.55);
  const tailBudget = maxChars - headBudget - 8;
  const head = doc.slice(0, headBudget);
  const tail = doc.slice(-Math.max(200, tailBudget));
  return `${head}\n…\n${tail}`;
}

/**
 * Whether rewrite-style modes should inject whole-document format guidance.
 * @param {string} mode
 * @param {string} [action]
 */
export function shouldAttachDocumentContext(mode, action) {
  const m = String(mode || "rewrite");
  if (m === "continue" || m === "summarize") return false;
  // generate/custom may still benefit when document is provided
  if (m === "generate") return true;
  // rewrite (polish, format, fix, shorter, expand, bullets, formal, casual…)
  return m === "rewrite" || !m;
}

/**
 * Default user instruction when none provided.
 * @param {string} [locale]
 */
function defaultUserInstr(locale) {
  return resolveInlineLocale(locale) === "en" ? "Polish this text." : "润色这段文字。";
}

/**
 * Build the user-facing prompt for `generateText` (no network).
 *
 * @param {{
 *   text?: string,
 *   mode?: "rewrite" | "continue" | "summarize" | "generate" | string,
 *   userInstr?: string,
 *   documentText?: string | null,
 *   action?: string,
 *   locale?: string,
 * }} opts
 * @returns {{
 *   system: string,
 *   prompt: string,
 *   mode: string,
 *   hasDocumentContext: boolean,
 *   documentContextChars: number,
 * }}
 */
export function buildInlineCompletePrompt(opts = {}) {
  const locale = resolveInlineLocale(opts.locale);
  const src = String(opts.text || "").trim();
  const mode = String(opts.mode || "rewrite");
  const userInstr = String(opts.userInstr || defaultUserInstr(locale)).trim();
  const action = String(opts.action || "");
  const rawDoc = opts.documentText != null ? String(opts.documentText) : "";
  const system = getInlineSystem(locale);

  let documentBlock = "";
  let hasDocumentContext = false;
  if (shouldAttachDocumentContext(mode, action) && rawDoc.trim()) {
    // Skip when document is identical to selection (menu-scope full-doc rewrite)
    const sameAsSelection =
      rawDoc.trim() === src ||
      (src.length > 0 && rawDoc.trim().length <= src.length + 4 && rawDoc.includes(src));
    if (!sameAsSelection || action === "format" || action === "polish") {
      const clipped = clipDocumentContext(rawDoc, src);
      if (clipped.trim()) {
        // For full-doc polish/format when selection IS the doc, still attach format rules
        // via instruction; only embed a short structural sample if doc is huge.
        if (sameAsSelection) {
          documentBlock = "";
          hasDocumentContext = true; // whole selection is the doc — flag for tests
        } else {
          documentBlock = clipped;
          hasDocumentContext = true;
        }
      }
    }
  }

  const wholeDocRule =
    hasDocumentContext || action === "format" || action === "polish"
      ? (locale === "en"
        ? "\n\n【Whole-document format】Output must match the full document's Markdown structure and style (heading levels, list markers, paragraph density, language); output only the body that replaces the selection/target — do not restate unselected full text, do not invent a conflicting heading system."
        : "\n\n【整篇格式约束】输出必须与全文的 Markdown 结构与文风一致（标题层级、列表符号、段落密度、语言）；只输出应替换选区/目标段的正文，不要复述未选中的全文，不要另起冲突的标题体系。")
      : "";

  let prompt;
  if (mode === "continue") {
    if (locale === "en") {
      prompt = `${userInstr}\n\n---\nPreceding text (continue from here, do not repeat):\n${src || "(empty document)"}\n---\n\nOutput only the continuation:`;
    } else {
      prompt = `${userInstr}\n\n---\n上文（请接续，不要重复）：\n${src || "（空文档）"}\n---\n\n请只输出续写内容：`;
    }
  } else if (mode === "summarize") {
    if (locale === "en") {
      prompt = `${userInstr}\n\n---\nSource:\n${src}\n---\n\nOutput only the summary:`;
    } else {
      prompt = `${userInstr}\n\n---\n原文：\n${src}\n---\n\n请只输出总结：`;
    }
  } else if (mode === "generate") {
    if (locale === "en") {
      const ctx = documentBlock
        ? `Document context (match its structure and tone):\n${documentBlock}\n\n`
        : src
          ? `Reference context:\n${src}\n\n`
          : "";
      prompt = `${userInstr}${wholeDocRule}\n\n${ctx}Output only the generated body:`;
    } else {
      const ctx = documentBlock
        ? `文档上下文（匹配其结构与语气）：\n${documentBlock}\n\n`
        : src
          ? `参考上下文：\n${src}\n\n`
          : "";
      prompt = `${userInstr}${wholeDocRule}\n\n${ctx}请只输出生成的正文：`;
    }
  } else {
    // rewrite (polish / format / fix / shorter / …)
    if (locale === "en") {
      const docSection = documentBlock
        ? `\n\n---\nFull document / document context (for structure and style only — do not restate in full):\n${documentBlock}\n---`
        : "";
      prompt = `${userInstr}${wholeDocRule}\n\n---\nSelected text:\n${src}\n---${docSection}\n\nOutput only the rewrite:`;
    } else {
      const docSection = documentBlock
        ? `\n\n---\n全文/文档上下文（仅供对齐结构与风格，勿复述全文）：\n${documentBlock}\n---`
        : "";
      prompt = `${userInstr}${wholeDocRule}\n\n---\n选中原文：\n${src}\n---${docSection}\n\n请只输出改写结果：`;
    }
  }

  return {
    system,
    prompt,
    mode,
    hasDocumentContext,
    documentContextChars: documentBlock.length,
  };
}

/**
 * Scale one-shot complete output budget with rewrite size.
 * Summarize stays small; rewrite/generate/continue grow with source so long
 * polish/format is not hard-capped at 4096 tokens.
 *
 * @param {string} mode
 * @param {number} textLength
 * @returns {number}
 */
export function resolveCompleteMaxTokens(mode, textLength) {
  const len = Math.max(0, Number(textLength) || 0);
  if (mode === "summarize") return 2048;
  // ~2 chars/token worst-case (CJK) × expand headroom + fixed overhead
  const needed = Math.ceil(len / 2) * 2 + 1024;
  const floor = mode === "continue" ? 3072 : 4096;
  return Math.min(16384, Math.max(floor, needed));
}
