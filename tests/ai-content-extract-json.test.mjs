import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonPayload } from "../lib/ai-content-sanitize.mjs";

test("extractJsonPayload handles clean JSON", () => {
  const obj = extractJsonPayload('{"name":"topmind","ok":true}', { type: "object" });
  assert.deepEqual(obj, { name: "topmind", ok: true });

  const arr = extractJsonPayload('["item1", "item2"]', { type: "array" });
  assert.deepEqual(arr, ["item1", "item2"]);
});

test("extractJsonPayload strips thinking blocks before parsing", () => {
  const text = `
<think>
Let's analyze what the user needs.
Maybe {"temp": 123} is relevant? No.
</think>
Here is the final JSON output:
\`\`\`json
{
  "profile": ["学习 TypeScript", "常住上海"],
  "retire": []
}
\`\`\`
Hope this helps!
`;
  const result = extractJsonPayload(text, { type: "object" });
  assert.deepEqual(result, {
    profile: ["学习 TypeScript", "常住上海"],
    retire: [],
  });
});

test("extractJsonPayload handles unclosed thinking blocks gracefully", () => {
  const text = `
<thought>
I need to produce an array of topics.
[{"category": "old", "name": "bad"}]
The real topics are:
\`\`\`json
[
  {"category": "20-专题", "name": "2026-AI引擎"}
]
\`\`\`
`;
  const result = extractJsonPayload(text, { type: "array" });
  assert.deepEqual(result, [
    { category: "20-专题", name: "2026-AI引擎" },
  ]);
});

test("extractJsonPayload fixes trailing commas", () => {
  const text = `
{
  "add": ["整理书架", "回复邮件", ],
  "complete": ["买菜", ],
  "update": [],
}
`;
  const result = extractJsonPayload(text, { type: "object" });
  assert.deepEqual(result, {
    add: ["整理书架", "回复邮件"],
    complete: ["买菜"],
    update: [],
  });
});

test("extractJsonPayload correctly ignores brackets inside string literals", () => {
  const text = `
{
  "content": "A string with {braces} and [brackets] inside it",
  "quote": "Nested \\"quoted\\" text",
  "count": 42
}
`;
  const result = extractJsonPayload(text, { type: "object" });
  assert.equal(result.content, "A string with {braces} and [brackets] inside it");
  assert.equal(result.quote, 'Nested "quoted" text');
  assert.equal(result.count, 42);
});

test("extractJsonPayload tolerates conversational preambles without code blocks", () => {
  const text = `
Sure! Here is the JSON result:
{"status":"ok","items":[1,2,3]}
Let me know if you need anything else!
`;
  const result = extractJsonPayload(text, { type: "object" });
  assert.deepEqual(result, { status: "ok", items: [1, 2, 3] });
});

test("extractJsonPayload returns fallback on completely invalid input", () => {
  const result = extractJsonPayload("Sorry, I could not generate any JSON.", {
    type: "object",
    fallback: { fallback: true },
  });
  assert.deepEqual(result, { fallback: true });

  const nullFallback = extractJsonPayload(null, { type: "array" });
  assert.equal(nullFallback, null);
});
