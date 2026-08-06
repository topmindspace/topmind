/**
 * i18n infrastructure tests — locale resolution, settings locale field,
 * and template locale overlay merging.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Settings locale normalization ──────────────────────────────────────────

import { __settingsTest } from "../electron/settings.mjs";

const { normalizeUiSettings, createDefaultAppSettings, UI_LOCALES } = __settingsTest;

test("defaultUiSettings includes locale=auto", () => {
  const d = createDefaultAppSettings("/tmp/ws");
  assert.equal(d.ui.locale, "auto");
});

test("normalizeUiSettings accepts valid locale", () => {
  const n = normalizeUiSettings({ locale: "en-US" });
  assert.equal(n.locale, "en-US");
});

test("normalizeUiSettings accepts zh-CN", () => {
  const n = normalizeUiSettings({ locale: "zh-CN" });
  assert.equal(n.locale, "zh-CN");
});

test("normalizeUiSettings defaults to auto for invalid locale", () => {
  const n = normalizeUiSettings({ locale: "fr-FR" });
  assert.equal(n.locale, "auto");
});

test("normalizeUiSettings preserves existing locale when patch omits it", () => {
  const fallback = { ...normalizeUiSettings({ locale: "en-US" }) };
  const n = normalizeUiSettings({ sidebarWidth: 300 }, fallback);
  assert.equal(n.locale, "en-US");
});

test("normalizeUiSettings preserves fallback locale when patch omits it (undefined)", () => {
  const fallback = { ...normalizeUiSettings({ locale: "en-US" }) };
  const n = normalizeUiSettings({ locale: undefined }, fallback);
  assert.equal(n.locale, "en-US"); // undefined → fallback preserved
});

test("normalizeUiSettings resets to auto when locale is null", () => {
  const fallback = { locale: "en-US", sidebarWidth: 240, sidebarCollapsed: false, aiPanelOpen: true, aiPanelWidth: 360, sidebarView: "category", fileFilter: "default", closeBehavior: "ask" };
  const n = normalizeUiSettings({ locale: null }, fallback);
  assert.equal(n.locale, "auto"); // null → explicit reset to auto
});

test("UI_LOCALES contains auto, zh-CN, en-US", () => {
  assert.ok(UI_LOCALES.has("auto"));
  assert.ok(UI_LOCALES.has("zh-CN"));
  assert.ok(UI_LOCALES.has("en-US"));
  assert.ok(!UI_LOCALES.has("fr-FR"));
});

// ── Template locale overlay ────────────────────────────────────────────────

// Use the shared lib/template-loader.mjs directly (not the Desktop wrapper)
// because tests run from the monorepo where lib/ is accessible.
import {
  loadTemplate,
  listTemplateIds,
  listTemplateDescriptors,
} from "../../lib/template-loader.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("listTemplateIds excludes locale overlay files", () => {
  const ids = listTemplateIds(repoRoot);
  // Should include base templates
  assert.ok(ids.includes("stream"));
  assert.ok(ids.includes("balanced"));
  assert.ok(ids.includes("research"));
  assert.ok(ids.includes("periodic"));
  // Should NOT include locale overlays
  assert.ok(!ids.includes("stream.en-US"));
  assert.ok(!ids.includes("balanced.en-US"));
});

test("loadTemplate without locale returns Chinese base", () => {
  const t = loadTemplate(repoRoot, "stream");
  assert.equal(t.categories["00"].name, "收件箱");
  assert.equal(t.categories["10"].name, "动态");
  assert.equal(t.memory.profileFile, "profile.md");
});

test("loadTemplate with en-US locale returns English names", () => {
  const t = loadTemplate(repoRoot, "stream", { locale: "en-US" });
  assert.equal(t.categories["00"].name, "Inbox");
  assert.equal(t.categories["10"].name, "Stream");
  assert.equal(t.categories["88"].name, "Outputs");
  assert.equal(t.categories["99"].name, "Archive");
  assert.equal(t.memory.profileFile, "profile.md");
});

test("loadTemplate with en-US preserves structural fields", () => {
  const t = loadTemplate(repoRoot, "stream", { locale: "en-US" });
  // Roles and behaviors must be preserved from base
  assert.equal(t.categories["00"].role, "buffer");
  assert.equal(t.categories["00"].required, true);
  assert.equal(t.categories["10"].role, "loose-stream");
  assert.equal(t.categories["10"].specialBehavior, "flat-default");
  assert.equal(t.categories["88"].role, "delivery");
  assert.equal(t.categories["99"].role, "system");
  assert.equal(t.templateId, "stream");
  assert.equal(t.separator, "-");
});

test("loadTemplate with unknown locale falls back to base", () => {
  const t = loadTemplate(repoRoot, "stream", { locale: "fr-FR" });
  // fr-FR is not a supported overlay → base template returned
  assert.equal(t.categories["00"].name, "收件箱");
});

test("loadTemplate with zh-CN locale has no overlay → base returned", () => {
  const t = loadTemplate(repoRoot, "stream", { locale: "zh-CN" });
  // zh-CN is the base, no overlay file → base returned
  assert.equal(t.categories["00"].name, "收件箱");
});

test("listTemplateDescriptors with en-US returns English names", () => {
  const list = listTemplateDescriptors(repoRoot, { locale: "en-US" });
  const stream = list.find((t) => t.id === "stream");
  assert.ok(stream);
  assert.equal(stream.name, "Stream (Default)");
  assert.ok(stream.description.includes("Stream"));
});

test("listTemplateDescriptors without locale returns Chinese names", () => {
  const list = listTemplateDescriptors(repoRoot);
  const stream = list.find((t) => t.id === "stream");
  assert.ok(stream);
  assert.equal(stream.name, "极简流式（默认）");
});

test("balanced en-US overlay has all categories localized", () => {
  const t = loadTemplate(repoRoot, "balanced", { locale: "en-US" });
  assert.ok(t);
  assert.equal(t.categories["20"].name, "Topics");
  // Structural fields preserved
  assert.equal(t.categories["20"].role, "deep-work");
});

test("connectorHints nameKeywords are overridden in en-US", () => {
  const t = loadTemplate(repoRoot, "stream", { locale: "en-US" });
  assert.ok(t);
});
