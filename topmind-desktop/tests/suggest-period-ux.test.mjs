/**
 * Suggestion UX — write-kinds confirm; open-existing uses 打开;
 * accept/nav uses apply evidence (yearDir), not a flat periodic path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  suggestionApplyIsWrite,
  suggestionOpenPath,
  suggestionNavPathAfterApply,
  WRITE_SUGGESTION_KINDS,
} from "../src/lib/suggest-apply-label.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("write-kinds are confirm-to-write, not open", () => {
  for (const kind of WRITE_SUGGESTION_KINDS) {
    assert.equal(suggestionApplyIsWrite(kind), true, kind);
  }
  assert.equal(suggestionApplyIsWrite("stream_digest"), true);
  assert.equal(suggestionApplyIsWrite("ai_summary"), true);
  assert.equal(suggestionApplyIsWrite("promote_memory"), true);
  assert.equal(suggestionApplyIsWrite("open_profile"), false);
  assert.equal(suggestionApplyIsWrite(undefined, "pending_write"), true);
  assert.equal(suggestionApplyIsWrite("open_profile", "suggestion"), false);
});

test("suggestionOpenPath prefers existing 周期本 / sourcePath, rejects fallback files", () => {
  assert.equal(
    suggestionOpenPath({
      targetPath: "10-动态/2026/2026-W26.md",
      suggestionKind: "stream_digest",
      suggestionPayload: { period: "2026-W26", sourcePath: "10-动态/2026/2026-W26.md" },
    }),
    "10-动态/2026/2026-W26.md",
  );
  assert.equal(
    suggestionOpenPath({
      suggestionPayload: { sourcePath: "memory/periodic/undefined.md" },
    }),
    null,
  );
  assert.equal(
    suggestionOpenPath({
      targetPath: "memory/periodic/period.md",
    }),
    null,
  );
});

test("suggestionNavPathAfterApply uses evidence yearDir and rejects flat fallbacks", () => {
  assert.equal(
    suggestionNavPathAfterApply({
      ok: true,
      wroteFiles: true,
      targetPath: "memory/periodic/2026/2026-W26.md",
    }),
    "memory/periodic/2026/2026-W26.md",
  );
  assert.equal(
    suggestionNavPathAfterApply({
      ok: true,
      wroteFiles: true,
      targetPath: "memory/periodic/period.md",
    }),
    null,
  );
  assert.equal(
    suggestionNavPathAfterApply({
      ok: true,
      wroteFiles: true,
      targetPath: "memory/periodic/undefined.md",
    }),
    null,
  );
  assert.equal(
    suggestionNavPathAfterApply({
      ok: false,
      wroteFiles: false,
      targetPath: "memory/periodic/2026/2026-W26.md",
    }),
    null,
  );
});

test("SuggestPopover labels write-kinds by helper, not impact heuristic", () => {
  const src = read("src/components/ai/SuggestPopover.tsx");
  assert.match(src, /suggestionApplyIsWrite/);
  assert.match(src, /suggestionOpenPath/);
  assert.match(src, /openItem/);
  assert.doesNotMatch(
    src,
    /isHigh \? t\("ai\.suggestConfirm"\) : t\("ai\.suggestOpen"\)/,
  );
});

test("ActionStore accept/nav uses apply evidence helper, not flat periodic template", () => {
  const src = read("src/stores/action-store.ts");
  assert.match(src, /suggestionNavPathAfterApply/);
  assert.match(src, /openItem/);
  assert.doesNotMatch(src, /targetPath:\s*`memory\/periodic\/\$\{period\}\.md`/);
  assert.doesNotMatch(src, /select\(\{\s*kind:\s*['"]file['"],\s*path:\s*`memory\/periodic\//);
});

test("zh-CN / en-US suggestion copy stays aligned and does not conflate 周期本 with digest write", () => {
  const zh = JSON.parse(read("src/locales/zh-CN/editor.json"));
  const en = JSON.parse(read("src/locales/en-US/editor.json"));
  for (const key of Object.keys(zh.ai)) {
    assert.ok(key in en.ai, `en-US missing ai.${key}`);
  }
  for (const key of Object.keys(en.ai)) {
    assert.ok(key in zh.ai, `zh-CN missing ai.${key}`);
  }
  assert.equal(zh.ai.suggestConfirm.includes("确认"), true);
  assert.equal(en.ai.suggestOpen, "Open");
  assert.match(zh.ai.suggestFooterHint, /周期本/);
  assert.match(en.ai.suggestFooterHint, /period note/i);
  assert.match(zh.ai.kindChipDigest, /周期反思/);
  assert.match(en.ai.kindChipDigest, /reflection/i);
  assert.doesNotMatch(JSON.stringify(zh.ai), /undefined/);
  assert.doesNotMatch(JSON.stringify(en.ai), /undefined/);
});
