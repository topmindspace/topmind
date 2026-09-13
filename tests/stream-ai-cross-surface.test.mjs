/**
 * Stream AI cross-surface consistency — skills, Kernel, Desktop product language.
 * Drives shipped files on disk (no theater).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  assert.match(skill, /update_core_memory|原位/u);
  assert.match(skill, /retire_core_memory|历史记录/u);
  assert.match(skill, /不是只追加/u);
});

test("Desktop prompts name retire/update not only append", () => {
  const prompts = read("topmind-desktop/electron/ai-prompts.mjs");
  assert.match(prompts, /retire_core_memory/);
  assert.match(prompts, /update_core_memory/);
  assert.match(prompts, /append_core_memory/);
  assert.match(prompts, /not append-only|不是只追加/u);
});

test("Skills pack stays Pi-independent and does not advertise bash", () => {
  const router = read("skills/topmind/SKILL.md");
  const write = read("skills/topmind-write/SKILL.md");
  assert.match(router, /不依赖.*[Pp]i|Pi-independent|不依赖.*pi-agent/u);
  assert.match(router, /不要编造 bash/u);
  assert.match(write, /edit_file|唯一片段/u);
  assert.doesNotMatch(router, /pi-coding-agent|createAgentSession|~\/\.pi/u);
  assert.doesNotMatch(write, /pi-coding-agent|pi-agent-core/u);
});

test("Desktop prompts name fenced Pi aliases and keep bash off", () => {
  const prompts = read("topmind-desktop/electron/ai-prompts.mjs");
  assert.match(prompts, /`read` \/ `write` \/ `edit` \/ `grep`/);
  assert.match(prompts, /read_file/);
  assert.match(prompts, /没有 `bash`|`bash` is not available/u);
});

test("stream listing computes needs-tidy from reconcile, not stamp absence", () => {
  const src = read("lib/model-stream.mjs");
  assert.match(src, /periodNoteNeedsTidy/);
  assert.doesNotMatch(src, /reconciled = \/\^reconciled_at/u);
});

test("Obsidian chat guide names unique-span edit_file and no bash", () => {
  const ops = read("obsidian-plugin/src/services/kernel-workspace-ops.ts");
  assert.match(ops, /edit_file is unique-span|唯一片段/u);
  assert.match(ops, /No bash or shell|没有 bash/u);
});

test("Obsidian chat injects active profile, not a raw history dump", () => {
  const svc = read("obsidian-plugin/src/services/kernel-service.ts");
  const ops = read("obsidian-plugin/src/services/kernel-workspace-ops.ts");
  assert.match(ops, /loadChatProfileContext/);
  assert.match(ops, /readProfileActiveBody/);
  assert.match(svc, /loadChatProfileContext/);
  assert.doesNotMatch(svc, /profile\.slice\(0,\s*3000\)/);
  assert.match(ops, /retire_core_memory/);
  assert.match(ops, /update_core_memory/);
});

test("ActionStore product language: 建议 not 个人清单混称", () => {
  const store = read("topmind-desktop/src/stores/action-store.ts");
  assert.match(store, /建议/u);
  assert.match(store, /TodoStore|TodoPopover|个人清单/u);
  assert.doesNotMatch(store, /管理「待办」概念/u);
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
  assert.match(design, /### 3\.6 建议确认面（`SuggestPopover`/u);
  assert.match(design, /概念收敛（3 层）[^\n]*\*\*建议\*\*/u);
  assert.match(design, /浮动 `SuggestPopover`/u);
  // Dual-truth guard: must not still document full expand/collapse ActionBar list UI
  assert.doesNotMatch(design, /### 3\.6 ActionBar（统一建议条）/u);
  assert.doesNotMatch(design, /ActionBar\*\*（统一\*\*建议条\*\*：建议 \+ 待确认写入；折叠默认，高优自动展开）/u);
});

