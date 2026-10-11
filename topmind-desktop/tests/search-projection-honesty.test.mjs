/**
 * Keyword search + notes-index projection honesty.
 * Drives real shipped modules (grepWorkspace / getNotesIndex) — no re-implementation.
 * Embedding / semantic index is out of scope.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { getNotesIndex, invalidateNotesIndex } from "../electron/lib/notes-index.mjs";
import { scanOps } from "../electron/lib/workspace-scan-ops.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** @type {string} */
let tmpRoot;

function wsCtx() {
  return {
    workspaceRoot: { userWorkspaceRoot: tmpRoot, engineRoot },
    userWorkspaceRoot: tmpRoot,
    engineRoot,
  };
}

async function seedManyNotes(root, n) {
  await fs.mkdir(path.join(root, "10-日常"), { recursive: true });
  await fs.mkdir(path.join(root, "99-归档"), { recursive: true });
  for (let i = 0; i < n; i++) {
    await fs.writeFile(
      path.join(root, "10-日常", `note-${String(i).padStart(3, "0")}.md`),
      `---\ntitle: Note ${i}\ntags: [honesty]\n---\n\nunique-token-${i} body shared-keyword\n`,
      "utf8",
    );
  }
  await fs.writeFile(path.join(root, "99-归档", "skip.md"), "# archive skip\n", "utf8");
}

describe("search / notes projection honesty", () => {
  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "topmind-search-honest-"));
    await seedManyNotes(tmpRoot, 12);
  });

  after(async () => {
    invalidateNotesIndex();
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("getNotesIndex under cap is complete with scannedTotal === total", async () => {
    invalidateNotesIndex();
    const r = await getNotesIndex(wsCtx().workspaceRoot, { limit: 50, force: true });
    assert.equal(r.complete, true);
    assert.equal(r.truncated, false);
    assert.equal(r.scannedTotal, r.total);
    assert.ok(r.total >= 12);
    assert.ok(r.notes.every((n) => !String(n.path).startsWith("99-")));
  });

  it("getNotesIndex at low limit is truncated and scannedTotal > total", async () => {
    invalidateNotesIndex();
    const r = await getNotesIndex(wsCtx().workspaceRoot, { limit: 3, force: true });
    assert.equal(r.notes.length, 3);
    assert.equal(r.truncated, true);
    assert.equal(r.complete, false);
    assert.equal(r.total, 3);
    assert.equal(r.returned, 3);
    assert.ok(
      r.scannedTotal >= 12,
      `scannedTotal=${r.scannedTotal} must count all eligible md, not projection size`,
    );
    assert.ok(r.scannedTotal > r.total);
  });

  it("grepWorkspace returns truncated when hits exceed maxResults", async () => {
    const ctx = {
      workspaceRoot: { userWorkspaceRoot: tmpRoot, engineRoot },
    };
    const res = await scanOps.grepWorkspace(
      { pattern: "shared-keyword", maxResults: 4, includeArchive: false },
      ctx,
    );
    assert.ok(Array.isArray(res.results));
    assert.equal(res.results.length, 4);
    assert.equal(res.count, 4);
    assert.equal(res.truncated, true, "must flag cap so UI never treats count as full census");
    assert.match(String(res.note || ""), /截断|maxHits|条/u);
    assert.ok(typeof res.filesScanned === "number");
  });

  it("workspace.search path (scanOps.search) forwards truncated honesty", async () => {
    const ctx = {
      workspaceRoot: { userWorkspaceRoot: tmpRoot, engineRoot },
    };
    const res = await scanOps.search(
      { query: "shared-keyword", maxResults: 5 },
      ctx,
    );
    assert.equal(res.results.length, 5);
    assert.equal(res.truncated, true);
    assert.ok("filesScanned" in res);
    assert.ok("count" in res);
  });

  it("GlobalSearch UI consumes truncated from API response shape", async () => {
    // Structural contract: GlobalSearch must read res.truncated (not ignore honesty flags)
    const src = await fs.readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/components/overlays/GlobalSearch.tsx"),
      "utf8",
    );
    assert.match(src, /setTruncated\(Boolean\(res\.truncated\)\)/);
    assert.match(src, /footerCountTruncated|truncatedHint/);
    assert.doesNotMatch(src, /const \{ results: next \} = await api\.ws\.search/);
  });
});
