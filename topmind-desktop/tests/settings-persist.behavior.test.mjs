/**
 * Behavioral tests: settings load / atomic save / empty-file recovery.
 * Pure Node — no Electron secretAdapter.
 */
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const settingsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../electron/settings.mjs",
);

let tmpRoot;
let settingsFile;
let loadAppSettings;
let saveAppSettings;
let updateAppSettings;
let createDefaultAppSettings;

beforeEach(async () => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = mkdtempSync(path.join(tmpdir(), "topmind-settings-"));
  settingsFile = path.join(tmpRoot, "app-settings.json");
  mkdirSync(tmpRoot, { recursive: true });

  const mod = await import(`${pathToFileURL(settingsPath).href}?t=${Date.now()}`);
  loadAppSettings = mod.loadAppSettings;
  saveAppSettings = mod.saveAppSettings;
  updateAppSettings = mod.updateAppSettings;
  createDefaultAppSettings = mod.createDefaultAppSettings;
});

after(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

test("save then load round-trips writebackMode, theme, editor, ai + skills flags", async () => {
  const base = createDefaultAppSettings("/tmp/ws-a");
  const saved = await updateAppSettings(settingsFile, base, {
    writebackMode: "confirm",
    theme: "dark",
    editor: { fontSize: 18, autoSaveMs: 2000, wordWrap: false, lineHeight: 1.8, fontFamily: "mono", inlineAiAutoPopup: false },
    ai: {
      agentEnabled: false,
      skillsEnabled: false,
      enabledSkillIds: ["topmind-capture"],
      maxAgentSteps: 15,
      sourcePreference: "openai",
      defaultModel: "gpt-4o-mini",
    },
    ui: { sidebarWidth: 300, aiPanelOpen: false, sidebarView: "kanban", sidebarCollapsed: true, aiPanelWidth: 400 },
  });

  assert.equal(saved.writebackMode, "confirm");
  assert.ok(existsSync(settingsFile));
  const disk = readFileSync(settingsFile, "utf8");
  assert.ok(disk.length > 100);
  assert.match(disk, /"writebackMode": "confirm"/);

  const loaded = await loadAppSettings(settingsFile, "/tmp/ws-a");
  assert.equal(loaded.writebackMode, "confirm");
  assert.equal(loaded.theme, "dark");
  assert.equal(loaded.editor.fontSize, 18);
  assert.equal(loaded.editor.autoSaveMs, 2000);
  assert.equal(loaded.editor.wordWrap, false);
  assert.equal(loaded.editor.inlineAiAutoPopup, false);
  assert.equal(loaded.ai.agentEnabled, false);
  assert.equal(loaded.ai.skillsEnabled, false);
  assert.deepEqual(loaded.ai.enabledSkillIds, ["topmind-capture"]);
  assert.equal(loaded.ai.maxAgentSteps, 15);
  assert.equal(loaded.ai.sourcePreference, "openai");
  assert.equal(loaded.ai.defaultModel, "gpt-4o-mini");
  assert.equal(loaded.ui.sidebarWidth, 300);
  assert.equal(loaded.ui.aiPanelOpen, false);
  assert.equal(loaded.ui.sidebarView, "kanban");
});

test("empty primary recovers from .bak", async () => {
  const base = createDefaultAppSettings("/tmp/ws-b");
  await updateAppSettings(settingsFile, base, { writebackMode: "confirm", theme: "light" });
  // Simulate crash mid-write: empty primary, good bak
  const good = readFileSync(settingsFile, "utf8");
  writeFileSync(`${settingsFile}.bak`, good, "utf8");
  writeFileSync(settingsFile, "", "utf8");
  assert.equal(readFileSync(settingsFile, "utf8").length, 0);

  const loaded = await loadAppSettings(settingsFile, "/tmp/ws-b");
  assert.equal(loaded.writebackMode, "confirm");
  assert.equal(loaded.theme, "light");
  // Primary restored
  const restored = readFileSync(settingsFile, "utf8");
  assert.ok(restored.length > 100);
  assert.match(restored, /"writebackMode": "confirm"/);
});

test("empty primary without bak rewrites defaults (not leave 0-byte trap)", async () => {
  writeFileSync(settingsFile, "", "utf8");
  const loaded = await loadAppSettings(settingsFile, "/tmp/ws-c");
  assert.equal(loaded.writebackMode, "auto");
  const disk = readFileSync(settingsFile, "utf8");
  assert.ok(disk.length > 100, "defaults must be rewritten to disk");
  assert.match(disk, /"writebackMode"/);
});

test("partial ui patch does not wipe writebackMode", async () => {
  const base = createDefaultAppSettings("/tmp/ws-d");
  await updateAppSettings(settingsFile, base, { writebackMode: "confirm" });
  const current = await loadAppSettings(settingsFile, "/tmp/ws-d");
  const next = await updateAppSettings(settingsFile, current, {
    ui: { sidebarWidth: 320 },
  });
  assert.equal(next.writebackMode, "confirm");
  const reloaded = await loadAppSettings(settingsFile, "/tmp/ws-d");
  assert.equal(reloaded.writebackMode, "confirm");
  assert.equal(reloaded.ui.sidebarWidth, 320);
});

test("inlineAiAutoPopup false survives persist → reload → reading-prefs patch", async () => {
  const base = createDefaultAppSettings("/tmp/ws-inline-ai");
  await updateAppSettings(settingsFile, base, { editor: { inlineAiAutoPopup: false } });
  const loaded = await loadAppSettings(settingsFile, "/tmp/ws-inline-ai");
  assert.equal(loaded.editor.inlineAiAutoPopup, false);
  const afterFont = await updateAppSettings(settingsFile, loaded, {
    editor: { fontSize: 18, paper: "sepia" },
  });
  assert.equal(afterFont.editor.inlineAiAutoPopup, false);
  assert.equal(afterFont.editor.fontSize, 18);
  const reloaded = await loadAppSettings(settingsFile, "/tmp/ws-inline-ai");
  assert.equal(reloaded.editor.inlineAiAutoPopup, false);
  assert.equal(reloaded.editor.fontSize, 18);
});

test("refuse to save non-object settings", async () => {
  await assert.rejects(
    () => saveAppSettings(settingsFile, null),
    /requires a settings object/,
  );
});

test("empty-string secret patch does not wipe existing AI / weread keys (no encryption)", async () => {
  const base = createDefaultAppSettings("/tmp/ws-secrets");
  // Without secretAdapter keys are stored in plaintext on disk
  await updateAppSettings(settingsFile, base, {
    ai: { manual: { openAiKey: "sk-live-keep-me", deepseekKey: "ds-keep" } },
    weread: { apiKey: "wrk-keep-me", enabled: true },
  });
  let loaded = await loadAppSettings(settingsFile, "/tmp/ws-secrets");
  assert.equal(loaded.ai.manual.openAiKey, "sk-live-keep-me");
  assert.equal(loaded.weread.apiKey, "wrk-keep-me");

  // UI partial patch that accidentally includes empty secret strings
  await updateAppSettings(settingsFile, loaded, {
    ai: {
      skillsEnabled: false,
      manual: { openAiKey: "", deepseekKey: "", anthropicKey: "" },
    },
    weread: { enabled: true, apiKey: "" },
    ui: { sidebarWidth: 280 },
  });
  loaded = await loadAppSettings(settingsFile, "/tmp/ws-secrets");
  assert.equal(loaded.ai.manual.openAiKey, "sk-live-keep-me", "openAiKey must survive empty patch");
  assert.equal(loaded.ai.manual.deepseekKey, "ds-keep", "deepseekKey must survive empty patch");
  assert.equal(loaded.weread.apiKey, "wrk-keep-me", "weread apiKey must survive empty patch");
  assert.equal(loaded.ai.skillsEnabled, false);
  assert.equal(loaded.ui.sidebarWidth, 280);
});

test("null secret patch explicitly clears key", async () => {
  const base = createDefaultAppSettings("/tmp/ws-clear");
  await updateAppSettings(settingsFile, base, {
    ai: { manual: { openAiKey: "sk-to-clear" } },
    weread: { apiKey: "wrk-to-clear" },
  });
  let loaded = await loadAppSettings(settingsFile, "/tmp/ws-clear");
  assert.equal(loaded.ai.manual.openAiKey, "sk-to-clear");

  await updateAppSettings(settingsFile, loaded, {
    ai: { manual: { openAiKey: null } },
    weread: { apiKey: null },
  });
  loaded = await loadAppSettings(settingsFile, "/tmp/ws-clear");
  assert.equal(loaded.ai.manual.openAiKey, "");
  assert.equal(loaded.weread.apiKey, "");
});

test("concurrent partial patches re-read disk under write queue (no clobber)", async () => {
  const base = createDefaultAppSettings("/tmp/ws-race");
  await updateAppSettings(settingsFile, base, {
    writebackMode: "auto",
    theme: "auto",
    ui: { sidebarWidth: 240 },
  });
  // Both callers start from the same snapshot (historical race).
  const snap = await loadAppSettings(settingsFile, "/tmp/ws-race");
  const [a, b] = await Promise.all([
    updateAppSettings(settingsFile, snap, { writebackMode: "confirm" }),
    updateAppSettings(settingsFile, snap, { ui: { sidebarWidth: 360 }, theme: "dark" }),
  ]);
  // Last writer wins on its own fields; the other writer's field must survive.
  const reloaded = await loadAppSettings(settingsFile, "/tmp/ws-race");
  assert.equal(reloaded.writebackMode, "confirm", "writebackMode from concurrent A must survive");
  assert.equal(reloaded.ui.sidebarWidth, 360, "sidebarWidth from concurrent B must survive");
  assert.equal(reloaded.theme, "dark");
  // In-memory return values also consistent with their merge (order-dependent last)
  assert.ok(a.writebackMode === "confirm" || b.writebackMode === "confirm");
  assert.ok(a.ui.sidebarWidth === 360 || b.ui.sidebarWidth === 360);
});

test("encrypted secureStorage preserves ciphertext when memory secrets empty", async () => {
  // Mock safeStorage adapter
  const store = new Map();
  const secretAdapter = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => {
      const token = `enc:${Buffer.from(v, "utf8").toString("base64")}`;
      store.set(token, v);
      return token;
    },
    decryptString: (v) => {
      if (store.has(v)) return store.get(v);
      if (String(v).startsWith("enc:")) {
        return Buffer.from(String(v).slice(4), "base64").toString("utf8");
      }
      throw new Error("bad ciphertext");
    },
  };

  const base = createDefaultAppSettings("/tmp/ws-enc");
  await updateAppSettings(
    settingsFile,
    base,
    { ai: { manual: { openAiKey: "sk-encrypted-keep" } }, weread: { apiKey: "wrk-enc" } },
    { secretAdapter },
  );

  const disk1 = JSON.parse(readFileSync(settingsFile, "utf8"));
  assert.equal(disk1.ai.manual.openAiKey, "", "plaintext blanked on disk");
  assert.ok(disk1.secureStorage.manual.openAiKey, "ciphertext present");
  assert.ok(disk1.secureStorage.integration.wereadApiKey, "weread ciphertext present");

  // Simulate stale in-memory settings with empty keys (the historical wipe path)
  const stale = await loadAppSettings(settingsFile, "/tmp/ws-enc", { secretAdapter });
  assert.equal(stale.ai.manual.openAiKey, "sk-encrypted-keep");
  // Force empty in memory then save ui-only via update with empty manual
  stale.ai.manual.openAiKey = "";
  stale.weread.apiKey = "";
  await updateAppSettings(
    settingsFile,
    stale,
    { ui: { sidebarWidth: 333 }, ai: { manual: { openAiKey: "" } }, weread: { apiKey: "" } },
    { secretAdapter },
  );

  const reloaded = await loadAppSettings(settingsFile, "/tmp/ws-enc", { secretAdapter });
  assert.equal(reloaded.ai.manual.openAiKey, "sk-encrypted-keep", "ciphertext must be preserved");
  assert.equal(reloaded.weread.apiKey, "wrk-enc");
  assert.equal(reloaded.ui.sidebarWidth, 333);
});
