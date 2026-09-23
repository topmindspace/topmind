/**
 * notes-index projection contract: truncated vs complete, cache reuse.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { getNotesIndex, invalidateNotesIndex } from "../electron/lib/notes-index.mjs";

// monorepo root (skills/ + topmind-desktop/) — required for template role resolution
const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let tmpRoot;
/** Full workspace context (userWorkspaceRoot + engineRoot) as production RPC uses. */
function wsCtx() {
  return { userWorkspaceRoot: tmpRoot, engineRoot };
}

async function seedWorkspace(root) {
  await fs.mkdir(path.join(root, "10-日常"), { recursive: true });
  for (let i = 0; i < 5; i++) {
    const p = path.join(root, "10-日常", `note-${i}.md`);
    await fs.writeFile(
      p,
      `---\ntitle: Note ${i}\nstatus: 进行中\ntags: [a]\n---\n\nbody ${i}\n`,
      "utf8",
    );
  }
  // system role category should be skipped when roles resolve; 99-归档 often system
  await fs.mkdir(path.join(root, "99-归档"), { recursive: true });
  await fs.writeFile(path.join(root, "99-归档", "skip.md"), "# skip\n", "utf8");
}

test("getNotesIndex reports complete when under limit", async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-notes-idx-"));
  await seedWorkspace(tmpRoot);
  invalidateNotesIndex();
  const r = await getNotesIndex(wsCtx(), { limit: 50, force: true });
  assert.equal(r.complete, true);
  assert.equal(r.truncated, false);
  assert.ok(r.total >= 5);
  assert.equal(r.scannedTotal, r.total, "complete: scannedTotal equals projection total");
  assert.equal(r.returned, r.notes.length);
  assert.ok(r.notes.every((n) => !String(n.path).startsWith("99-")));
});

test("getNotesIndex marks truncated and reports full scannedTotal", async () => {
  invalidateNotesIndex();
  const r = await getNotesIndex(wsCtx(), { limit: 2, force: true });
  assert.equal(r.notes.length, 2);
  assert.equal(r.truncated, true);
  assert.equal(r.complete, false);
  assert.equal(r.total, 2);
  assert.equal(r.returned, 2);
  // 5 notes in 10-日常; 99-归档 skipped — scannedTotal must be full eligible census
  assert.ok(r.scannedTotal >= 5, `scannedTotal=${r.scannedTotal} should count all eligible md`);
  assert.ok(r.scannedTotal > r.total);
});

test("getNotesIndex reuses warm cache including scannedTotal", async () => {
  invalidateNotesIndex();
  const a = await getNotesIndex(wsCtx(), { limit: 50, force: true });
  const b = await getNotesIndex(wsCtx(), { limit: 50, force: false });
  assert.equal(b.cached, true);
  assert.equal(b.builtAt, a.builtAt);
  assert.equal(b.truncated, false);
  assert.equal(b.scannedTotal, a.scannedTotal);
});

after(async () => {
  invalidateNotesIndex();
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});
