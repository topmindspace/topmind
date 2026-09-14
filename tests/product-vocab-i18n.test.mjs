/**
 * Product vocabulary consistency across Desktop + Obsidian locales.
 * Drives shipped locale files (not re-implemented strings).
 *
 * Core concepts (≤5): 记一下/Note it · 记下/Log it · 动态 · 专题 · 我的情况 · 交付
 * Clip Extension uses Clip/剪藏 intentionally (companion surface) — covered in extension-i18n-parity.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

test("Desktop shell capture CTAs: 记一下/Note it and 记下/Log it (not mixed across locales)", () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const zhWs = readJson("topmind-desktop/src/locales/zh-CN/workspace.json");
  const enWs = readJson("topmind-desktop/src/locales/en-US/workspace.json");

  assert.equal(zhShell.titleBar.capture, "记一下");
  assert.equal(enShell.titleBar.capture, "Note it");
  assert.equal(zhWs.streamDetail.composeSubmit, "记下");
  assert.equal(enWs.streamDetail.composeSubmit, "Log it");
  // Must not reverse-mix product words into the wrong locale
  assert.doesNotMatch(enShell.titleBar.capture, /记一下|记下/);
  assert.doesNotMatch(zhShell.titleBar.capture, /Note it|Log it/i);
  assert.doesNotMatch(enWs.streamDetail.composeSubmit, /记一下|记下/);
  assert.doesNotMatch(zhWs.streamDetail.composeSubmit, /Note it|Log it/i);
});

test("Kernel AI op labels say 整理我的情况 not 整理记忆", () => {
  const src = read("lib/ai-operation-engine.mjs");
  assert.match(src, /memoryOrganize:\s*"AI 整理我的情况"/u);
  assert.match(src, /memoryOrganize:\s*"AI Organize My profile"/u);
  assert.doesNotMatch(src, /整理记忆/);
  assert.doesNotMatch(src, /整理「记忆」/);
  assert.doesNotMatch(src, /Organize Memory/);
  assert.doesNotMatch(src, /Extract "memory" candidates/);
});

test("Desktop nav chips expose 交付 / 我的情况 product terms", () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const zhWs = readJson("topmind-desktop/src/locales/zh-CN/workspace.json");
  const enWs = readJson("topmind-desktop/src/locales/en-US/workspace.json");
  assert.equal(zhShell.primaryNav.outputs, "交付");
  assert.equal(zhWs.outputsView.title, "交付");
  assert.equal(zhShell.sidebar.myProfile, "我的情况");
  assert.equal(enShell.sidebar.myProfile, "My profile");
  assert.equal(zhWs.memoryBrowse.title, "我的情况");
  assert.equal(enWs.memoryBrowse.title, "My profile");
  assert.equal(zhWs.memoryBrowse.organize, "整理我的情况");
  assert.equal(enWs.memoryBrowse.organize, "Organize My profile");
  assert.ok(enShell.primaryNav.outputs, "en outputs present");
  assert.doesNotMatch(enShell.primaryNav.outputs, /写出来/);
  assert.doesNotMatch(zhShell.primaryNav.outputs, /Ship it|Outputs|Write out|Delivery/i);
  // 我的情况 is a secondary pin, not a PrimaryNav peer; EN is My profile not About me
  assert.equal(zhShell.primaryNav.memory, undefined);
  assert.equal(enShell.primaryNav.memory, undefined);
  assert.doesNotMatch(JSON.stringify(enShell), /About me/);
  assert.doesNotMatch(JSON.stringify(enWs), /About me/);
});

test("Obsidian capture CTAs align with Desktop product vocabulary", () => {
  const zh = read("obsidian-plugin/src/i18n/locales/zh-CN.ts");
  const en = read("obsidian-plugin/src/i18n/locales/en-US.ts");
  assert.match(zh, /quick_capture_title:\s*"记一下"/u);
  assert.match(en, /quick_capture_title:\s*"Note it"/u);
  assert.doesNotMatch(zh, /quick_capture_submit:/u);
  assert.doesNotMatch(en, /quick_capture_submit:/u);
  assert.match(zh, /quick_capture_note_it:\s*"记一下"/u);
  assert.match(en, /quick_capture_note_it:\s*"Note it"/u);
  assert.match(zh, /quick_capture_log_it:\s*"记下"/u);
  assert.match(en, /quick_capture_log_it:\s*"Log it"/u);
  assert.match(zh, /cmd_quick_capture:\s*"Topmind: 记一下"/u);
  assert.match(en, /cmd_quick_capture:\s*"Topmind: Note it"/u);
  assert.match(zh, /memory_browse_organize:\s*"整理我的情况"/u);
  assert.doesNotMatch(zh, /suggestion_todo:/u);
  assert.doesNotMatch(en, /suggestion_todo:/u);
  // No reverse-locale pollution on primary CTAs
  assert.doesNotMatch(en, /quick_capture_title:\s*"记一下"/u);
  assert.doesNotMatch(zh, /quick_capture_title:\s*"Note it"/u);
});

test("Desktop Electron tray/window capture copy matches renderer 记一下/Note it (not Quick Capture)", async () => {
  const zhShell = readJson("topmind-desktop/src/locales/zh-CN/shell.json");
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const { setLocale, t } = await import(
    pathToFileURL(path.join(repoRoot, "topmind-desktop/electron/lib/electron-i18n.mjs")).href
  );
  setLocale("zh-CN");
  assert.equal(t("capture.title"), zhShell.titleBar.capture);
  assert.match(t("tray.capture"), new RegExp(zhShell.titleBar.capture));
  assert.match(t("capture.errorTitle"), new RegExp(zhShell.titleBar.capture));
  assert.doesNotMatch(
    `${t("tray.capture")}\n${t("capture.title")}\n${t("capture.errorTitle")}`,
    /快速捕获|Quick Capture/i,
  );
  setLocale("en-US");
  assert.equal(t("capture.title"), enShell.titleBar.capture);
  assert.match(t("tray.capture"), new RegExp(enShell.titleBar.capture));
  assert.match(t("capture.errorTitle"), new RegExp(enShell.titleBar.capture));
  assert.doesNotMatch(
    `${t("tray.capture")}\n${t("capture.title")}\n${t("capture.errorTitle")}`,
    /快速捕获|Quick Capture/i,
  );
});

test("Obsidian stream surface is 动态/Stream, not a sixth 工作台/Workbench room", () => {
  const zh = read("obsidian-plugin/src/i18n/locales/zh-CN.ts");
  const en = read("obsidian-plugin/src/i18n/locales/en-US.ts");
  assert.match(zh, /stream_workbench_title:\s*"动态"/u);
  assert.match(en, /stream_workbench_title:\s*"Stream"/u);
  assert.doesNotMatch(zh, /stream_workbench_title:\s*"[^"]*工作台/u);
  assert.doesNotMatch(en, /stream_workbench_title:\s*"[^"]*Workbench/u);
  assert.match(zh, /sidebar_btn_workbench:\s*"动态"/u);
  assert.match(en, /sidebar_btn_workbench:\s*"Stream"/u);
  assert.match(zh, /cmd_open_workbench:\s*"Topmind: 打开动态"/u);
  assert.match(en, /cmd_open_workbench:\s*"Topmind: Open Stream"/u);
  assert.match(zh, /sidebar_op_memory:\s*"整理我的情况"/u);
  assert.match(en, /sidebar_op_memory:\s*"Organize My profile"/u);
  assert.match(zh, /memory_browse_organize:\s*"整理我的情况"/u);
  assert.match(en, /memory_browse_organize:\s*"Organize My profile"/u);
  assert.doesNotMatch(en, /About me/);
});

test("EN Desktop locales use My profile / Note it / Delivery (not My Status / Quick Note)", () => {
  const files = [
    "topmind-desktop/src/locales/en-US/ai.json",
    "topmind-desktop/src/locales/en-US/settings.json",
    "topmind-desktop/src/locales/en-US/shell.json",
    "topmind-desktop/src/locales/en-US/overlays.json",
    "topmind-desktop/src/locales/en-US/workspace.json",
    "topmind-desktop/src/locales/en-US/common.json",
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /\bMy Status\b/, rel);
    assert.doesNotMatch(src, /\bQuick Note\b/, rel);
    assert.doesNotMatch(src, /\bAbout me\b/, rel);
  }
  const enShell = readJson("topmind-desktop/src/locales/en-US/shell.json");
  const enWs = readJson("topmind-desktop/src/locales/en-US/workspace.json");
  const enCommon = readJson("topmind-desktop/src/locales/en-US/common.json");
  const enOverlays = readJson("topmind-desktop/src/locales/en-US/overlays.json");
  assert.equal(enShell.primaryNav.outputs, "Delivery");
  assert.equal(enWs.outputsView.title, "Delivery");
  assert.equal(enCommon.category.outputs, "Delivery");
  assert.equal(enCommon.category.memory, "My profile");
  assert.equal(enOverlays.search.group.memory, "My profile");
  assert.equal(enShell.sidebar.contextMenu.openOutputs, "Open Delivery");
  assert.equal(enShell.sidebar.contextMenu.publishToOutputs, "Publish to Delivery");
});

test("command palette actions resolve labels via labelKey (live locale)", () => {
  const skills = read("topmind-desktop/src/plugins/topmind-workspace/skills.ts");
  const weread = read("topmind-desktop/src/plugins/topmind-weread/actions.ts");
  const palette = read("topmind-desktop/src/components/overlays/CommandPalette.tsx");
  assert.match(skills, /labelKey:\s*"workspace:skills\.capture"/);
  assert.match(weread, /labelKey:\s*"overlays:command\.actions\.wereadOpenHub"/);
  assert.match(palette, /groupIngest/);
  assert.match(palette, /groupSync/);
  assert.match(palette, /i18n\.language/);
});

test("Obsidian compose vs capture call the distinct vocab keys", () => {
  const workbench = read("obsidian-plugin/src/views/stream-workbench-view.ts");
  const modal = read("obsidian-plugin/src/views/quick-capture-modal.ts");
  assert.match(workbench, /t\("quick_capture_log_it"\)/);
  assert.match(workbench, /aria-label": t\("quick_capture_log_it"\)/);
  assert.doesNotMatch(workbench, /aria-label": t\("quick_capture_title"\)/);
  assert.match(modal, /t\("quick_capture_note_it"\)/);
  assert.match(modal, /t\("quick_capture_title"\)/);
  assert.doesNotMatch(modal, /t\("quick_capture_submit"\)/);
  assert.doesNotMatch(modal, /t\("quick_capture_log_it"\)/);
});

/**
 * Retired product vocabulary must not survive in shipped display copy.
 * The 2026-09 chrome work renamed only the nav chips, which left 收件箱 / 写出来 /
 * Ship it scattered across ~60 strings; this keeps the rename all-or-nothing.
 * See docs/adr/2026-09-14-product-vocabulary-rename.md.
 */
