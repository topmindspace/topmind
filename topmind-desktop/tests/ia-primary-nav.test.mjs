/**
 * Desktop primary IA — living source must default to 动态 / stream, not 工作台 triad.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("Desktop primary IA target", () => {
  it("TitleBar PrimaryNav selects stream and labels via primaryNav.stream", () => {
    const src = read("src/components/shell/TitleBar.tsx");
    assert.match(src, /key:\s*"stream"/);
    assert.match(src, /select\(\{\s*kind:\s*"stream"\s*\}\)/);
    assert.match(src, /primaryNav\.stream/);
    // Stream identity = Radio (not Home chrome icon)
    assert.match(src, /icon:\s*Radio/);
    assert.doesNotMatch(src, /icon:\s*Home/);
    assert.doesNotMatch(src, /三个主锚点：`工作台`/);
    // Legacy 工作台 as living unlabeled target is forbidden
    assert.doesNotMatch(src, /Primary nav — 3 main anchors \(工作台/);
  });

  it("ViewSwitcher keeps tags/kanban behind advanced more menu", () => {
    const src = read("src/components/sidebar/ViewSwitcher.tsx");
    assert.match(src, /PRIMARY_MODES/);
    assert.match(src, /ADVANCED_MODES/);
    assert.match(src, /moreLabel/);
    assert.match(src, /"tags"/);
    assert.match(src, /"kanban"/);
  });

  it("settings expose autoPrepareSuggestions and ActionStore respects it", () => {
    // Defaults live in pure settings-core; persistence shell re-exports createDefault
    const settingsCore = read("electron/lib/settings-core.mjs");
    assert.match(settingsCore, /autoPrepareSuggestions:\s*true/);
    // Token-costly todo maintain defaults OFF (opt-in)
    assert.match(settingsCore, /autoMaintainTodos:\s*false/);
    const settingsShell = read("electron/settings.mjs");
    assert.match(settingsShell, /settings-core\.mjs/);
    assert.match(settingsShell, /createDefaultAppSettings/);
    const panel = read("src/components/settings/GeneralPanel.tsx");
    assert.match(panel, /autoPrepareSuggestions/);
    assert.match(panel, /autoMaintainTodos/);
    // ActionBar + ActionStore replace SuggestionStrip; autoPrepare gate lives in action-store
    const actionStore = read("src/stores/action-store.ts");
    const actionBar = read("src/components/ai/ActionBar.tsx");
    assert.match(actionStore, /autoPrepareSuggestions/);
    assert.match(actionStore, /autoPrepare/);
    assert.match(actionBar, /autoPrepare/);
    assert.match(actionBar, /return null/);
    // Shell wires opt-in autoMaintainTodos once per session
    const shell = read("src/components/shell/useAutoTodoMaintain.ts");
    assert.match(shell, /autoMaintainTodos/);
    assert.match(shell, /autoTodoArmed/);
  });

  it("view-store default selection is stream", () => {
    const src = read("src/stores/view-store.ts");
    assert.match(src, /selection:\s*\{\s*kind:\s*"stream"\s*\}/);
    assert.match(src, /history:\s*\[\s*\{\s*kind:\s*"stream"\s*\}\s*\]/);
  });

  it("locale primary labels are 动态 / Stream and 写出来", () => {
    const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
    const en = JSON.parse(read("src/locales/en-US/shell.json"));
    assert.equal(zh.primaryNav.stream, "动态");
    assert.equal(zh.primaryNav.outputs, "写出来");
    assert.ok(en.primaryNav.stream);
    assert.match(en.primaryNav.stream, /Stream/i);
  });

  it("path ops durable writes go through kernelDurableWrite", () => {
    const src = read("electron/lib/workspace-path-ops.mjs");
    assert.match(src, /kernelDurableWrite/);
    assert.match(src, /kernelDurableDelete/);
    assert.match(src, /from "\.\/kernel-api\.mjs"/);
    assert.match(src, /async saveNote/);
    assert.match(src, /async appendTopicMemory/);
    assert.match(src, /async appendCoreMemory/);
    assert.match(src, /async reconcileStreamPeriod/);
    // saveNote / memory / reconcile must not use raw writeText for durable body
    const saveNoteBlock = src.slice(src.indexOf("async saveNote"), src.indexOf("async createTopic"));
    assert.doesNotMatch(saveNoteBlock, /await writeText\(/);
    const appendCore = src.slice(src.indexOf("async appendCoreMemory"), src.indexOf("async reconcileStreamPeriod"));
    assert.doesNotMatch(appendCore, /await writeText\(/);
  });

  it("inbox capture durable writes go through kernelDurableWrite", () => {
    const src = read("electron/lib/workspace-inbox-ops.mjs");
    assert.match(src, /kernelDurableWrite/);
    assert.match(src, /from "\.\/kernel-api\.mjs"/);
  });

  it("navigation has no living home selection product", () => {
    const editor = read("src/components/shell/EditorArea.tsx");
    assert.match(editor, /select\(\{\s*kind:\s*"stream"\s*\}\)/);
    assert.doesNotMatch(editor, /select\(\{\s*kind:\s*"home"\s*\}\)/);
    const actions = read("src/plugins/topmind-workspace/actions.ts");
    assert.match(actions, /goto\.stream[\s\S]{0,120}kind:\s*"stream"/);
    assert.doesNotMatch(actions, /goto\.home/);
    const views = read("src/plugins/topmind-workspace/views.tsx");
    assert.doesNotMatch(views, /sel\.kind === "home"/);
    assert.match(views, /StreamDetailView/);
    const types = read("src/types.ts");
    assert.doesNotMatch(types, /\| \{ kind: ['"]home['"] \}/);
    assert.match(types, /normalizeSelection/);
  });

  it("connectors write note bodies via connector-bridge writeConnectorNote (kernel write gate)", () => {
    const weread = read("electron/weread-service.mjs");
    const x = read("electron/x-service.mjs");
    const bridge = read("electron/lib/connector-bridge.mjs");
    assert.match(weread, /writeConnectorNote/);
    assert.match(x, /writeConnectorNote/);
    assert.match(bridge, /kernelDurableWriteAbs/);
  });

  it("HomeView component file is deleted; no home view slot", () => {
    const homePath = path.join(root, "src/plugins/topmind-workspace/views/HomeView.tsx");
    assert.equal(fs.existsSync(homePath), false, "HomeView.tsx must not exist");
    const views = read("src/plugins/topmind-workspace/views.tsx");
    assert.doesNotMatch(views, /HomeView/);
    assert.doesNotMatch(views, /topmind-workspace\.view\.home|sel\.kind === "home"/);
  });

  it("shortcut and command labels do not teach living 工作台 home", () => {
    const zhCommon = JSON.parse(read("src/locales/zh-CN/common.json"));
    const enCommon = JSON.parse(read("src/locales/en-US/common.json"));
    assert.match(zhCommon.shortcut.home, /动态/);
    assert.doesNotMatch(zhCommon.shortcut.home, /工作台/);
    assert.match(enCommon.shortcut.home, /Stream/i);
    assert.doesNotMatch(enCommon.shortcut.home, /workspace/i);
    const actions = read("src/plugins/topmind-workspace/actions.ts");
    assert.match(actions, /Go to · Stream/);
    assert.doesNotMatch(actions, /Go to · Workspace/);
    assert.doesNotMatch(actions, /goto\.home/);
  });

  it("confirm save settings copy is Model B (pending strip), not paste-draft", () => {
    const zhSettings = JSON.parse(read("src/locales/zh-CN/settings.json"));
    const enSettings = JSON.parse(read("src/locales/en-US/settings.json"));
    const zhEditor = JSON.parse(read("src/locales/zh-CN/editor.json"));
    const enEditor = JSON.parse(read("src/locales/en-US/editor.json"));
    for (const s of [
      zhSettings.general.writebackHelpConfirm,
      enSettings.general.writebackHelpConfirm,
      zhEditor.ai.writebackConfirmHint,
      enEditor.ai.writebackConfirmHint,
    ]) {
      assert.match(s, /待确认|accept\/reject|pending/i);
      assert.doesNotMatch(s, /可粘贴草稿|只出草稿|drafts only for you to paste|只给草稿/u);
    }
  });

  it("AiPanel mounts ActionBar for suggestions and pending writes", () => {
    const src = read("src/components/ai/AiPanel.tsx");
    assert.match(src, /from "\.\/ActionBar"/);
    assert.match(src, /<ActionBar\s*\/>/);
    const actionBody = read("src/components/ai/ActionBar.tsx");
    const storeBody = read("src/stores/action-store.ts");
    assert.match(storeBody, /generateSuggestions|api\.ws\.generateSuggestions/);
    assert.match(actionBody, /useTranslation\("editor"\)/);
    const zh = JSON.parse(read("src/locales/zh-CN/editor.json"));
    const en = JSON.parse(read("src/locales/en-US/editor.json"));
    for (const key of [
      "pendingWrote",
      "suggestTitle",
      "suggestEmpty",
      "suggestLoading",
      "suggestRefresh",
      "suggestConfirm",
      "suggestOpen",
      "suggestIgnore",
      "suggestNeedsConfirm",
      "suggestApplied",
    ]) {
      assert.equal(typeof zh.ai[key], "string", `zh ai.${key}`);
      assert.equal(typeof en.ai[key], "string", `en ai.${key}`);
      assert.ok(zh.ai[key].length > 0);
      assert.ok(en.ai[key].length > 0);
    }
    // en strip titles must not be Chinese
    assert.doesNotMatch(en.ai.pendingTitle, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(en.ai.suggestTitle, /[\u4e00-\u9fff]/);
  });

  it("ArchiveView empty CTA uses archiveView.goStream keys (not deleted home.title)", () => {
    const src = read("src/plugins/topmind-workspace/views/ArchiveView.tsx");
    assert.match(src, /archiveView\.goStream/);
    assert.doesNotMatch(src, /workspace:home\.title|home\.title/);
    const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
    const en = JSON.parse(read("src/locales/en-US/workspace.json"));
    assert.equal(typeof zh.archiveView.goStream, "string");
    assert.equal(typeof zh.archiveView.goStreamTip, "string");
    assert.equal(typeof en.archiveView.goStream, "string");
    assert.equal(typeof en.archiveView.goStreamTip, "string");
    assert.match(zh.archiveView.goStream, /动态/);
    assert.match(en.archiveView.goStream, /Stream/i);
    // dead Home dashboard residue must not remain as living product chrome
    assert.equal(zh.home, undefined);
    assert.equal(en.home, undefined);
    assert.ok(zh.shared?.newNote);
    assert.ok(en.shared?.newNote);
  });

  it("every workspace:shared.* reference resolves to a locale key", () => {
    const srcRoot = path.join(root, "src");
    const used = new Set();
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(ent.name)) {
          const text = fs.readFileSync(p, "utf8");
          assert.doesNotMatch(text, /workspace:home\./);
          for (const m of text.matchAll(/workspace:shared\.([a-zA-Z0-9_]+)/g)) {
            used.add(m[1]);
          }
        }
      }
    };
    walk(srcRoot);
    const zh = JSON.parse(read("src/locales/zh-CN/workspace.json"));
    const en = JSON.parse(read("src/locales/en-US/workspace.json"));
    assert.ok(used.size > 0, "expected some shared.* refs for shared actions");
    for (const key of used) {
      assert.equal(typeof zh.shared[key], "string", `zh shared.${key} missing (used in code)`);
      assert.equal(typeof en.shared[key], "string", `en shared.${key} missing (used in code)`);
    }
    // Stream organize: local reconcile + open AI rail for candidates — no forced chat injection
    const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
    assert.match(stream, /streamDetail\.candidatesReady|streamDetail\.organizeTip/);
    assert.doesNotMatch(stream, /sendMessage\(/);
  });

  it("StatusBar has no living home case", () => {
    const src = read("src/components/shell/StatusBar.tsx");
    assert.doesNotMatch(src, /case "home":/);
    assert.match(src, /case "stream":/);
  });

  it("lifecycle archive applySuggestion is wired through Kernel executeArchive", () => {
    const repoLib = path.resolve(root, "../lib");
    const suggest = fs.readFileSync(path.join(repoLib, "suggest-engine.mjs"), "utf8");
    const writeback = fs.readFileSync(path.join(repoLib, "writeback-engine.mjs"), "utf8");
    assert.match(writeback, /export function executeArchive/);
    assert.match(suggest, /executeArchive/);
    assert.match(suggest, /kind: "catch_all"/);
    assert.match(suggest, /case "stale_topic"/);
    assert.match(suggest, /case "catch_all"/);
    // no review-only dead-end for lifecycle apply
    assert.doesNotMatch(suggest, /review only — no automatic archive/);
  });
});
