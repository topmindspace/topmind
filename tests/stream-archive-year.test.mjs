/**
 * Stream archive + year listing (2026-08-27 Stream 模式整改):
 * - archiveStreamYear must be honest about partial failures (failedFiles,
 *   movedCount counts only successful moves).
 * - listStreamPeriods year filter covers year-dir AND flat ({year}-*) files
 *   before the result limit applies.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { archiveStreamYear, listStreamPeriods } from "../lib/workspace-model.mjs";
import { writeContract } from "../lib/contract-engine.mjs";

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function mkWs() {
  const ws = fsSync.mkdtempSync(path.join(os.tmpdir(), "tm-stream-archive-"));
  writeContract(ws, { contract_version: 4, stream: { packing: "weekly", append_heading: "day" } });
  fsSync.mkdirSync(path.join(ws, "10-动态"), { recursive: true });
  fsSync.mkdirSync(path.join(ws, "99-归档"), { recursive: true });
  return ws;
}

function seedPeriod(ws, rel, body = "# period\n") {
  const abs = path.join(ws, rel);
  fsSync.mkdirSync(path.dirname(abs), { recursive: true });
  fsSync.writeFileSync(abs, body, "utf8");
}

describe("archiveStreamYear honest partial failure", () => {
  let ws;
  before(() => {
    ws = mkWs();
    // Past year: one year-dir period + two flat periods
    seedPeriod(ws, "10-动态/2024/2024-W10.md");
    seedPeriod(ws, "10-动态/2024-W20.md");
    seedPeriod(ws, "10-动态/2024-W30.md");
  });
  after(() => fsSync.rmSync(ws, { recursive: true, force: true }));

  it("success: movedCount counts year-dir + flat files, no failures", async () => {
    const result = await archiveStreamYear({ workspaceRoot: ws, year: "2024" });
    assert.equal(result.ok, true);
    assert.equal(result.movedCount, 3);
    assert.deepEqual(result.failedFiles, []);
    assert.ok(result.archivePath.startsWith("99-"));
    assert.ok(
      fsSync.existsSync(path.join(ws, "99-归档/stream-archive/2024/2024-W10.md")),
      "year-dir period must live in archive home",
    );
    assert.ok(fsSync.existsSync(path.join(ws, "99-归档/stream-archive/2024/2024-W20.md")));
    assert.ok(!fsSync.existsSync(path.join(ws, "10-动态/2024")));
  });

  it("partial failure: failedFiles names what stayed, movedCount counts only successes", async () => {
    const ws2 = mkWs();
    try {
      seedPeriod(ws2, "10-动态/2024-W01.md");
      seedPeriod(ws2, "10-动态/2024-W02.md");
      seedPeriod(ws2, "10-动态/2024-W03.md");

      // Force exactly one flat-file move to fail
      const origRename = fsSync.renameSync;
      fsSync.renameSync = (from, to) => {
        if (path.basename(from) === "2024-W02.md") {
          const err = new Error("stub: cross-device link");
          err.code = "EXDEV";
          throw err;
        }
        return origRename(from, to);
      };
      let result;
      try {
        result = await archiveStreamYear({ workspaceRoot: ws2, year: "2024" });
      } finally {
        fsSync.renameSync = origRename;
      }

      assert.equal(result.ok, true, "archive proceeds with what moved");
      assert.equal(result.movedCount, 2, "movedCount counts only successful moves");
      assert.deepEqual(result.failedFiles, ["2024-W02.md"]);
      assert.ok(fsSync.existsSync(path.join(ws2, "10-动态/2024-W02.md")));
      assert.ok(!fsSync.existsSync(path.join(ws2, "10-动态/2024-W01.md")));
    } finally {
      fsSync.rmSync(ws2, { recursive: true, force: true });
    }
  });

  it("total failure: ok=false with move-failed reason and failedFiles", async () => {
    const ws3 = mkWs();
    try {
      seedPeriod(ws3, "10-动态/2024-W01.md");
      const origRename = fsSync.renameSync;
      fsSync.renameSync = () => {
        const err = new Error("stub: EIO");
        err.code = "EIO";
        throw err;
      };
      let result;
      try {
        result = await archiveStreamYear({ workspaceRoot: ws3, year: "2024" });
      } finally {
        fsSync.renameSync = origRename;
      }
      assert.equal(result.ok, false);
      assert.equal(result.reason, "move-failed");
      assert.equal(result.movedCount, 0);
      assert.deepEqual(result.failedFiles, ["2024-W01.md"]);
      assert.ok(fsSync.existsSync(path.join(ws3, "10-动态/2024-W01.md")));
    } finally {
      fsSync.rmSync(ws3, { recursive: true, force: true });
    }
  });
});

describe("listStreamPeriods year filter", () => {
  let ws;
  before(() => {
    ws = mkWs();
    // Current-year periods (year dir + flat)
    seedPeriod(ws, "10-动态/2026/2026-W30.md");
    seedPeriod(ws, "10-动态/2026-W29.md");
    // Past year: year dir AND flat layout mixed
    seedPeriod(ws, "10-动态/2024/2024-W10.md", "---\r\ntitle: 2024-W10 动态\r\n---\r\n\r\n# x\r\n");
    seedPeriod(ws, "10-动态/2024-W11.md");
    seedPeriod(ws, "10-动态/2025-W05.md");
  });
  after(() => fsSync.rmSync(ws, { recursive: true, force: true }));

  it("filters to one year including flat files, before limit applies", async () => {
    const all2024 = await listStreamPeriods({ workspaceRoot: ws, year: "2024", limit: 50 });
    assert.equal(all2024.length, 2);
    const names = all2024.map((p) => p.fileName).sort();
    assert.deepEqual(names, ["2024-W10.md", "2024-W11.md"]);

    // Tight limit must not miss the flat period: filtering happens pre-limit
    const limited = await listStreamPeriods({ workspaceRoot: ws, year: "2024", limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].fileName, "2024-W11.md", "newest-first within the year");
  });

  it("no year filter: all periods listed", async () => {
    const all = await listStreamPeriods({ workspaceRoot: ws });
    assert.equal(all.length, 5);
  });

  it("parses CRLF frontmatter title", async () => {
    const all2024 = await listStreamPeriods({ workspaceRoot: ws, year: "2024" });
    const w10 = all2024.find((p) => p.fileName === "2024-W10.md");
    assert.ok(w10, "CRLF frontmatter period must be listed");
    assert.equal(w10.title, "2024-W10 动态");
  });

  it("strips symmetric YAML quotes from frontmatter title (UI must not show quoting)", async () => {
    const ws2 = mkWs();
    try {
      seedPeriod(ws2, "10-动态/2026/2026-W34.md", '---\ntitle: "2026-W34 动态"\n---\n\n# x\n');
      seedPeriod(ws2, "10-动态/2026/2026-W33.md", "---\ntitle: '2026-W33 动态'\n---\n\n# x\n");
      seedPeriod(ws2, "10-动态/2026/2026-W32.md", "---\ntitle: \"quoted \\\"inner\\\" kept\"\n---\n\n# x\n");
      const all = await listStreamPeriods({ workspaceRoot: ws2 });
      const byFile = new Map(all.map((p) => [p.fileName, p]));
      assert.equal(byFile.get("2026-W34.md").title, "2026-W34 动态");
      assert.equal(byFile.get("2026-W33.md").title, "2026-W33 动态");
      // Only ONE symmetric pair is stripped; inner quotes are content
      assert.equal(byFile.get("2026-W32.md").title, 'quoted "inner" kept');
    } finally {
      fsSync.rmSync(ws2, { recursive: true, force: true });
    }
  });
});
