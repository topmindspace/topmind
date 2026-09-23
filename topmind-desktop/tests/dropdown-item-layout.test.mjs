/**
 * Dropdown item layout contract — icon · label · trailing stay on one row.
 * Guards the multi-line stack regression: children must live in a flex-row
 * wrapper (a non-flex span forced SVG + block text onto separate lines).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../src/", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

test("DropdownItem children wrapper is a flex row (not a stacking span)", () => {
  const src = read("components/ui/DropdownMenu.tsx");
  assert.match(
    src,
    /<span className="flex min-w-0 flex-1 items-center gap-2">\{children\}<\/span>/,
  );
  // The old non-flex wrapper must not come back.
  assert.doesNotMatch(src, /<span className="min-w-0 flex-1 truncate">\{children\}<\/span>/);
});

test("WorkspaceSwitcher menu items use the icon/shortcut slots", () => {
  const src = read("components/shell/WorkspaceSwitcher.tsx");
  assert.match(src, /icon=\{/);
  assert.match(src, /RiAddLine/);
  assert.match(src, /RiFullscreenLine/);
  assert.match(src, /shortcut=\{formatChord\("⌘⌥F"\)\}/);
  assert.match(src, /shortcut=\{formatChord\("⌘⇧L"\)\}/);
  // Open/close and focus/tools/help rows no longer hand-roll icons as children.
  assert.doesNotMatch(src, /<DropdownItem disabled=\{busy\} onSelect=\{\(\) => \{ void handlePickNew\(\); \}\}>\s*<RiAddLine/);
  assert.doesNotMatch(src, /<span className="flex-1">\{t\("titleBar\.focusMode"\)\}<\/span>\s*<kbd/);
});

test("ViewSwitcher two-line rows keep icon slot + trailing check", () => {
  const src = read("components/sidebar/ViewSwitcher.tsx");
  assert.match(src, /icon=\{/);
  assert.match(src, /RiCheckLine/);
  assert.match(src, /flex min-w-0 flex-1 flex-col/);
});

test("PrimaryNav / TopicPicker / format-bar use icon slots", () => {
  assert.match(read("components/shell/PrimaryNav.tsx"), /icon=\{/);
  assert.match(read("components/workspace/TopicPickerMenu.tsx"), /icon=\{<RiFolderOpenLine/);
  assert.match(read("plugins/topmind-workspace/views/file-editor-format-bar.tsx"), /icon=\{<RiPriceTag3Line/);
});
