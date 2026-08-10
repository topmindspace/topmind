/**
 * MenuSelect is the Quiet Paper listbox for long / grouped options.
 * Native <select> remains only for short form fields.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("MenuSelect module exports portal listbox select", () => {
  const src = read("src/components/ui/menu-select.tsx");
  assert.match(src, /export function MenuSelect/);
  assert.match(src, /from ["']\.\/DropdownMenu["']/);
  assert.match(src, /variant === "composer"/);
  assert.match(src, /groups/);
});

test("DropdownMenu: pin on open, scroll closes, z-menu above tooltips", () => {
  const src = read("src/components/ui/DropdownMenu.tsx");
  assert.match(src, /computeDropdownPosition|dropdown-position/);
  assert.match(src, /z-menu/);
  assert.match(src, /closeOnScroll/);
  assert.match(src, /acquireMenuLayer/);
  // Scroll closes menu; must not re-place on scroll (laggy drift)
  assert.match(src, /addEventListener\("scroll"/u);
  assert.match(src, /onOpenChangeRef\.current\(false\)/);
  assert.doesNotMatch(src, /schedulePlace/u);
});

test("tooltip yields while menu layer active", () => {
  const tip = read("src/components/ui/tooltip.tsx");
  assert.match(tip, /data-slot="tooltip-content"/);
  const css = read("src/styles/v4.css");
  assert.match(css, /html\[data-menu-open\].*tooltip/s);
  const layer = read("src/lib/menu-layer.ts");
  assert.match(layer, /data-menu-open/);
  assert.match(layer, /acquireMenuLayer/);
});

test("Select is portal MenuSelect (no native option list)", () => {
  const src = read("src/components/ui/select.tsx");
  assert.match(src, /MenuSelect/);
  assert.doesNotMatch(src, /return \(\s*<select/u);
  assert.doesNotMatch(src, /createElement\(\s*["']select["']/u);
  assert.match(src, /target: \{ value/);
});

test("AI composer model picker uses MenuSelect without covering Tooltip", () => {
  const src = read("src/components/ai/ChatInput.tsx");
  assert.match(src, /MenuSelect/);
  // Compact chip in toolbar (not wasteful solo footer row)
  assert.match(src, /variant="chip"/);
  assert.match(src, /groups=\{modelGroups\}/);
  assert.doesNotMatch(src, /v4-composer-footer/);
  // Model list = configured providers only (aligned with settings keys)
  assert.match(src, /configuredProviders|runtimeProviders|runtimeStatus/);
  // Must not wrap open model list in a live Tooltip (covers list items)
  assert.doesNotMatch(
    src,
    /Tooltip content=\{t\("ai\.selectModelAria[\s\S]{0,80}MenuSelect[\s\S]{0,200}groups=\{modelGroups\}/u,
  );
  assert.match(src, /aria-label=\{t\("ai\.selectModelAria"\)\}/);
});

test("settings AI panel uses provider cards with inline model lists", () => {
  const src = read("src/components/settings/AiProviderPanel.tsx");
  // Provider-card architecture: expandable cards with inline model selection
  assert.match(src, /ProviderCard/);
  assert.match(src, /defaultModel/);
  assert.match(src, /PROVIDERS/);
  // Must not use native <select> for model selection (Select wrapper is OK for short fields)
  assert.doesNotMatch(src, /return \(\s*<select/u);
});

test("tree sort + AI session use portal DropdownMenu", () => {
  const tree = read("src/components/sidebar/tree-toolbar.tsx");
  assert.match(tree, /DropdownMenu/);
  assert.doesNotMatch(tree, /absolute right-0 top-full/);
  const ai = read("src/components/ai/AiPanel.tsx");
  assert.match(ai, /DropdownMenu/);
  assert.match(ai, /showSessionList/);
});
