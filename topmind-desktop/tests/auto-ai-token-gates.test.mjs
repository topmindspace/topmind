/**
 * Token-costly AI background work is gated by settings switches.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("settings-core defaults: suggest auto ON, todo maintain auto OFF", () => {
  const core = read("electron/lib/settings-core.mjs");
  assert.match(core, /autoPrepareSuggestions:\s*true/);
  assert.match(core, /autoMaintainTodos:\s*false/);
  assert.match(core, /typeof patch\.ai\.autoMaintainTodos === "boolean"/);
});

test("types + GeneralPanel expose both token gates", () => {
  const types = read("src/types.ts");
  assert.match(types, /autoPrepareSuggestions\?:/);
  assert.match(types, /autoMaintainTodos\?:/);
  const panel = read("src/components/settings/GeneralPanel.tsx");
  assert.match(panel, /autoPrepareSuggestions/);
  assert.match(panel, /autoMaintainTodos/);
  const zh = JSON.parse(read("src/locales/zh-CN/settings.json"));
  const en = JSON.parse(read("src/locales/en-US/settings.json"));
  assert.ok(zh.general.autoMaintainTodos);
  assert.ok(en.general.autoMaintainTodos);
  assert.ok(zh.general.autoMaintainTodosDesc);
  assert.ok(en.general.autoMaintainTodosDesc);
});

test("ChatInput model list filters to configured providers and lives in toolbar", () => {
  const src = read("src/components/ai/ChatInput.tsx");
  assert.match(src, /configuredProviders/);
  assert.match(src, /v4-composer-toolbar/);
  assert.doesNotMatch(src, /v4-composer-footer/);
  assert.match(src, /groups=\{modelGroups\}/);
});
