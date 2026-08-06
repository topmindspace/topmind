/**
 * Workbench shortcut matching contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WORKBENCH_SHORTCUTS,
  matchWorkbenchShortcut,
  GLOBAL_SHORTCUTS,
} from "../src/lib/shortcuts.ts";

function fakeKey(partial) {
  return {
    key: "a",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...partial,
  };
}

test("workbench shortcuts include documented navigate chords", () => {
  const displays = new Set(WORKBENCH_SHORTCUTS.map((s) => s.display));
  for (const d of ["⌘N", "⌘K", "⌘P", "⌘,", "⌘⇧I", "⌘⇧T", "⌘⇧B", "⌘⇧O", "⌘⇧A", "⌘⇧W", "⌘W", "⌘⌥W", "⌘[", "⌘]", "⌘⌥F"]) {
    assert.ok(displays.has(d), `missing ${d}`);
  }
  assert.ok(GLOBAL_SHORTCUTS.some((g) => g.display === "⌘⇧N"));
});

test("matchWorkbenchShortcut: ⌘N capture, not ⌘⇧N", () => {
  const n = matchWorkbenchShortcut(fakeKey({ key: "n", metaKey: true }));
  assert.equal(n?.id, "capture");
  const shiftN = matchWorkbenchShortcut(fakeKey({ key: "n", metaKey: true, shiftKey: true }));
  assert.equal(shiftN, null);
});

test("matchWorkbenchShortcut: navigate chords", () => {
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "i", metaKey: true, shiftKey: true }))?.id, "inbox");
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "t", metaKey: true, shiftKey: true }))?.id, "todo");
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "b", metaKey: true, shiftKey: true }))?.id, "kanban");
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "o", metaKey: true, shiftKey: true }))?.id, "outputs");
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "a", metaKey: true, shiftKey: true }))?.id, "archive");
});

test("matchWorkbenchShortcut: Escape closes overlay", () => {
  const esc = matchWorkbenchShortcut(fakeKey({ key: "Escape" }));
  assert.equal(esc?.action.type, "close-overlay");
});

test("matchWorkbenchShortcut: ⌘W close tab, ⌘⌥W close all, ⌘⇧W workspace", () => {
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "w", metaKey: true }))?.id, "close-tab");
  assert.equal(
    matchWorkbenchShortcut(fakeKey({ key: "w", metaKey: true, altKey: true }))?.id,
    "close-all-tabs",
  );
  assert.equal(
    matchWorkbenchShortcut(fakeKey({ key: "w", metaKey: true, shiftKey: true }))?.id,
    "workspace-switcher",
  );
});

test("matchWorkbenchShortcut: plain keys ignored", () => {
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "k" })), null);
  assert.equal(matchWorkbenchShortcut(fakeKey({ key: "n" })), null);
});

test("matchWorkbenchShortcut: ⌘⌥F toggles focus mode", () => {
  const hit = matchWorkbenchShortcut(fakeKey({ key: "f", metaKey: true, altKey: true }));
  assert.equal(hit?.id, "focus-mode");
  assert.equal(hit?.action.type, "toggle-focus");
});

test("TreeView context menu covers groups and topic path copy", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = new URL("../src/components/sidebar/", import.meta.url);
  // Handlers + copy stay in TreeView; path resolve → lib/tree-path; labels → context menu.
  const tree = readFileSync(fileURLToPath(new URL("TreeView.tsx", root)), "utf8");
  const menu = readFileSync(fileURLToPath(new URL("tree-node-context-menu.tsx", root)), "utf8");
  const pathLib = readFileSync(
    fileURLToPath(new URL("../../lib/tree-path.ts", root)),
    "utf8",
  );
  assert.match(tree, /pathOfTreeNode/);
  assert.match(tree, /api\.ws\.copyPath/);
  assert.match(tree, /TreeNodeContextMenu/);
  assert.match(pathLib, /export function pathOfTreeNode/);
  assert.match(pathLib, /selection\?\.kind === "topic"/);
  assert.match(menu, /section\/inbox/);
  assert.match(menu, /sidebar\.contextMenu\.copyPath/);
  assert.match(menu, /sidebar\.contextMenu\.openInbox/);
  assert.match(menu, /sidebar\.contextMenu\.openTopic/);
});
