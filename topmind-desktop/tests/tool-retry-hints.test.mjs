/**
 * Adaptive tool retry hints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRetryHint } from "../electron/lib/tool-retry-hints.mjs";

test("edit_file hash-stale hint points at read_file + new hash", () => {
  const h = buildRetryHint("edit_file", "hash-mismatch: expectedHash was stale", {
    relativePath: "20-专题/a.md",
    locale: "zh-CN",
  });
  assert.ok(h);
  assert.match(h, /read_file/u);
  assert.match(h, /contentHash/u);
});

test("edit_file no-match hint asks for surrounding lines", () => {
  const h = buildRetryHint("edit_file", "未能找到匹配片段 (no-match)", {
    relativePath: "10-动态/2026-W01.md",
  });
  assert.match(h, /startLine|前后/u);
});

test("write-blocked payload hint forbids thinking dumps", () => {
  const h = buildRetryHint("save_file", "write-blocked: thinking", { locale: "zh-CN" });
  assert.match(h, /思考过程|thinking/u);
  assert.match(h, /Markdown/u);
});

test("protected delete hint asks for user action", () => {
  const h = buildRetryHint("delete_path", "locked/core path is protected", { locale: "zh-CN" });
  assert.match(h, /locked|受保护/u);
});

test("unknown errors return undefined (no noise)", () => {
  assert.equal(buildRetryHint("list_files", "something odd"), undefined);
});
