/**
 * note-meta + frontmatter update contract (no Electron).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveStatusColumn,
  statusValueForColumn,
  isInProgressStatus,
  extractWorkspacePaths,
  dueBucket,
  sortByDueThenMtime,
} from "../src/lib/note-meta.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("resolveStatusColumn maps CN/EN aliases", () => {
  assert.equal(resolveStatusColumn(null), "draft");
  assert.equal(resolveStatusColumn("草稿"), "draft");
  assert.equal(resolveStatusColumn("in-progress"), "in-progress");
  assert.equal(resolveStatusColumn("进行中"), "in-progress");
  assert.equal(resolveStatusColumn("done"), "done");
  assert.equal(resolveStatusColumn("已完成"), "done");
  assert.equal(isInProgressStatus("进行中"), true);
  assert.equal(isInProgressStatus("草稿"), false);
  assert.equal(statusValueForColumn("in-progress"), "进行中");
});

test("extractWorkspacePaths finds md paths in AI receipts", () => {
  const text = 'ok path: 20-研究/2026-示例/note.md and also "10-动态/2026-日记/x.md"';
  const paths = extractWorkspacePaths(text);
  assert.ok(paths.some((p) => p.includes("note.md")));
  assert.ok(paths.some((p) => p.includes("x.md")));
});

test("dueBucket and sortByDueThenMtime order work management notes", () => {
  const now = new Date(2026, 6, 11); // local July 11 2026
  assert.equal(dueBucket("2026-07-01", now), "overdue");
  assert.equal(dueBucket("2026-07-11", now), "today");
  assert.equal(dueBucket("2026-07-14", now), "week");
  assert.equal(dueBucket(null, now), "none");
  const sorted = sortByDueThenMtime([
    { due: "2026-07-20", mtime: "a", name: "later" },
    { due: "2026-07-01", mtime: "b", name: "over" },
    { due: "2026-07-11", mtime: "c", name: "today" },
  ]);
  assert.equal(sorted[0].name, "over");
  assert.equal(sorted[1].name, "today");
});

test("WorkspaceService exposes updateFrontmatter + batchMoveToTopic", () => {
  const facade = readFileSync(path.join(root, "electron/workspace-service.mjs"), "utf8");
  assert.match(facade, /updateFrontmatter/);
  assert.match(facade, /batchMoveToTopic/);
  const pathOps = readFileSync(path.join(root, "electron/lib/workspace-path-ops.mjs"), "utf8");
  const inboxOps = readFileSync(path.join(root, "electron/lib/workspace-inbox-ops.mjs"), "utf8");
  assert.match(pathOps, /async updateFrontmatter/);
  assert.match(pathOps, /stringifyYamlFrontmatter/);
  assert.match(inboxOps, /async batchMoveToTopic|batchMoveToTopic/);
});

test("api wires updateFrontmatter and batchMove", () => {
  const api = readFileSync(path.join(root, "src/services/api.ts"), "utf8");
  assert.match(api, /updateFrontmatter/);
  assert.match(api, /batchMove/);
  assert.match(api, /workspace\.updateFrontmatter/);
  assert.match(api, /workspace\.batchMoveToTopic/);
});

test("system.closeWorkspace is exposed for landing return", () => {
  const api = readFileSync(path.join(root, "src/services/api.ts"), "utf8");
  assert.match(api, /closeWorkspace/);
  assert.match(api, /system\.closeWorkspace/);
  const main = readFileSync(path.join(root, "electron/main.mjs"), "utf8");
  assert.match(main, /closeWorkspace/);
  assert.match(main, /reason: "closed"/);
});
