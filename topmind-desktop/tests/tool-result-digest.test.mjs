/**
 * Tool-result digest — head+tail retention, structure-aware clamp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { digestToolResult, digestString } from "../electron/lib/tool-result-digest.mjs";

test("digestString keeps head and tail of long text", () => {
  const s = `${"A".repeat(5000)}MIDDLE${"B".repeat(5000)}`;
  const d = digestString(s, 1000);
  assert.ok(d.length < s.length);
  assert.ok(d.startsWith("AAAA"));
  assert.ok(d.endsWith("BBBB"));
  assert.match(d, /省略/u);
});

test("digestToolResult keeps verdict fields on huge objects", () => {
  const big = {
    ok: true,
    relativePath: "20-专题/a.md",
    hint: "do the thing",
    body: "X".repeat(80_000),
    items: Array.from({ length: 200 }, (_, i) => ({ i, text: "y".repeat(200) })),
  };
  const d = digestToolResult(big, { maxChars: 4000 });
  const s = JSON.stringify(d);
  assert.ok(s.length <= 4000 + 200, `serialized ${s.length}`);
  assert.equal(d.ok, true);
  assert.equal(d.relativePath, "20-专题/a.md");
});

test("short results pass through unchanged", () => {
  const r = { ok: true, items: [1, 2, 3] };
  assert.deepEqual(digestToolResult(r, { maxChars: 6000 }), r);
});
