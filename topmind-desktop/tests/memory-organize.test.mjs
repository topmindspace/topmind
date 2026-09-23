/**
 * Confirm-only 我的情况 organize — shipped helper + chrome, no silent profile write.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("runMemoryOrganizeConfirm enqueues TaskStore memory_organize + suggest surface, not writeback", () => {
  const src = read("src/lib/memory-organize.ts");
  assert.match(src, /createTask\("memory_organize"\)/);
  assert.match(src, /task-panel:open/);
  assert.doesNotMatch(src, /appendCoreMemory/);
  assert.doesNotMatch(src, /executeWrite/);
  assert.doesNotMatch(src, /api\.ws\.save/);
  assert.match(src, /revealMemoryFolderInTree/);
  assert.match(src, /section\/memory/);
  const store = read("src/stores/task-store.ts");
  assert.match(store, /case "memory_organize"/);
  assert.match(store, /runActivityOps/);
  assert.match(store, /suggest-surface:open/);
});

test("memory browse chrome wires organize + folder reveal to the helper", () => {
  const view = read("src/plugins/topmind-workspace/views/MemoryBrowseView.tsx");
  assert.match(view, /runMemoryOrganizeConfirm/);
  assert.match(view, /data-memory-organize/);
  assert.match(view, /revealMemoryFolderInTree/);
  assert.match(view, /data-memory-open-folder/);
  assert.doesNotMatch(view, /appendCoreMemory/);
  assert.doesNotMatch(view, /api\.ws\.save\(/);
});