test("retired vocabulary 收件箱 / 写出来 / Ship it is gone from shipped locales", () => {
  const localeFiles = fs
    .readdirSync(path.join(repoRoot, "topmind-desktop/src/locales/zh-CN"))
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => [
      `topmind-desktop/src/locales/zh-CN/${f}`,
      `topmind-desktop/src/locales/en-US/${f}`,
    ]);
  for (const rel of localeFiles) {
    assert.doesNotMatch(read(rel), /收件箱|写出来|Ship it/u, rel);
  }
  assert.doesNotMatch(
    read("obsidian-plugin/src/i18n/locales/zh-CN.ts"),
    /收件箱|写出来/u,
    "obsidian zh-CN locale",
  );
  assert.doesNotMatch(
    read("browser-extension/_locales/zh_CN/messages.json"),
    /收件箱|写出来/u,
    "clip extension zh_CN locale",
  );
});

/** Default template seeds carry the new vocabulary; role resolution stays name-agnostic. */
test("default templates seed Inbox / 交付 / Delivery", () => {
  for (const id of ["stream", "balanced", "research", "periodic"]) {
    const zh = readJson(`templates/${id}.json`);
    assert.equal(zh.categories["00"].name, "Inbox", `${id} 00`);
    assert.equal(zh.categories["00"].role, "buffer", `${id} 00 role`);
    assert.equal(zh.categories["88"].name, "交付", `${id} 88`);
    assert.equal(zh.categories["88"].role, "delivery", `${id} 88 role`);

    const en = readJson(`templates/${id}.en-US.json`);
    assert.equal(en.categories["00"].name, "Inbox", `${id} en 00`);
    assert.equal(en.categories["88"].name, "Delivery", `${id} en 88`);
  }
});

