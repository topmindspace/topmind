/**
 * Kernel unique-span matcher + chat thinking split (shipped lib/).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyUniqueSpan,
  formatMismatchDiagnostic,
  nearbyContext,
  normalizeForMatch,
  stripCopiedLineNumbers,
} from "../lib/precise-edit.mjs";
import { formatReadWindow, numberLines } from "../lib/file-window.mjs";
import {
  splitAssistantVisible,
  ingestAssistantTextDelta,
} from "../lib/ai-content-sanitize.mjs";

function bigNote() {
  const lines = [];
  for (let i = 1; i <= 800; i++) {
    if (i === 450) {
      lines.push("UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.");
    } else {
      lines.push(
        `Padding line ${i} with enough characters so the default 400-line window plus a 14k summary cannot see the middle of this note.`,
      );
    }
  }
  return lines.join("\n");
}

describe("precise-edit matcher", () => {
  it("exact unique middle span applies and leaves the rest intact", () => {
    const hay = bigNote();
    const oldText = "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.";
    const newText = "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the revised middle thought.";
    const applied = applyUniqueSpan(hay, { oldText, newText });
    assert.equal(applied.ok, true);
    assert.equal(applied.mode, "exact");
    assert.equal(applied.replacements, 1);
    assert.match(applied.next, /revised middle thought/);
    assert.doesNotMatch(applied.next, /original middle thought/);
    assert.equal(applied.next.split("\n").length, hay.split("\n").length);
    assert.match(applied.next, /Padding line 1 /);
    assert.match(applied.next, /Padding line 800 /);
  });

  it("whitespace/newline drift still applies a unique middle span", () => {
    const hay = bigNote().replace(
      "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.",
      "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.  \r\n",
    );
    const oldText = "UNIQUE_MIDDLE_PARAGRAPH_TARGET: the original middle thought.\n";
    const applied = applyUniqueSpan(hay, {
      oldText,
      newText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: whitespace-tolerant edit.\n",
    });
    assert.equal(applied.ok, true, applied.ok ? "" : applied.diagnostic);
    assert.equal(applied.mode, "normalized");
    assert.match(applied.next, /whitespace-tolerant edit/);
    assert.match(applied.next, /Padding line 449 /);
    assert.match(applied.next, /Padding line 451 /);
  });

  it("ambiguous oldText refuses and does not change the haystack", () => {
    const hay = "hello world\n\nhello again\n";
    const applied = applyUniqueSpan(hay, { oldText: "hello", newText: "hi" });
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "ambiguous");
    assert.equal(applied.next, hay);
    assert.match(applied.diagnostic, /matched 2 times|nearby\/context/u);
  });

  it("no-match returns nearby/context diagnostic", () => {
    const hay = bigNote();
    const applied = applyUniqueSpan(hay, {
      oldText: "UNIQUE_MIDDLE_PARAGRAPH_TARGET: slightly wrong wording.",
      newText: "nope",
    });
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "no-match");
    assert.equal(applied.next, hay);
    assert.match(applied.diagnostic, /nearby\/context/u);
    assert.match(applied.diagnostic, /450\|/u);
  });

  it("strips numbered-read prefixes before matching", () => {
    const hay = "alpha\nUNIQUE mid\nomega\n";
    const numbered = numberLines("UNIQUE mid", 2);
    const applied = applyUniqueSpan(hay, { oldText: numbered, newText: "UNIQUE done" });
    assert.equal(applied.ok, true, applied.ok ? "" : applied.diagnostic);
    assert.match(applied.next, /UNIQUE done/);
  });

  it("heading locator refuses a span outside that section", () => {
    const hay = "# One\n\nalpha\n\n# Two\n\nbeta unique\n";
    const applied = applyUniqueSpan(hay, {
      oldText: "beta unique",
      newText: "beta new",
      heading: "One",
    });
    assert.equal(applied.ok, false);
    assert.match(applied.diagnostic, /nearby\/context/u);
  });
});

describe("file-window mid-file locate", () => {
  it("around= jumps past the default 400-line window", () => {
    const hay = bigNote();
    const win = formatReadWindow(hay, {
      around: "UNIQUE_MIDDLE_PARAGRAPH_TARGET",
      contextLines: 5,
    });
    assert.equal(win.empty, false);
    assert.ok(win.startLine > 400, `startLine ${win.startLine}`);
    assert.match(win.numbered, /UNIQUE_MIDDLE_PARAGRAPH_TARGET/);
    assert.match(win.numbered, /450\|/u);
  });
});

describe("splitAssistantVisible", () => {
  it("folds tagged think, fenced thinking, and untagged CoT; keeps the answer", () => {
    const tagged = `<think>secret plan</think>\n\n## 结论\n- 真答案`;
    const a = splitAssistantVisible(tagged);
    assert.doesNotMatch(a.body, /secret plan|<think>/i);
    assert.match(a.body, /结论|真答案/);
    assert.match(a.reasoning, /secret plan/);

    const fenced = "```thinking\nscratch\n```\n\nDone.";
    const b = splitAssistantVisible(fenced);
    assert.doesNotMatch(b.body, /scratch|```thinking/i);
    assert.match(b.body, /Done/);
    assert.match(b.reasoning, /scratch/);

    const cot = "Let me think about the file structure first.\nI will outline steps.\n\n## Answer\nShip the patch.";
    const c = splitAssistantVisible(cot);
    assert.doesNotMatch(c.body, /Let me think/i);
    assert.match(c.body, /Ship the patch/);
    assert.match(c.reasoning, /Let me think/i);
  });

  it("ingestAssistantTextDelta reclassifies an unclosed think tag", () => {
    let acc = ingestAssistantTextDelta(null, "<think>abc");
    assert.equal(acc.body, "");
    assert.match(acc.reasoning, /abc/);
    acc = ingestAssistantTextDelta(acc, "</think>\n\nVisible answer");
    assert.match(acc.body, /Visible answer/);
    assert.doesNotMatch(acc.body, /abc|<think>/);
  });

  it("unclosed thinking fence stays out of the body until it closes", () => {
    const open = splitAssistantVisible("```thinking\nlong dump about the file");
    assert.equal(open.body, "");
    assert.match(open.reasoning, /long dump about the file/);
    assert.doesNotMatch(open.body, /long dump|```thinking/);

    let acc = ingestAssistantTextDelta(null, "```thinking\nlong dump");
    assert.equal(acc.body, "");
    assert.match(acc.reasoning, /long dump/);
    acc = ingestAssistantTextDelta(acc, " continues");
    assert.equal(acc.body, "");
    assert.match(acc.reasoning, /continues/);
    acc = ingestAssistantTextDelta(acc, "\n```\n\n## Answer\nOnly the answer.");
    assert.equal(acc.body.includes("long dump"), false);
    assert.doesNotMatch(acc.body, /```thinking/);
    assert.match(acc.body, /Only the answer/);
    assert.match(acc.reasoning, /long dump/);
  });

  it("thinking-only tagged dump has empty body", () => {
    const split = splitAssistantVisible("<think>only dump</think>");
    assert.equal(split.body, "");
    assert.match(split.reasoning, /only dump/);
  });

  it("does not fold a clean answer that merely starts with Analysis", () => {
    const sentence = "Analysis of the market shows we should keep the weekly stream.";
    const split = splitAssistantVisible(sentence);
    assert.equal(split.body, sentence);
    assert.equal(split.reasoning, "");
  });
});

describe("diagnostic helpers", () => {
  it("nearbyContext finds a unique prefix line", () => {
    const hits = nearbyContext(bigNote(), "UNIQUE_MIDDLE_PARAGRAPH_TARGET");
    assert.ok(hits.length >= 1);
    assert.match(hits[0].excerpt, /450\|/u);
  });

  it("normalizeForMatch drops CRLF and trailing spaces only", () => {
    assert.equal(normalizeForMatch("a  \r\nb"), "a\nb");
    assert.equal(normalizeForMatch("keep  two"), "keep  two");
  });

  it("formatMismatchDiagnostic always includes nearby/context", () => {
    const d = formatMismatchDiagnostic({
      reason: "no-match",
      haystack: "foo\nbar unique here\n",
      needle: "bar unique missing",
      path: "x.md",
    });
    assert.match(d, /nearby\/context/u);
  });

  it("stripCopiedLineNumbers only when majority numbered", () => {
    assert.equal(stripCopiedLineNumbers("  12|hello"), "hello");
    assert.equal(stripCopiedLineNumbers("plain\n12|maybe"), "plain\n12|maybe");
  });
});
