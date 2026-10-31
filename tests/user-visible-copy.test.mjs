/**
 * User-visible Desktop locale, Obsidian i18n, and kernel strings the UI renders.
 * Suggestion cards and task logs show the summary returned by the shipped
 * generators. Architecture docs are checked only where they are the lock agents read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSuggestions } from "../lib/suggest-engine.mjs";
import { runOperation } from "../lib/ai-operation-engine.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { resolveObsidianRoot, SKIP_OBSIDIAN } = await import("./helpers/sister-repos.mjs");

const WORKFLOW = /收进来\s*(?:->|→)\s*继续做\s*(?:->|→)\s*交付\s*[\/／]\s*沉淀\s*(?:->|→)\s*找回\s*[\/／]\s*调整/gu;
const MANUAL_TODO_ZH = "关掉后只在两处手动整理：侧栏切到动态且本周期有条目时的 ✨，以及 ⌘⇧T 打开的清单里的 ✨。";
const MANUAL_TODO_EN = "When off, maintain it only in two places: the ✨ on the sidebar stream when this period has entries, and the ✨ in the list opened with ⌘⇧T.";

function read(rel) {
  return readFileSync(path.isAbsolute(rel) ? rel : path.join(root, rel), "utf8");
}

function walkStrings(value, out) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkStrings(item, out);
  }
}

function localeJsonStrings(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    walkStrings(JSON.parse(read(path.join(dir, name))), out);
  }
  return out;
}

function localeTsStrings(file) {
  const source = read(file);
  const out = [];
  const re = /:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`)/g;
  for (const match of source.matchAll(re)) out.push(match[1] ?? match[2] ?? match[3]);
  return out;
}

function violations(strings) {
  const found = [];
  for (const value of strings) {
    const rest = value.replace(WORKFLOW, "");
    if (rest.includes("沉淀")) found.push(`沉淀 outside the workflow sentence: ${value}`);
    if (/锁定[^。\n]{0,24}不能覆盖|AI 不能覆盖|protection:\s*locked|list-safety-receipts/u.test(value)) {
      found.push(`locked-note or UTR recovery teaching: ${value}`);
    }
    const withoutInstallPath = value.replaceAll("topmind-engine", "");
    if (withoutInstallPath.includes("引擎") || /\bengine\b/i.test(withoutInstallPath)) {
      found.push(`teaches 引擎/engine: ${value}`);
    }
  }
  return found;
}

test("Desktop locales keep the stream name, workflow 沉淀 exception, and hide engine jargon", () => {
  const zh = JSON.parse(read("topmind-desktop/src/locales/zh-CN/shell.json"));
  const en = JSON.parse(read("topmind-desktop/src/locales/en-US/shell.json"));
  assert.equal(zh.primaryNav.stream, "动态");
  assert.equal(en.primaryNav.stream, "Stream");
  assert.equal(zh.statusBar.enginePath, "程序位置: {{root}}");
  assert.equal(en.statusBar.enginePath, "App path: {{root}}");
  assert.equal(zh.statusBar.engineUnavailableTip, undefined);
  assert.equal(en.statusBar.engineUnavailableTip, undefined);

  const activity = read("topmind-desktop/src/components/shell/ActivityBar.tsx");
  assert.match(activity, /labelKey:\s*"primaryNav\.stream"/);
  assert.doesNotMatch(activity, /labelKey:\s*"primaryNav\.(?:workspace|home)"/);

  const zhSettings = JSON.parse(read("topmind-desktop/src/locales/zh-CN/settings.json"));
  const enSettings = JSON.parse(read("topmind-desktop/src/locales/en-US/settings.json"));
  assert.ok(zhSettings.general.autoMaintainTodosDesc.includes(MANUAL_TODO_ZH));
  assert.ok(enSettings.general.autoMaintainTodosDesc.includes(MANUAL_TODO_EN));
  assert.ok(read("DESIGN.md").includes(MANUAL_TODO_ZH));
  assert.ok(read("topmind-desktop/DESIGN.md").includes(MANUAL_TODO_ZH));

  const streamView = read("topmind-desktop/src/components/sidebar/StreamView.tsx");
  assert.match(streamView, /handleMaintainTodos/);
  assert.match(streamView, /sidebar\.stream\.maintainTodos/);
  assert.match(streamView, /entries\.length === 0/);

  const strings = [
    ...localeJsonStrings(path.join(root, "topmind-desktop/src/locales/zh-CN")),
    ...localeJsonStrings(path.join(root, "topmind-desktop/src/locales/en-US")),
  ];
  assert.deepEqual(violations(strings), []);
});

test("rendered suggestion card and memory task summary do not teach 沉淀", async () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "topmind-copy-"));
  try {
    writeFileSync(
      path.join(ws, "topmind.yaml"),
      `version: 4
categories:
  - directory: 10-动态
    role: loose-stream
stream:
  packing: weekly
`,
      "utf8",
    );
    mkdirSync(path.join(ws, "10-动态"), { recursive: true });
    writeFileSync(
      path.join(ws, "10-动态", "2026-W31.md"),
      `# 2026-W31\n\n## 记录\n\n- 本周在动态里记下一条足够长的笔记，用来打开没有 AI 时的建议卡。\n- 另一条也写下，保证活动窗口不是空的，整理时可以诚实返回没有候选。\n`,
      "utf8",
    );

    const zhCards = await generateSuggestions({
      workspaceRoot: ws,
      engineRoot: root,
      localeOverride: "zh-CN",
    });
    const hint = zhCards.find((item) => item.id === "promote-open-hint");
    assert.ok(hint, "no-AI stream should return the open-profile hint");
    assert.equal(hint.kind, "open_profile");
    assert.match(hint.summary, /动态/);
    assert.match(hint.summary, /我的情况/);
    assert.match(hint.summary, /记下/);
    assert.deepEqual(violations([hint.summary]), []);

    const enCards = await generateSuggestions({
      workspaceRoot: ws,
      engineRoot: root,
      localeOverride: "en",
    });
    const enHint = enCards.find((item) => item.id === "promote-open-hint");
    assert.ok(enHint, "English UI should get the same hint card");
    assert.match(enHint.summary, /profile/i);
    assert.deepEqual(violations([enHint.summary]), []);

    const aiProvider = {
      async generate() {
        return JSON.stringify({ profile: [], periodic: "", retire: [], update: [] });
      },
    };
    const zhOp = await runOperation({
      id: "memory_organize",
      workspaceRoot: ws,
      engineRoot: root,
      aiProvider,
      options: { force: true, localeOverride: "zh-CN" },
    });
    assert.equal(zhOp.ok, true);
    assert.equal(zhOp.reason, "no-changes");
    assert.equal(zhOp.suggestions.length, 0);
    assert.match(zhOp.summary, /写入/);
    assert.deepEqual(violations([zhOp.summary]), []);

    const enOp = await runOperation({
      id: "memory_organize",
      workspaceRoot: ws,
      engineRoot: root,
      aiProvider,
      options: { force: true, localeOverride: "en" },
    });
    assert.equal(enOp.ok, true);
    assert.equal(enOp.suggestions.length, 0);
    assert.match(enOp.summary, /memory/i);
    assert.deepEqual(violations([enOp.summary]), []);

    // pack:prepare writes this snapshot. Root CI runs before that step, so a
    // missing directory is not a product failure; when the snapshot exists it
    // must still carry the same rendered summaries.
    const packagedSuggestPath = "topmind-desktop/resources/topmind-engine/lib/suggest-engine.mjs";
    const packagedOpsPath = "topmind-desktop/resources/topmind-engine/lib/ai-operation-engine.mjs";
    if (existsSync(path.join(root, packagedSuggestPath)) && existsSync(path.join(root, packagedOpsPath))) {
      const packagedSuggest = read(packagedSuggestPath);
      const packagedOps = read(packagedOpsPath);
      assert.ok(packagedSuggest.includes(hint.summary), "packaged Desktop engine must ship the same hint summary");
      assert.ok(packagedOps.includes(zhOp.summary), "packaged Desktop engine must ship the same task summary");
    }

    const popover = read("topmind-desktop/src/components/ai/SuggestPopover.tsx");
    const strip = read("topmind-desktop/src/components/workspace/ProactiveSuggestStrip.tsx");
    const taskStore = read("topmind-desktop/src/stores/task-store.ts");
    const actionStore = read("topmind-desktop/src/stores/action-store.ts");
    assert.match(popover, /\{item\.summary\}/);
    assert.match(strip, /description=\{item\.summary\}/);
    assert.match(actionStore, /summary:\s*s\.summary/);
    assert.match(taskStore, /_appendLog\(taskId,\s*opResult\.summary\)/);
    assert.match(taskStore, /summary:\s*opResult\.summary/);

    if (!SKIP_OBSIDIAN) {
      const obsidian = resolveObsidianRoot();
      const shippedSuggest = read(path.join(obsidian, "lib/suggest-engine.mjs"));
      const shippedOps = read(path.join(obsidian, "lib/ai-operation-engine.mjs"));
      assert.ok(shippedSuggest.includes(hint.summary), "Obsidian snapshot must ship the same hint summary");
      assert.ok(shippedOps.includes(zhOp.summary), "Obsidian snapshot must ship the same task summary");
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("status-bar spec and architecture lock match the rendered copy", () => {
  const design = read("topmind-desktop/DESIGN.md");
  assert.match(design, /tooltip 含程序位置（安装里的引擎根/);
  assert.match(design, /tooltip 含程序位置）；异常才出错误文字/);
  assert.doesNotMatch(design, /tooltip 含 engine/);

  const reset = read("docs/ARCHITECTURE-RESET.md");
  assert.match(reset, /你确认后再写入/);
  assert.match(reset, /是否写入/);
  assert.match(reset, /UI \*\*不教\*\*：沉淀、/);
  const rest = reset.replace(WORKFLOW, "").replace(/UI \*\*不教\*\*：沉淀、/u, "UI **不教**：");
  assert.equal(rest.includes("沉淀"), false, rest.match(/沉淀.{0,40}|.{0,40}沉淀/u)?.[0] || "沉淀");
});

test("Obsidian i18n does not teach 沉淀, locked-file bans, or 引擎", (t) => {
  if (SKIP_OBSIDIAN) {
    t.skip(SKIP_OBSIDIAN);
    return;
  }
  const obsidian = resolveObsidianRoot();
  const strings = [
    ...localeTsStrings(path.join(obsidian, "src/i18n/locales/zh-CN.ts")),
    ...localeTsStrings(path.join(obsidian, "src/i18n/locales/en-US.ts")),
  ];
  assert.ok(strings.length > 20, "locale modules did not yield user-visible strings");
  const zh = read(path.join(obsidian, "src/i18n/locales/zh-CN.ts"));
  assert.match(zh, /stream_workbench_title:\s*"动态"/);
  assert.deepEqual(violations(strings), []);
});
