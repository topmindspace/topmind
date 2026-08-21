import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeInlineAiResult } from "../electron/lib/inline-ai-result.mjs";
import {
  sanitizeInlineAiResult as sanitizeInlineAiResultRenderer,
  inlineAiSelectionDrifted,
} from "../src/lib/inline-ai-result.ts";

describe("sanitizeInlineAiResult", () => {
  it("returns clean prose unchanged", () => {
    const src = "这是一段润色后的正文，保留 **加粗** 与列表：\n\n- a\n- b";
    assert.equal(sanitizeInlineAiResult(src), src);
  });

  it("strips <think>…</think> blocks", () => {
    const raw = `<think>
先分析用户意图，再改写。
</think>

最终正文在这里。`;
    assert.equal(sanitizeInlineAiResult(raw), "最终正文在这里。");
  });

  it("strips <thinking> and <reasoning> case-insensitively", () => {
    const raw = `<Thinking>plan A</Thinking>
<REASONING>step 2</REASONING>
Hello world`;
    assert.equal(sanitizeInlineAiResult(raw), "Hello world");
  });

  it("strips fenced thinking blocks", () => {
    const raw = "```thinking\nsecret plan\n```\n\nVisible result";
    assert.equal(sanitizeInlineAiResult(raw), "Visible result");
  });

  it("strips outer markdown fence wrappers", () => {
    const raw = "```markdown\n# Title\n\nbody\n```";
    assert.equal(sanitizeInlineAiResult(raw), "# Title\n\nbody");
  });

  it("strips EN/ZH meta preambles", () => {
    assert.equal(
      sanitizeInlineAiResult("Here is the rewritten version:\n\nClean text."),
      "Clean text.",
    );
    assert.equal(
      sanitizeInlineAiResult("以下是改写结果：\n\n干净正文"),
      "干净正文",
    );
  });

  it("drops unclosed think tags to end", () => {
    const raw = "prefix\n<think>\nstill thinking forever";
    assert.equal(sanitizeInlineAiResult(raw), "prefix");
  });

  it("handles empty / null", () => {
    assert.equal(sanitizeInlineAiResult(""), "");
    assert.equal(sanitizeInlineAiResult(null), "");
    assert.equal(sanitizeInlineAiResult(undefined), "");
  });

  it("strips hope-this-helps footers", () => {
    assert.equal(
      sanitizeInlineAiResult("好文案。\n\n希望对你有帮助！"),
      "好文案。",
    );
  });

  it("collapses extra blank lines between same-type list items", () => {
    assert.equal(sanitizeInlineAiResult("- a\n\n- b\n\n- c"), "- a\n- b\n- c");
    assert.equal(sanitizeInlineAiResult("1. a\n\n2. b"), "1. a\n2. b");
  });

  it("think-only payload becomes empty (must not persist)", () => {
    assert.equal(sanitizeInlineAiResult("<think>only thinking</think>"), "");
  });

  it("renderer sanitize matches main-process for think/meta/fence vectors", () => {
    const vectors = [
      "<think>plan</think>\n\nVisible",
      "```thinking\nsecret\n```\n\nBody",
      "Here is the rewritten version:\n\nClean.",
      "思考过程：内部\n\n# 标题\n正文",
      "好文案。\n\n---\n说明：改了结构",
    ];
    for (const raw of vectors) {
      assert.equal(sanitizeInlineAiResultRenderer(raw), sanitizeInlineAiResult(raw), raw);
    }
    assert.equal(inlineAiSelectionDrifted("hello", "hello"), false);
    assert.equal(inlineAiSelectionDrifted("hello  \nworld", "hello\nworld"), false);
    assert.equal(inlineAiSelectionDrifted("hello", "hello edited"), true);
  });
});
