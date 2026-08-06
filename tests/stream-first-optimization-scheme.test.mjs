/**
 * Structural guard for the stream-first optimization analysis deliverable.
 * Proves the shipped doc exists and maps 1:1 to plan acceptance criteria.
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
  assert.ok(st.size > 5000, `doc too small (${st.size} bytes)`);
});

test("scheme doc sections map to acceptance criteria 1–5", () => {
  const text = fs.readFileSync(DOC, "utf8");

  // Shipped truth section (Wave S* complete)
  assert.match(text, /现行产品真理|Wave S/u);
  assert.match(text, /activity-window|活动窗口/u);

  // Criterion 1 — ideal usage model
  assert.match(text, /## 1\.\s*Ideal usage model/u);
  assert.match(text, /个人版 Twitter|个人 Twitter|activity_window|Activity Window/u);
  assert.match(text, /记 → 动态 feed → 在动态上增补/u);

  // Criterion 2 — gap map with dispositions (may be marked historical after ship)
  assert.match(text, /## 2\.\s*(Current vs ideal gap map|Gap map)/u);
  assert.match(text, /keep|harden|redesign/iu);
  assert.match(text, /Deprecate|do-not-carry|废弃/u);
  // Concrete codebase citations
  assert.match(text, /findLatestPeriodNote/u);
  assert.match(text, /StreamDetailView/u);
  assert.match(text, /ActionBar/u);
  assert.match(text, /todo_maintain/u);
  assert.match(text, /memory_organize/u);
  assert.match(text, /writeback-engine/u);
  assert.match(text, /topmind-organize/u);

  // Criterion 3 — phased scheme (now shipped; section may say 已实施)
  assert.match(text, /## 3\.\s*Overall optimization scheme/u);
  assert.match(text, /Wave S0|Wave S1|Wave S2|S1 activity|S2|S3/u);
  assert.match(text, /已实施|已合闸|Shipped|Done/u);

  // Criterion 4 — cross-surface rules
  assert.match(text, /## 4\.\s*Cross-surface consistency rules/u);
  assert.match(text, /Skills/u);
  assert.match(text, /Desktop/u);
  assert.match(text, /UTR/u);

  // Criterion 5 — open questions (answered; Q1–Q5 still named)
  assert.match(text, /## 5\.\s*Open design questions/u);
  assert.match(text, /Q1/u);
  assert.match(text, /Q2/u);
  assert.match(text, /\*\*A\*\*|A 修正|推荐 A/u);
});

test("scheme includes explicit deprecate / do-not-carry list", () => {
  const text = fs.readFileSync(DOC, "utf8");
  assert.match(text, /Deprecate \/ do-not-carry|废弃 \/ 不携带/u);
  assert.match(text, /D1/u);
  // Must not invent second north star against Reset locks
  assert.match(text, /Reset A\/B\/C\/D|A\/B\/C\/D/u);
  assert.match(text, /writeback|写闸/u);
  assert.match(text, /≤5|用户概念/u);
});

test("scheme cites live engine paths present in repo", () => {
  const text = fs.readFileSync(DOC, "utf8");
  const mustExist = [
    "lib/suggest-engine.mjs",
    "lib/todo-engine.mjs",
    "lib/ai-operation-engine.mjs",
    "lib/stream-period.mjs",
    "lib/writeback-engine.mjs",
    "lib/activity-window.mjs",
  ];
  for (const rel of mustExist) {
    assert.match(text, new RegExp(rel.replace(/\./g, "\\.")));
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `cited path missing on disk: ${rel}`);
  }
  // Live behavior: activity window exists; memory/topic ops enabled (profile+periodic / content categories)
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

test("scheme doc has no dual-truth: §6/§7 claim shipped not analysis-only", () => {
  const text = fs.readFileSync(DOC, "utf8");
  // Living §6 header must be 已合闸, not 本文件不实施
  assert.doesNotMatch(text, /## 6\.[^\n]*本文件不实施/u);
  assert.match(text, /## 6\.\s*实施状态（\*\*已合闸\*\*/u);
  assert.match(text, /## 7\.[^\n]*(现行|Shipped)/u);
  // §7 evidence table must describe append + enabled ops
  assert.match(text, /条目增补|appendStreamEntry|appendToStreamEntry/u);
  assert.match(text, /memory_organize|topic_classify/u);
  assert.match(text, /均启用|启用/u);
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
