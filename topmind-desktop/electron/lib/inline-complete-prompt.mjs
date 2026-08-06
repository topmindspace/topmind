/**
 * Pure prompt assembly for Desktop `ai.complete` (inline rewrite / polish / format).
 * Unit-testable without Electron, network, or generateText.
 *
 * Goal: selection rewrites match the **whole document's** structure and style
 * (headings, list markers, density, language) — not selection-only isolation.
 */

/** System rules shared by all one-shot complete calls. */
export const INLINE_SYSTEM = `你是 topmind 编辑器的写作助手（类似 Notion AI 的行内能力）。
规则：
- 只输出可直接写入编辑器的正文结果；不要输出思考过程、推理步骤、分析、自我检查
- 禁止使用 <think> / <thinking> / <reasoning> 等标签或 \`\`\`thinking 代码围栏
- 不要加「以下是结果」「Here is the rewritten version」等前缀或「希望对你有帮助」等后缀
- 不加引号包裹全文；不要用 markdown 代码围栏包裹整段结果（除非用户明确要代码块）
- 保持原语言（除非用户要求翻译）
- 保留必要的 Markdown 结构（标题、列表、链接、加粗等）若语境需要
- 不要编造原文没有的事实；续写时合理衔接，不引入无关设定
- 若是总结，输出简洁要点；若是续写，从断点自然接上
- **整篇格式一致（关键）**：若提供了「全文/文档上下文」，改写结果必须贴合整篇文档的写法与版式——标题层级、列表标记（- / * / 1.）、任务列表、段落密度、空行习惯、链接/加粗风格、中英文混排习惯；禁止只按选区局部另起一套结构或语气。只输出替换选区的那一段，不要复述全文。`;

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
 * Build the user-facing prompt for `generateText` (no network).
 *
 * @param {{
 *   text?: string,
 *   mode?: "rewrite" | "continue" | "summarize" | "generate" | string,
 *   userInstr?: string,
 *   documentText?: string | null,
 *   action?: string,
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
  const src = String(opts.text || "").trim();
  const mode = String(opts.mode || "rewrite");
  const userInstr = String(opts.userInstr || "润色这段文字。").trim();
  const action = String(opts.action || "");
  const rawDoc = opts.documentText != null ? String(opts.documentText) : "";

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
      ? "\n\n【整篇格式约束】输出必须与全文的 Markdown 结构与文风一致（标题层级、列表符号、段落密度、语言）；只输出应替换选区/目标段的正文，不要复述未选中的全文，不要另起冲突的标题体系。"
      : "";

  let prompt;
  if (mode === "continue") {
    prompt = `${userInstr}\n\n---\n上文（请接续，不要重复）：\n${src || "（空文档）"}\n---\n\n请只输出续写内容：`;
  } else if (mode === "summarize") {
    prompt = `${userInstr}\n\n---\n原文：\n${src}\n---\n\n请只输出总结：`;
  } else if (mode === "generate") {
    const ctx = documentBlock
      ? `文档上下文（匹配其结构与语气）：\n${documentBlock}\n\n`
      : src
        ? `参考上下文：\n${src}\n\n`
        : "";
    prompt = `${userInstr}${wholeDocRule}\n\n${ctx}请只输出生成的正文：`;
  } else {
    // rewrite (polish / format / fix / shorter / …)
    const docSection = documentBlock
      ? `\n\n---\n全文/文档上下文（仅供对齐结构与风格，勿复述全文）：\n${documentBlock}\n---`
      : "";
    prompt = `${userInstr}${wholeDocRule}\n\n---\n选中原文：\n${src}\n---${docSection}\n\n请只输出改写结果：`;
  }

  return {
    system: INLINE_SYSTEM,
    prompt,
    mode,
    hasDocumentContext,
    documentContextChars: documentBlock.length,
  };
}
