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
    assert.match(src, /key:\s*"search"/);
    assert.match(src, /primaryNav\.search/);
    assert.match(src, /icon:\s*Radio/);
    assert.doesNotMatch(src, /icon:\s*Home/);
    assert.doesNotMatch(src, /RotateCcw/);
    assert.doesNotMatch(src, /select\(\{\s*kind:\s*"archive"\s*\}\)/);
    assert.doesNotMatch(src, /三个主锚点：`工作台`/);
    assert.doesNotMatch(src, /Primary nav — 3 main anchors \(工作台/);
    assert.doesNotMatch(src, /\+ archive icon/);
    assert.match(src, /Primary nav — 动态（默认） \/ 收件箱 \/ 写出来 \/ 搜索/);
  });

  it("living Desktop DESIGN/ARCHITECTURE do not teach archive as a PrimaryNav peer", () => {
    const design = read("DESIGN.md");
    const arch = read("ARCHITECTURE.md");
    assert.match(design, /标题栏主锚点：动态（默认）· 收件箱 · 写出来 · 搜索/);
    assert.doesNotMatch(design, /标题栏主锚点：动态（默认）· 收件箱 · 写出来 · 归档/);
    assert.match(arch, /PrimaryNav[^\n]{0,120}搜索/);
    assert.doesNotMatch(arch, /PrimaryNav[^\n]{0,120}归档图标/);
  });

  it("ViewSwitcher keeps tags/kanban behind advanced more menu", () => {
    const src = read("src/components/sidebar/ViewSwitcher.tsx");
    assert.match(src, /PRIMARY_MODES/);
    assert.match(src, /ADVANCED_MODES/);
    assert.match(src, /moreLabel/);
    assert.match(src, /"tags"/);
    assert.match(src, /"kanban"/);
  });

  it("living DESIGN present-tense preview is static HTML, not live TipTap setEditable", () => {
    const design = read("DESIGN.md");
    assert.match(design, /getEditorHtml\(\)[`\s]*快照到静态 HTML/);
    assert.match(design, /不是同一实例 [`']setEditable[`'] 切换/);
    assert.doesNotMatch(design, /预览 = Tiptap readOnly/);
    assert.match(design, /isMarkdownNotePath/);
    assert.match(design, /data-sidebar-header/);
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

  it("我的情况 sidebar control opens memory browse, not only a raw file", () => {
    const sidebar = read("src/components/shell/Sidebar.tsx");
    const profileFn = sidebar.slice(sidebar.indexOf("function ProfileButton"));
    assert.match(profileFn, /kind:\s*"memory"/);
    assert.match(profileFn, /sidebar\.myProfile/);
    assert.doesNotMatch(
      profileFn,
      /select\(\{\s*kind:\s*"file",\s*path:\s*ensured\.profileRelPath/,
    );
    const views = read("src/plugins/topmind-workspace/views.tsx");
    assert.match(views, /MemoryBrowseView/);
    assert.match(views, /sel\.kind === "memory"/);
    const types = read("src/types.ts");
    assert.match(types, /kind: 'memory'/);
    const memView = read("src/plugins/topmind-workspace/views/MemoryBrowseView.tsx");
    assert.match(memView, /assembleMemoryFeed/);
    assert.match(memView, /data-memory-feed/);
    assert.match(memView, /kind:\s*"file"/);
    assert.match(memView, /kindProfile|layerFilter/);
    assert.match(memView, /data-memory-organize/);
    assert.match(memView, /runMemoryOrganizeConfirm/);
    assert.doesNotMatch(memView, /appendCoreMemory|api\.ws\.save/);
    const stream = read("src/plugins/topmind-workspace/views/StreamDetailView.tsx");
    assert.match(stream, /data-stream-open-memory/);
    assert.match(stream, /kind:\s*"memory"/);
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

  it("capture vocabulary: 记下=Log it · 记一下=Note it (no Save / Quick Capture masquerade)", () => {
    const zhWs = JSON.parse(read("src/locales/zh-CN/workspace.json"));
    const enWs = JSON.parse(read("src/locales/en-US/workspace.json"));
    const zhShell = JSON.parse(read("src/locales/zh-CN/shell.json"));
    const enShell = JSON.parse(read("src/locales/en-US/shell.json"));
    // Stream compose = 记下 / Log it (not full capture)
    assert.equal(zhWs.streamDetail.composeSubmit, "记下");
    assert.match(enWs.streamDetail.composeSubmit, /Log it/i);
    assert.doesNotMatch(enWs.streamDetail.composeSubmit, /^Save$/i);
    // URL CTA opens full capture under product name 记一下 / Note it
    assert.equal(zhWs.streamDetail.composeUrlAction, "记一下");
    assert.match(enWs.streamDetail.composeUrlAction, /Note it/i);
    assert.doesNotMatch(enWs.streamDetail.composeUrlAction, /Quick Capture/i);
    assert.doesNotMatch(zhWs.streamDetail.composeUrlAction, /快速捕获/);
    // Title-bar capture
    assert.equal(zhShell.titleBar.capture, "记一下");
    assert.match(enShell.titleBar.capture, /Note it/i);
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
    assert.equal(zhCommon.shortcut.home, undefined);
    assert.equal(enCommon.shortcut.home, undefined);
    assert.match(zhCommon.shortcut.stream, /动态/);
    assert.match(enCommon.shortcut.stream, /Stream/i);
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
    // 降噪 2026-08: center hint is file-only — non-file views self-identify via PageHeader/nav
    assert.match(src, /selection\.kind !== "file"/);
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

  it("OnboardingScreen has template selection step with template list and confirm", () => {
    const src = read("src/components/shell/OnboardingScreen.tsx");
    // Template state and loading
    assert.match(src, /pickedPath/);
    assert.match(src, /selectedTemplate/);
    assert.match(src, /api\.sys\.listTemplates/);
    // Template selection UI with data-landing-template-select
    assert.match(src, /data-landing-template-select/);
    assert.match(src, /data-landing-template-cta/);
    // Template confirm calls openOrCreateWorkspace with selectedTemplate
    assert.match(src, /openOrCreateWorkspace\(pickedPath, selectedTemplate\)/);
    // Back button returns to landing
    assert.match(src, /handleBackToLanding/);
  });

  it("OnboardingScreen i18n has template selection keys in both locales", () => {
    const zh = JSON.parse(read("src/locales/zh-CN/shell.json"));
    const en = JSON.parse(read("src/locales/en-US/shell.json"));
    const keys = ["templateTitle", "templateConfirm", "templateStreamName", "templateStreamDesc",
      "templateBalancedName", "templateBalancedDesc", "templateResearchName", "templateResearchDesc",
      "templatePeriodicName", "templatePeriodicDesc"];
    for (const k of keys) {
      assert.equal(typeof zh.onboarding[k], "string", `zh onboarding.${k} missing`);
      assert.equal(typeof en.onboarding[k], "string", `en onboarding.${k} missing`);
    }
  });
});
