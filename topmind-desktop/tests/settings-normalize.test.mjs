/**
 * Settings normalize / defaults contract (pure, no Electron).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  __settingsTest,
} from "../electron/settings.mjs";

const {
  normalizeEditorSettings,
  normalizeWritebackMode,
  normalizeUiSettings,
  normalizeWereadSettings,
  normalizeXSettings,
  normalizeAiSettings,
  normalizePluginsSettings,
  clampAutoSaveMs,
  clampEditorFontSize,
  clampMaxAgentSteps,
  createDefaultAppSettings,
  mergeAppSettings,
  AGENT_STEPS_DEFAULT,
  AGENT_STEPS_MIN,
  AGENT_STEPS_MAX,
} = __settingsTest;

test("defaults: theme auto, agent on, skills on, autoSave 1500, wordWrap, maxAgentSteps", () => {
  const d = createDefaultAppSettings("/tmp/ws");
  assert.equal(d.theme, "auto");
  assert.equal(d.writebackMode, "auto");
  assert.equal(d.ai.agentEnabled, true);
  assert.equal(d.ai.skillsEnabled, true);
  assert.equal(d.ai.enabledSkillIds, null);
  assert.equal(d.ai.maxAgentSteps, AGENT_STEPS_DEFAULT);
  assert.equal(d.editor.autoSaveMs, 1500);
  assert.equal(d.editor.fontSize, 16);
  assert.equal(d.editor.lineHeight, 1.7);
  assert.equal(d.editor.wordWrap, true);
  assert.equal(d.editor.inlineAiAutoPopup, true);
  assert.ok(d.ui.aiPanelOpen);
  assert.equal(d.ui.sidebarView, "stream");
  assert.equal(d.ui.feedLayout, "list");
  assert.ok(d.clipBridge);
  assert.equal(d.clipBridge.enabled, false);
  assert.ok(d.plugins);
  assert.deepEqual(d.plugins.externalEnabled, {});
  assert.equal(d.ui.locale, "auto");
  assert.equal(d.weread.enabled, false);
  assert.equal(d.weread.syncCategory, "auto");
  assert.equal(d.weread.includeThoughts, true);
  assert.equal(d.weread.syncBudgetMinutes, 4);
  assert.equal(d.weread.lastSyncAt, null);
  assert.equal(d.x.syncCategory, "auto");
  assert.equal(normalizeWritebackMode("confirm"), "confirm");
  assert.equal(normalizeWritebackMode("auto"), "auto");
});

test("normalizePluginsSettings keeps boolean enable map", () => {
  const n = normalizePluginsSettings({
    externalEnabled: { "example-hello": false, bad: "yes", "": true, ok: true },
  });
  assert.equal(n.externalEnabled["example-hello"], false);
  assert.equal(n.externalEnabled.ok, true);
  assert.equal(n.externalEnabled.bad, undefined);
  assert.equal(n.externalEnabled[""], undefined);
});

test("mergeAppSettings merges plugins.externalEnabled without wipe", () => {
  const base = createDefaultAppSettings("/tmp/ws");
  base.plugins = { externalEnabled: { a: false, b: true } };
  const next = mergeAppSettings(base, {
    plugins: { externalEnabled: { b: false, c: true } },
  });
  assert.equal(next.plugins.externalEnabled.a, false);
  assert.equal(next.plugins.externalEnabled.b, false);
  assert.equal(next.plugins.externalEnabled.c, true);
});

test("defaults include empty extraSkillsRoots; merge replaces list", () => {
  const d = createDefaultAppSettings("/tmp/ws");
  assert.deepEqual(d.ai.extraSkillsRoots, []);
  const next = mergeAppSettings(d, {
    ai: { extraSkillsRoots: ["/tmp/skills-a", "/tmp/skills-b"] },
  });
  assert.ok(Array.isArray(next.ai.extraSkillsRoots));
  assert.equal(next.ai.extraSkillsRoots.length, 2);
});

test("clamp editor font / autoSave / agent steps", () => {
  assert.equal(clampEditorFontSize(8), 12);
  assert.equal(clampEditorFontSize(40), 24);
  assert.equal(clampAutoSaveMs(100), 500);
  assert.equal(clampAutoSaveMs(9999), 5000);
  assert.equal(clampAutoSaveMs(1234), 1200);
  assert.equal(clampMaxAgentSteps(1), AGENT_STEPS_MIN);
  assert.equal(clampMaxAgentSteps(99), AGENT_STEPS_MAX);
  assert.equal(clampMaxAgentSteps(12.4), 12);
  assert.equal(clampMaxAgentSteps("nope"), AGENT_STEPS_DEFAULT);
});

test("normalizeEditorSettings fills autoSaveMs + wordWrap", () => {
  const n = normalizeEditorSettings({ fontSize: 14, lineHeight: 1.5, fontFamily: "mono" });
  assert.equal(n.fontSize, 14);
  assert.equal(n.fontFamily, "mono");
  assert.equal(n.autoSaveMs, 1500);
  assert.equal(n.wordWrap, true);
  assert.equal(n.inlineAiAutoPopup, true);
  const n2 = normalizeEditorSettings({ ...n, autoSaveMs: 2500, wordWrap: false });
  assert.equal(n2.autoSaveMs, 2500);
  assert.equal(n2.wordWrap, false);
});

test("normalizeEditorSettings preserves inlineAiAutoPopup false (not reset to default true)", () => {
  const n = normalizeEditorSettings({ inlineAiAutoPopup: false, fontSize: 16 });
  assert.equal(n.inlineAiAutoPopup, false);
  const merged = mergeAppSettings(createDefaultAppSettings("/tmp/ws-inline"), {
    editor: { inlineAiAutoPopup: false },
  });
  assert.equal(merged.editor.inlineAiAutoPopup, false);
  // Subsequent reading-prefs patch must not drop the flag
  const afterFont = mergeAppSettings(merged, { editor: { fontSize: 18, paper: "sepia" } });
  assert.equal(afterFont.editor.inlineAiAutoPopup, false);
  assert.equal(afterFont.editor.fontSize, 18);
  assert.equal(afterFont.editor.paper, "sepia");
});

test("normalizeWritebackMode rejects garbage", () => {
  assert.equal(normalizeWritebackMode("auto"), "auto");
  assert.equal(normalizeWritebackMode("confirm"), "confirm");
  assert.equal(normalizeWritebackMode("nope", "confirm"), "confirm");
});

test("normalizeUiSettings clamps panel widths + sidebarView", () => {
  const n = normalizeUiSettings({ sidebarWidth: 50, aiPanelWidth: 9999, aiPanelOpen: false, sidebarView: "kanban" });
  assert.equal(n.sidebarWidth, 240); // fallback when out of range
  assert.equal(n.aiPanelWidth, 360);
  assert.equal(n.aiPanelOpen, false);
  assert.equal(n.sidebarView, "kanban");
  // Regression: "stream" must be a valid sidebarView (was missing from SIDEBAR_VIEWS)
  const streamView = normalizeUiSettings({ sidebarView: "stream" });
  assert.equal(streamView.sidebarView, "stream");
  const bad = normalizeUiSettings({ sidebarView: "galaxy" });
  assert.equal(bad.sidebarView, "stream");
  // Product default is stream — never category when fallback is empty/missing
  const emptyFallback = normalizeUiSettings({ sidebarView: "nope" }, { sidebarWidth: 240 });
  assert.equal(emptyFallback.sidebarView, "stream");
  const ok = normalizeUiSettings({ sidebarWidth: 300, aiPanelWidth: 400 });
  assert.equal(ok.sidebarWidth, 300);
  assert.equal(ok.aiPanelWidth, 400);
  const card = normalizeUiSettings({ feedLayout: "card" });
  assert.equal(card.feedLayout, "card");
  const badLayout = normalizeUiSettings({ feedLayout: "masonry" });
  assert.equal(badLayout.feedLayout, "list");
});

test("mergeAppSettings partial ui preserves locale/fileFilter and applies aiPanelOpen", () => {
  const base = createDefaultAppSettings("/tmp/ws-ui");
  base.ui = {
    ...base.ui,
    locale: "en-US",
    fileFilter: "markdown",
    closeBehavior: "hide",
    aiPanelOpen: true,
    sidebarView: "stream",
    sidebarWidth: 260,
  };
  // Shell-style layout-only patch must not wipe locale / fileFilter
  const layoutOnly = mergeAppSettings(base, {
    ui: { sidebarWidth: 300, aiPanelOpen: false, sidebarView: "timeline", aiPanelWidth: 400 },
  });
  assert.equal(layoutOnly.ui.locale, "en-US");
  assert.equal(layoutOnly.ui.fileFilter, "markdown");
  assert.equal(layoutOnly.ui.closeBehavior, "hide");
  assert.equal(layoutOnly.ui.aiPanelOpen, false);
  assert.equal(layoutOnly.ui.sidebarView, "timeline");
  assert.equal(layoutOnly.ui.sidebarWidth, 300);
  assert.equal(layoutOnly.ui.aiPanelWidth, 400);
  assert.equal(layoutOnly.ui.feedLayout, "list");
  const withCard = mergeAppSettings(base, { ui: { feedLayout: "card" } });
  assert.equal(withCard.ui.feedLayout, "card");
  const afterWidth = mergeAppSettings(withCard, { ui: { sidebarWidth: 280 } });
  assert.equal(afterWidth.ui.feedLayout, "card");
  assert.equal(afterWidth.ui.sidebarWidth, 280);
});

test("normalizeWeread / X preserves fields and validates mcp URL", () => {
  const w = normalizeWereadSettings({ enabled: true, apiKey: "wrk-x", syncCategory: "20-研究" });
  assert.equal(w.enabled, true);
  assert.equal(w.apiKey, "wrk-x");
  assert.equal(w.syncCategory, "20-研究");
  assert.equal(w.includeThoughts, true);
  assert.equal(w.syncBudgetMinutes, 4);
  // legacy hardcodes migrate to auto
  assert.equal(normalizeWereadSettings({ syncCategory: "30 阅读" }).syncCategory, "auto");
  const wOpts = normalizeWereadSettings({
    includeThoughts: false,
    syncBudgetMinutes: 12,
    statsCache: {
      mode: "monthly",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      totalReadTime: 100,
      readDays: 2,
      dayAverageReadTime: 50,
    },
  });
  assert.equal(wOpts.includeThoughts, false);
  assert.equal(wOpts.syncBudgetMinutes, 12);
  assert.equal(wOpts.statsCache?.totalReadTime, 100);
  const x = normalizeXSettings({
    enabled: true,
    bearerToken: "tok",
    mcpEndpoint: "http://evil.example.com/mcp",
    syncCategory: "auto",
    autoArchivePosts: true,
  });
  assert.equal(x.enabled, true);
  assert.equal(x.bearerToken, "tok");
  // non-https remote rejected → default
  assert.equal(x.mcpEndpoint, "https://api.x.com/mcp");
  assert.equal(x.autoArchivePosts, true);
  const xOk = normalizeXSettings({ mcpEndpoint: "https://api.x.com/mcp/v2/" });
  assert.equal(xOk.mcpEndpoint, "https://api.x.com/mcp/v2");
});

test("normalizeAiSettings clamps maxAgentSteps", () => {
  const a = normalizeAiSettings({ agentEnabled: false, maxAgentSteps: 100 }, createDefaultAppSettings("/t").ai);
  assert.equal(a.agentEnabled, false);
  assert.equal(a.maxAgentSteps, AGENT_STEPS_MAX);
});

test("mergeAppSettings patches agentEnabled / skillsEnabled without clearing keys", () => {
  const base = createDefaultAppSettings("/tmp/ws");
  base.ai.manual.openAiKey = "sk-test";
  const next = mergeAppSettings(base, { ai: { agentEnabled: false, maxAgentSteps: 15, skillsEnabled: false } });
  assert.equal(next.ai.agentEnabled, false);
  assert.equal(next.ai.skillsEnabled, false);
  assert.equal(next.ai.maxAgentSteps, 15);
  assert.equal(next.ai.manual.openAiKey, "sk-test");
  const nextSkills = mergeAppSettings(base, {
    ai: { enabledSkillIds: ["topmind", "topmind-capture"] },
  });
  assert.deepEqual(nextSkills.ai.enabledSkillIds, ["topmind", "topmind-capture"]);
  assert.equal(nextSkills.ai.skillsEnabled, true);
  const clearSkills = mergeAppSettings(nextSkills, { ai: { enabledSkillIds: null } });
  assert.equal(clearSkills.ai.enabledSkillIds, null);
  // defaultModel undefined should not wipe
  const next2 = mergeAppSettings(base, { ai: { sourcePreference: "openai" } });
  assert.equal(next2.ai.sourcePreference, "openai");
  assert.equal(next2.ai.defaultModel, null);
  // partial weread patch keeps apiKey
  base.weread.apiKey = "wrk-keep";
  base.weread.enabled = true;
  const next3 = mergeAppSettings(base, { weread: { syncCategory: "20-研究" } });
  assert.equal(next3.weread.apiKey, "wrk-keep");
  assert.equal(next3.weread.enabled, true);
  assert.equal(next3.weread.syncCategory, "20-研究");
  // editor wordWrap
  const next4 = mergeAppSettings(base, { editor: { wordWrap: false } });
  assert.equal(next4.editor.wordWrap, false);
  assert.equal(next4.editor.fontSize, 16);
  // ui sidebarView
  const next5 = mergeAppSettings(base, { ui: { sidebarView: "timeline" } });
  assert.equal(next5.ui.sidebarView, "timeline");
  assert.equal(next5.ui.sidebarWidth, 240);
});
