/**
 * Stream AI cross-surface consistency — skills, Kernel, Desktop product language.
 * Drives shipped files on disk (no theater).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("router skill uses activity window + topic≠memory for organize path", () => {
  const skill = read("skills/topmind/SKILL.md");
  assert.match(skill, /活动窗口/u);
  assert.match(skill, /memory\/profile\.md/u);
  assert.match(skill, /memory\/periodic/u);
  assert.match(skill, /内容大类|\{大类\}/u);
  assert.doesNotMatch(skill, /整理本周\/理顺流水\s+→ topmind-organize\s+→ 当前周期本就地理顺/u);
});

test("organize skill activity-window narrative", () => {
  const skill = read("skills/topmind-organize/SKILL.md");
  assert.match(skill, /活动窗口/u);
  assert.match(skill, /勿写 memory\/topics|不进 memory\/topics|非 memory/u);
});

test("memory skill defaults profile+periodic; topics optional only", () => {
  const skill = read("skills/topmind-memory/SKILL.md");
  assert.match(skill, /主 memory|profile\.md/u);
  assert.match(skill, /周期子 memory|memory\/periodic/u);
  assert.match(skill, /非默认|不是\*\*默认/u);
  assert.match(skill, /内容大类/u);
});

test("ActionStore/ActionBar product language: 建议 not 个人清单混称", () => {
  const store = read("topmind-desktop/src/stores/action-store.ts");
  const bar = read("topmind-desktop/src/components/ai/ActionBar.tsx");
  assert.match(store, /建议/u);
  assert.match(store, /TodoStore|TodoPopover|个人清单/u);
  assert.doesNotMatch(store, /管理「待办」概念/u);
  assert.match(bar, /建议/u);
  assert.doesNotMatch(bar, /用户概念：「待办」/u);
});

test("Desktop DESIGN separates 个人清单 vs 建议 vs 后台", () => {
  const design = read("topmind-desktop/DESIGN.md");
  assert.match(design, /个人清单/u);
  assert.match(design, /SuggestPopover|建议确认面/u);
  assert.match(design, /runActivityOps|活动窗口/u);
  assert.match(design, /appendStreamEntry|增补/u);
  // AC3: must not collapse product layer back to 「待办」
  assert.doesNotMatch(design, /统一待办条/u);
  assert.doesNotMatch(design, /统一「待办」/u);
  assert.doesNotMatch(design, /· \*\*待办\*\*（ActionBar/u);
  assert.doesNotMatch(design, /概念收敛（3 层）[^\n]*\*\*待办\*\*（ActionBar/u);
  // SuggestPopover primary; ActionBar is compact pointer (not full expand list)
  assert.match(design, /### 3\.6 建议确认面（`SuggestPopover`/u);
  assert.match(design, /概念收敛（3 层）[^\n]*\*\*建议\*\*/u);
  assert.match(design, /compact ActionBar|compact 跳转|计数跳转/u);
  // Dual-truth guard: must not still document full expand/collapse ActionBar list UI
  assert.doesNotMatch(design, /### 3\.6 ActionBar（统一建议条）/u);
  assert.doesNotMatch(design, /ActionBar\*\*（统一\*\*建议条\*\*：建议 \+ 待确认写入；折叠默认，高优自动展开）/u);
});

test("Desktop ARCHITECTURE SuggestPopover primary; ActionBar not 统一待办", () => {
  const arch = read("topmind-desktop/ARCHITECTURE.md");
  assert.match(arch, /SuggestPopover/u);
  assert.match(arch, /openSuggestSurface|标题栏.*建议|compact ActionBar/u);
  assert.doesNotMatch(arch, /统一待办条/u);
  assert.doesNotMatch(arch, /ActionBar（统一待办）/u);
  assert.doesNotMatch(arch, /ActionStore` \| 统一待办/u);
  // Must not claim full list only lives in AiPanel ActionBar
  assert.doesNotMatch(arch, /\*\*建议 \/ 审阅不在主画布\*\*：`AiPanel` 的 `ActionBar`（统一建议条/u);
});

test("Stream quiet chip opens SuggestPopover path; no second suggestion list on canvas", () => {
  const view = read("topmind-desktop/src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  const area = read("topmind-desktop/src/components/shell/EditorArea.tsx");
  const strip = read("topmind-desktop/src/components/ai/SuggestEntryStrip.tsx");
  const surface = read("topmind-desktop/src/lib/suggest-surface.ts");
  // Global quiet entry (not Stream-local list)
  assert.match(area, /SuggestEntryStrip/u);
  assert.match(area, /SuggestPopover|openSuggestSurface/u);
  assert.match(strip, /data-stream-suggestions-quiet|data-suggest-entry-strip/u);
  assert.match(strip, /openSuggestSurface/u);
  assert.match(surface, /setPanelOpen\(true\)/u);
  assert.match(surface, /setExpanded\(true\)/u);
  // Stream must not mount full ActionBar or second list
  assert.doesNotMatch(view, /<ActionBar[\s/>]/u);
  assert.doesNotMatch(view, /<SuggestEntryStrip/u);
  assert.match(view, /streamMarkdownToPreviewHtml|stream-md-preview|data-stream-md-preview|v4-stream-md/u);
  assert.match(view, /openSuggestSurface/u);
});

test("TOOLS.md documents Kernel activity-window; no mandatory UTR Stream AI path", () => {
  const tools = read("TOOLS.md");
  assert.match(tools, /activity-window|activity window/u);
  assert.match(tools, /memory_organize|topic_classify|create_topic/u);
  assert.match(tools, /不强制 UTR|无\*\*平行|无平行/u);
});

test("shared activity-window is single product scope for suggest+todo+ops", () => {
  const suggest = read("lib/suggest-engine.mjs");
  const todo = read("lib/todo-engine.mjs");
  const ops = read("lib/ai-operation-engine.mjs");
  assert.match(suggest, /resolveActivityWindow/u);
  assert.match(todo, /resolveActivityWindow/u);
  assert.match(ops, /resolveActivityWindow/u);
  assert.ok(fs.existsSync(path.join(ROOT, "lib/activity-window.mjs")));
});