/**
 * Templates are only one of the places a brand-new directory name is decided.
 * The Kernel/Desktop/UTR fallbacks below also decide it, and Kernel suggestion
 * copy is user-facing. Both must follow the rename, while legacy on-disk names
 * stay resolvable (role-based resolution is name-agnostic).
 */
test("new-workspace fallback names and Kernel suggestion copy follow the rename", () => {
  const wsm = read("lib/workspace-model.mjs");
  assert.match(wsm, /"zh-CN":\s*\{\s*buffer:\s*"Inbox",\s*delivery:\s*"交付"/u);
  assert.match(wsm, /"en-US":\s*\{\s*buffer:\s*"Inbox",\s*delivery:\s*"Delivery"/u);
  assert.match(wsm, /\["00-Inbox",\s*"88-交付",\s*"99-归档"\]/u);
  assert.match(wsm, /\["00-Inbox",\s*"88-Delivery",\s*"99-Archive"\]/u);

  const pathModel = read("topmind-desktop/electron/lib/path-model.mjs");
  assert.doesNotMatch(pathModel, /"buffer",\s*"00-收件箱"/u);
  assert.doesNotMatch(pathModel, /"delivery",\s*"88-输出"/u);
  const utrCtx = read("utr/core/workspace-context.mjs");
  assert.match(utrCtx, /fallbackHyphen:\s*"00-Inbox"/u);
  assert.match(utrCtx, /fallbackHyphen:\s*"88-交付"/u);

  // Kernel suggestion copy (zh) is user-facing
  assert.doesNotMatch(read("lib/suggest-engine.mjs"), /收件箱/u);
  assert.match(read("lib/suggest-engine.mjs"), /inboxReviewTitle:\s*"Inbox 待整理"/u);

  // Legacy names must stay resolvable / parseable
  assert.match(read("topmind-desktop/electron/lib/category-pattern.mjs"), /"88-Outputs"/u);
  assert.match(read("utr/core/safety-receipt-paths.mjs"), /"88-Outputs"/u);
  const receipt = read("utr/core/safety-receipt-paths.mjs");
  assert.match(receipt, /"88-交付"/u);

  // UTR contract metadata declares the live default-template layout
  const listCats = readJson("utr/contracts/workspace-read/workspace-read.json")
    .commands["list-categories"];
  const reads = listCats.reads.flat(Infinity).filter((v) => typeof v === "string");
  assert.ok(reads.includes("00-Inbox/"), JSON.stringify(reads));
  // Legacy names stay declared so high-risk write snapshots keep covering old workspaces
  assert.ok(reads.includes("00-收件箱/"), JSON.stringify(reads));
});
