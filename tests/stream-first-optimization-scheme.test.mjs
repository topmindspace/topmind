/**
 * Structural guard for the stream-first optimization scheme deliverable.
 * Proves the shipped doc exists and maps to live implementation evidence.
 *
 * The doc was simplified (2026-08): historical analysis snapshots (old §2–§5)
 * were removed; the doc now contains §0 (current truth), §1 (ideal model),
 * §2 (shipped implementation record). Tests align with the simplified structure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = path.join(ROOT, "docs", "stream-first-optimization-scheme.md");

test("stream-first optimization scheme doc exists", () => {
  assert.ok(fs.existsSync(DOC), `missing ${DOC}`);
  const st = fs.statSync(DOC);
  assert.ok(st.size > 3000, `doc too small (${st.size} bytes)`);
});

test("scheme doc has shipped truth + ideal model + implementation record", () => {
  const text = fs.readFileSync(DOC, "utf8");

  // Shipped status header
  assert.match(text, /已合闸.*Shipped/u);
  assert.match(text, /现行产品真理/u);

  // §0 — Current product truth table
  assert.match(text, /## 0\.\s*现行产品真理/u);
  assert.match(text, /活动窗口/u);
  assert.match(text, /memory_organize/u);
  assert.match(text, /topic_classify/u);
  assert.match(text, /profile \+ periodic/u);
  assert.match(text, /内容大类.*create_topic/u);

  // §1 — Ideal usage model
  assert.match(text, /## 1\.\s*理想使用模型/u);
  assert.match(text, /activity_window|Activity Window/u);
  assert.match(text, /记 → 动态 feed → 在动态上增补/u);
  assert.match(text, /AI 职责边界/u);

  // §2 — Shipped implementation record
  assert.match(text, /## 2\.\s*合闸实施记录/u);
  assert.match(text, /Done|已合闸|Shipped/u);
});

test("scheme cites live engine paths present in repo", () => {
  const text = fs.readFileSync(DOC, "utf8");
  const mustExist = [
    "lib/suggest-engine.mjs",
    "lib/todo-engine.mjs",
    "lib/ai-operation-engine.mjs",
    "lib/writeback-engine.mjs",
    "lib/activity-window.mjs",
  ];
  for (const rel of mustExist) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `cited path missing on disk: ${rel}`);
  }
  // Doc must reference activity window + ops
  assert.match(text, /activity-window|活动窗口/u);
  assert.match(text, /suggest.*todo.*ai-ops/u);
  // Live behavior: activity window exists; memory/topic ops enabled
  const suggest = fs.readFileSync(path.join(ROOT, "lib/suggest-engine.mjs"), "utf8");
  assert.match(suggest, /loadActivityContext|resolveActivityWindow/u);
  assert.ok(fs.existsSync(path.join(ROOT, "lib/activity-window.mjs")));
  const activity = fs.readFileSync(path.join(ROOT, "lib/activity-window.mjs"), "utf8");
  assert.match(activity, /export function resolveActivityWindow/u);
  assert.match(activity, /export function appendToStreamEntry/u);
  const aiOps = fs.readFileSync(path.join(ROOT, "lib/ai-operation-engine.mjs"), "utf8");
  assert.match(aiOps, /id:\s*"todo_maintain"/u);
  assert.match(aiOps, /id:\s*"memory_organize"/u);
  assert.match(aiOps, /id:\s*"topic_classify"/u);
  // Enabled (not disabled placeholders) — topic goes to content categories, not memory plane
  assert.match(aiOps, /memoryOrganizeDesc:.*我的情况/u);
  assert.match(aiOps, /不进 memory/u);
});

test("scheme doc shipped evidence includes append + enabled ops", () => {
  const text = fs.readFileSync(DOC, "utf8");
  // §2 evidence table must describe append + enabled ops
  assert.match(text, /条目增补|appendStreamEntry|appendToStreamEntry/u);
  assert.match(text, /memory_organize|topic_classify/u);
  // Writeback gate mentioned
  assert.match(text, /writeback|写闸/u);
  // docs/README index must not say 待实施 for this file
  const idx = fs.readFileSync(path.join(ROOT, "docs", "README.md"), "utf8");
  assert.match(idx, /stream-first-optimization-scheme/u);
  assert.doesNotMatch(idx, /stream-first-optimization-scheme\.md[^\n]{0,80}待实施/u);
  assert.match(idx, /Done\/Shipped|Shipped|合闸/u);
});

test("root README honesty tables match enabled AI ops (no disabled-placeholder dual truth)", () => {
  const zh = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const en = fs.readFileSync(path.join(ROOT, "README.en.md"), "utf8");
  // Must not claim organize/classify still disabled partials
  assert.doesNotMatch(zh, /部分 AI 操作占位.*Intentional Partial/u);
  assert.doesNotMatch(zh, /organize \/ classify[^\n]*disabled/iu);
  assert.doesNotMatch(en, /Some AI ops still placeholders/u);
  assert.doesNotMatch(en, /organize \/ classify[^\n]*disabled/iu);
  // Positive: Done + profile/periodic / content-category topic
  assert.match(zh, /记忆整理|memory_organize|profile\+periodic|profile \+ periodic/u);
  assert.match(zh, /\*\*Done\*\*/u);
  assert.match(en, /memory organize|profile\+periodic|profile \+ periodic/u);
  assert.match(en, /\*\*Done\*\*/u);
  // Shipped code still has ops enabled
  const aiOps = fs.readFileSync(path.join(ROOT, "lib/ai-operation-engine.mjs"), "utf8");
  const memBlock = aiOps.slice(aiOps.indexOf('id: "memory_organize"'), aiOps.indexOf('id: "memory_organize"') + 400);
  const topicBlock = aiOps.slice(aiOps.indexOf('id: "topic_classify"'), aiOps.indexOf('id: "topic_classify"') + 400);
  assert.match(memBlock, /disabled:\s*false/u);
  assert.match(topicBlock, /disabled:\s*false/u);
});
