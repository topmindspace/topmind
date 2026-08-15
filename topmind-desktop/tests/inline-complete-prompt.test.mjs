/**
 * Drives the **shipped** complete / prompt-assembly path (electron/lib/inline-complete-prompt.mjs).
 * Asserts polish + format (+ shared rewrite) include target text AND whole-document format context.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInlineCompletePrompt,
  clipDocumentContext,
  INLINE_SYSTEM,
  shouldAttachDocumentContext,
  resolveCompleteMaxTokens,
} from "../electron/lib/inline-complete-prompt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const SAMPLE_DOC = `# 专题笔记

## 背景

- 第一点
- 第二点

## 正文

这是一段**重要**的段落，需要润色。

### 小结

1. 保留列表
2. 统一风格
`;

const SELECTION = "这是一段**重要**的段落，需要润色。";

test("INLINE_SYSTEM requires whole-document format consistency", () => {
  assert.match(INLINE_SYSTEM, /整篇格式一致|whole|全文/u);
  assert.match(INLINE_SYSTEM, /列表|list/iu);
  assert.match(INLINE_SYSTEM, /标题|heading/iu);
});

test("shouldAttachDocumentContext true for rewrite; false for continue/summarize", () => {
  assert.equal(shouldAttachDocumentContext("rewrite", "polish"), true);
  assert.equal(shouldAttachDocumentContext("rewrite", "format"), true);
  assert.equal(shouldAttachDocumentContext("generate", "custom"), true);
  assert.equal(shouldAttachDocumentContext("continue", "continue"), false);
  assert.equal(shouldAttachDocumentContext("summarize", "summarize"), false);
});

test("clipDocumentContext prefers window around selection", () => {
  const clipped = clipDocumentContext(SAMPLE_DOC, SELECTION, 200);
  assert.ok(clipped.includes(SELECTION) || clipped.includes("重要"));
  assert.ok(clipped.length <= 220);
});

test("buildInlineCompletePrompt polish includes selection + document context + whole-doc rule", () => {
  const out = buildInlineCompletePrompt({
    text: SELECTION,
    mode: "rewrite",
    userInstr: "润色：更通顺、专业，贴合全文。",
    documentText: SAMPLE_DOC,
    action: "polish",
  });
  assert.equal(out.mode, "rewrite");
  assert.equal(out.hasDocumentContext, true);
  assert.ok(out.documentContextChars > 0);
  assert.match(out.prompt, /选中原文/u);
  assert.match(out.prompt, /重要/u);
  assert.match(out.prompt, /全文\/文档上下文|文档上下文/u);
  assert.match(out.prompt, /整篇格式约束/u);
  assert.match(out.prompt, /请只输出改写结果/u);
  // Document structure markers present
  assert.match(out.prompt, /专题笔记|背景|第一点/u);
  assert.match(out.system, /整篇格式一致/u);
});

test("buildInlineCompletePrompt format action includes format constraints and document", () => {
  const out = buildInlineCompletePrompt({
    text: SELECTION,
    mode: "rewrite",
    userInstr: "格式优化：按整篇文档的既有版式整理 Markdown",
    documentText: SAMPLE_DOC,
    action: "format",
  });
  assert.equal(out.hasDocumentContext, true);
  assert.match(out.prompt, /格式优化|整篇格式约束/u);
  assert.ok(out.prompt.includes(SELECTION), "prompt includes selection text");
  assert.match(out.prompt, /全文\/文档上下文/u);
});

test("buildInlineCompletePrompt shorter rewrite also gets document context (shared path)", () => {
  const out = buildInlineCompletePrompt({
    text: SELECTION,
    mode: "rewrite",
    userInstr: "更简洁",
    documentText: SAMPLE_DOC,
    action: "shorter",
  });
  assert.equal(out.hasDocumentContext, true);
  assert.match(out.prompt, /全文\/文档上下文/u);
});

test("buildInlineCompletePrompt continue does not embed document context block", () => {
  const out = buildInlineCompletePrompt({
    text: SAMPLE_DOC.slice(-80),
    mode: "continue",
    userInstr: "续写",
    documentText: SAMPLE_DOC,
    action: "continue",
  });
  assert.equal(out.hasDocumentContext, false);
  assert.doesNotMatch(out.prompt, /全文\/文档上下文/u);
  assert.match(out.prompt, /请只输出续写内容/u);
});

test("ai-service complete wires buildInlineCompletePrompt + documentText param", () => {
  const svc = read("electron/ai-service.mjs");
  assert.match(svc, /buildInlineCompletePrompt/);
  assert.match(svc, /from ["']\.\/lib\/inline-complete-prompt\.mjs["']/);
  assert.match(svc, /documentText/);
  assert.match(svc, /assembled\.system|assembled\.prompt/);
  assert.match(svc, /resolveCompleteMaxTokens/);
  assert.doesNotMatch(svc, /maxOutputTokens:\s*resolvedMode === "summarize" \? 2048 : 4096/);
});

test("resolveCompleteMaxTokens scales rewrite budget past a 4096 hard cap", () => {
  assert.equal(resolveCompleteMaxTokens("summarize", 20_000), 2048);
  assert.equal(resolveCompleteMaxTokens("rewrite", 200), 4096);
  const longRewrite = resolveCompleteMaxTokens("rewrite", 12_000);
  assert.ok(longRewrite > 4096, `long rewrite budget ${longRewrite} should exceed 4096`);
  assert.ok(longRewrite <= 16384);
  assert.equal(resolveCompleteMaxTokens("rewrite", 80_000), 16384);
  assert.match(INLINE_SYSTEM, /完整替换|complete replacement|不要半句截断|do not truncate/iu);
});

test("SelectionAiBar passes documentText on complete", () => {
  // complete call site moved into the useSelectionAi hook
  const bar = read("src/components/editor/useSelectionAi.ts");
  assert.match(bar, /documentText/);
  assert.match(bar, /getEditorMarkdown/);
  assert.match(bar, /api\.ai\.complete/);
});

test("api.complete types documentText", () => {
  const api = read("src/services/api.ts");
  assert.match(api, /documentText\?:/);
});

test("polishComposerText accepts optional documentText", async () => {
  const mod = await import(
    pathToFileURLSafe(path.join(root, "src/lib/ai-polish-text.ts"))
  );
  const calls = [];
  await mod.polishComposerText(
    async (args) => {
      calls.push(args);
      return { text: "ok" };
    },
    "hello",
    "t",
    { documentText: SAMPLE_DOC },
  );
  assert.equal(calls[0].action, "polish");
  assert.equal(calls[0].documentText, SAMPLE_DOC.trim());
});

function pathToFileURLSafe(p) {
  return new URL(`file://${p}`).href;
}