test("Desktop ARCHITECTURE SuggestPopover primary; ActionBar not 统一待办", () => {
  const arch = read("topmind-desktop/ARCHITECTURE.md");
  assert.match(arch, /SuggestPopover/u);
  assert.match(arch, /openSuggestSurface|状态栏.*建议|SuggestPopover/u);
  assert.doesNotMatch(arch, /统一待办条/u);
  assert.doesNotMatch(arch, /ActionBar（统一待办）/u);
  assert.doesNotMatch(arch, /ActionStore` \| 统一待办/u);
  // Must not claim full list only lives in AiPanel ActionBar
  assert.doesNotMatch(arch, /\*\*建议 \/ 审阅不在主画布\*\*：`AiPanel` 的 `ActionBar`（统一建议条/u);
});

test("StatusBar suggestion chip opens SuggestPopover path; no second suggestion list on canvas", () => {
  const view = read("topmind-desktop/src/plugins/topmind-workspace/views/StreamDetailView.tsx");
  const area = read("topmind-desktop/src/components/shell/EditorArea.tsx");
  const status = read("topmind-desktop/src/components/shell/StatusBar.tsx");
  const surface = read("topmind-desktop/src/lib/suggest-surface.ts");
  // SuggestEntryStrip removed from canvas; count unified in StatusBar
  assert.doesNotMatch(area, /SuggestEntryStrip/u);
  // StatusBar carries the suggestion count chip + opens SuggestPopover
  assert.match(status, /data-status-suggest-count|data-status-suggest-busy/u);
  assert.match(status, /toggleSuggestSurface|openSuggestSurface/u);
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

test("living DESIGN/ARCHITECTURE do not claim stale step budget 12 or 3-24", () => {
  const desktopDesign = read("topmind-desktop/DESIGN.md");
  const desktopArch = read("topmind-desktop/ARCHITECTURE.md");
  assert.match(desktopDesign, /默认 \*\*20\*\*|默认 20/u);
  assert.match(desktopArch, /默认 \*\*20\*\*/u);
  assert.match(desktopArch, /3–50|3-50/u);
  assert.doesNotMatch(desktopDesign, /maxAgentSteps`（默认 12）/u);
  assert.doesNotMatch(desktopArch, /默认 \*\*12\*\*/u);
  assert.doesNotMatch(desktopArch, /可配 3–24/u);
});

test("Desktop and Obsidian share Kernel unique-span edit + thinking split", async () => {
  const { applyUniqueSpan, splitAssistantVisible } = await import(
    pathToFileURL(path.join(ROOT, "lib/kernel-api.mjs")).href
  );

  const hay = "head\nUNIQUE mid paragraph\n\ntail\n";
  const applied = applyUniqueSpan(hay, {
    oldText: "UNIQUE mid paragraph\r\n",
    newText: "UNIQUE mid rewritten\n",
  });
  assert.equal(applied.ok, true);
  assert.match(applied.next, /UNIQUE mid rewritten/);
  assert.match(applied.next, /^head\n/);
  assert.match(applied.next, /tail/);

  const miss = applyUniqueSpan(hay, { oldText: "no such span", newText: "x" });
  assert.equal(miss.ok, false);
  assert.match(miss.diagnostic, /nearby\/context/u);

  const raw = "<think>plan</think>\n\n## Answer\nShip it.";
  const k = splitAssistantVisible(raw);
  assert.doesNotMatch(k.body, /plan|<think>/);
  assert.match(k.body, /Ship it/);
  assert.match(k.reasoning, /plan/);

  const desktopOps = read("topmind-desktop/electron/lib/workspace-path-ops.mjs");
  const obsOps = read("obsidian-plugin/src/services/kernel-workspace-ops.ts");
  const desktopStream = read("topmind-desktop/electron/ai-stream.mjs");
  const desktopSplitSrc = read("topmind-desktop/src/lib/ai-chat-split.ts");
  const obsChat = read("obsidian-plugin/src/services/kernel-service.ts");
  assert.match(desktopOps, /applyUniqueSpan/);
  assert.match(obsOps, /applyUniqueSpan/);
  assert.match(obsOps, /preciseEditWorkspace/);
  assert.match(desktopStream, /splitAssistantVisible|ingestAssistantTextDelta/);
  assert.match(desktopSplitSrc, /export function splitAssistantVisible/);
  assert.match(obsChat, /runWorkspaceChatTurn|splitAssistantVisible/);
  assert.match(read("obsidian-plugin/src/views/sidebar-dock-view.ts"), /tm-chat-reasoning|chat_reasoning/);
});
