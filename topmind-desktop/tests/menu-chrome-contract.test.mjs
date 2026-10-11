/**
 * Menu chrome contract — ContextMenu / DropdownMenu stay aligned.
 * Guards the UX debt that accumulated as two primitives drifted:
 * item DOM (button), copy-path chord, open-external icon, keyboard walk.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../src/", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

test("ContextMenuItem is a real button (native Enter/Space + disabled)", () => {
  const src = read("components/ui/context-menu.tsx");
  assert.match(src, /role="menuitem"/);
  assert.match(src, /<button/);
  assert.doesNotMatch(src, /onClick=\{disabled \? undefined : onClick\}[\s\S]{0,80}onKeyDown=\{\(e\) => \{\s*if \(disabled\) return;/);
});

test("ContextMenu keyboard walks Tab as well as arrows", () => {
  const src = read("components/ui/context-menu.tsx");
  assert.match(src, /e\.key === "Tab"/);
  assert.match(src, /shiftKey/);
});

test("DropdownItem accepts the same icon/shortcut chrome as ContextMenuItem", () => {
  const src = read("components/ui/DropdownMenu.tsx");
  assert.match(src, /icon\?: ReactNode/);
  assert.match(src, /shortcut\?: string/);
  assert.match(src, /v4-kbd/);
});

test("tree-node copy-path always shows ⌘⇧C and open-external uses RiExternalLinkLine", () => {
  const src = read("components/sidebar/tree-node-context-menu.tsx");
  const copyItems = src.match(/onClick=\{h\.handleCopyPath\}/g) || [];
  const withChord =
    src.match(/onClick=\{h\.handleCopyPath\}\s+shortcut=\{formatChord\("⌘⇧C"\)\}/g) || [];
  assert.ok(copyItems.length >= 5, `expected copy-path items, got ${copyItems.length}`);
  assert.equal(withChord.length, copyItems.length, "every copy-path item carries the chord");
  assert.match(src, /RiExternalLinkLine/);
  assert.match(src, /onClick=\{h\.handleOpenExternal\}/);
});

test("AppMenuBar is a keyboard menubar (←/→/Home/End)", () => {
  const src = read("components/shell/AppMenuBar.tsx");
  assert.match(src, /role="menubar"/);
  assert.match(src, /ArrowRight/);
  assert.match(src, /ArrowLeft/);
  assert.match(src, /aria-haspopup="menu"/);
  assert.match(src, /aria-expanded=/);
});

test("StatusBar file chip opens shared WorkspaceFileContextMenu", () => {
  const src = read("components/shell/StatusBar.tsx");
  assert.match(src, /WorkspaceFileContextMenu/);
  assert.match(src, /useFileContextMenu/);
  assert.doesNotMatch(src, /api\.sys\.reveal\(selection\.path\)/);
});

test("shared menu surface CSS still drives both primitives", () => {
  const css = read("styles/v4.css");
  assert.match(css, /\.v4-menu-surface/);
  assert.match(css, /\.v4-menu-item/);
  assert.match(css, /\.v4-menu-enter/);
  assert.match(css, /\.v4-menu-item:active/);
});

test("ContextMenu placement comes from shared dropdown-position module", () => {
  const src = read("components/ui/context-menu.tsx");
  assert.match(src, /from ["']\.\.\/\.\.\/lib\/dropdown-position["']/);
  assert.match(src, /placeContextMenu/);
  assert.doesNotMatch(src, /function placeMenu\(/);
});

test("tree file menu offers move-to-topic wired to api.ws.move", () => {
  const tree = read("components/sidebar/TreeView.tsx");
  // File nodes route through the shared WorkspaceFileContextMenu.
  assert.match(tree, /WorkspaceFileContextMenu/);
  assert.match(tree, /useFileContextMenu/);
  assert.match(tree, /moveTopics/);
  // Non-file tree nodes keep TreeNodeContextMenu.
  assert.match(tree, /TreeNodeContextMenu/);
  const fileMenu = read("components/ui/workspace-file-menu.tsx");
  assert.match(fileMenu, /ContextMenuSubmenu/);
  assert.match(fileMenu, /handleMoveToTopicId/);
  assert.match(fileMenu, /api\.ws\.move\(/);
  assert.match(fileMenu, /extraItems/);
});

test("ContextMenuSubmenu opens a nested portal panel", () => {
  const src = read("components/ui/context-menu.tsx");
  assert.match(src, /export function ContextMenuSubmenu/);
  assert.match(src, /data-submenu-trigger/);
  assert.match(src, /data-submenu-panel/);
  assert.match(src, /ArrowRight/);
});

test("⌘B does not steal Bold from the editor; requireNoOverlay is enforced", () => {
  const src = read("components/shell/OverlayHost.tsx");
  assert.match(src, /hit\.id === "toggle-sidebar" && isEditableTarget/);
  assert.match(src, /hit\.requireNoOverlay/);
});

test("TreeView opens context menu via Menu key / Shift+F10", () => {
  const src = read("components/sidebar/TreeView.tsx");
  assert.match(src, /ContextMenu/);
  assert.match(src, /F10/);
  assert.match(src, /shiftKey/);
});

test("TitleBar panel toggles surface platform chords", () => {
  const src = read("components/shell/TitleBar.tsx");
  assert.match(src, /formatChord\("⌘B"\)/);
  assert.match(src, /formatChord\("⌘⌥B"\)/);
});


